import { HistoryRefresh } from "./history-refresh.js"
import type { HistoryStore } from "./history-store.js"
import type { HistorySelection } from "./history-schema.js"
import type { HistoryQuery } from "./history-records.js"

export interface HistoryViewState {
  open: boolean; status: "loading" | "ready" | "error"; selection?: HistorySelection; reset: number
}

/** Owns only one indexed selection. No review-mode load or permission writer. */
export class HistoryController {
  state: HistoryViewState = { open: false, status: "loading", reset: 0 }
  scroll = 0
  private generation = 0
  private session?: string
  private root?: string
  private refresh?: HistoryRefresh
  private abort?: AbortController
  private retry?: ReturnType<typeof setTimeout>
  private stopped = false
  private deletedEntries = new Set<string>()
  private unsubscribeMaintenance?: () => void
  constructor(private scope: string, private store: Pick<HistoryStore, "query" | "onCommit" | "onWriteFailure"> & Partial<Pick<HistoryStore, "onMaintenance" | "maintenanceDirty">>,
    private ancestry: (session: string, signal: AbortSignal) => Promise<string>, private publish: (state: HistoryViewState) => void) {
    this.unsubscribeMaintenance = store.onMaintenance?.(() => {
      if (!this.state.open || this.stopped) return
      if (store.maintenanceDirty) this.update({ status: "loading" })
      this.refresh?.refresh()
    })
  }
  private update(value: Partial<HistoryViewState>) { this.state = { ...this.state, ...value }; this.publish(this.state) }
  recordScroll(offset: number) { if (this.state.status === "ready") this.scroll = offset }
  isCurrent(session: string) { return !this.stopped && this.state.open && this.session === session }
  open(session: string) {
    if (this.stopped) return
    this.close()
    this.session = session
    this.scroll = 0
    this.update({ open: true, status: "loading", selection: undefined, reset: this.state.reset + 1 })
    this.abort = new AbortController()
    void this.resolve(this.generation, session, this.abort.signal)
  }
  private async resolve(generation: number, session: string, signal: AbortSignal) {
    try {
      const root = await this.ancestry(session, signal)
      if (generation !== this.generation || signal.aborted) return
      this.root = root
      this.refresh = new HistoryRefresh(this.store, this.query(), result => {
        if (generation !== this.generation || !this.state.open) return
        if (this.store.maintenanceDirty) { this.update({ status: "loading" }); return }
        if (!result || !("rank" in result)) { this.update({ status: "error" }); return }
        if (result.deleted) { this.close(); return }
        if (result.entry && this.deletedEntries.has(result.entry)) return
        this.deletedEntries.clear()
        const previous = this.state.selection
        const replaced = previous?.entry !== result.entry || previous?.order?.tie !== result.order?.tie
          || JSON.stringify(previous?.record?.payload) !== JSON.stringify(result.record?.payload)
        if (replaced) this.scroll = 0
        // Loading/error messages replace Markdown and collapse its scroll extent.
        // Recovery of the same payload must restore layout without losing its offset.
        const restore = replaced || this.state.status !== "ready"
        this.update({ status: "ready", selection: result, reset: this.state.reset + Number(restore) })
        // Poll by stable identity, never repeat a direction or jump to a new arrival.
        this.refresh?.retain(this.query())
      })
    } catch {
      if (generation !== this.generation || signal.aborted) return
      this.update({ status: "error" })
      this.retry = setTimeout(() => void this.resolve(generation, session, signal), 2000)
    }
  }
  private query(): HistoryQuery {
    const selected = this.state.selection
    return { type: "history", scope: this.scope, root: this.root!, entry: selected?.entry, order: selected?.order }
  }
  navigate(direction: "older" | "newer") {
    if (!this.state.open || this.state.status !== "ready" || !this.state.selection?.[direction]) return
    this.refresh?.select({ ...this.query(), direction } as HistoryQuery)
  }
  route(session?: string) { if (this.state.open && session !== this.session) this.close() }
  deleted(id: string) {
    if (id === this.root || id === this.session) { this.close(); return }
    const selected = this.state.selection
    if (selected?.entry && (selected.session ?? selected.record?.context.session) === id) {
      this.deletedEntries.add(selected.entry)
      this.update({ status: "loading" })
    }
    this.refresh?.refresh()
  }
  close() {
    this.generation++; this.abort?.abort(); this.refresh?.dispose(); this.refresh = undefined
    clearTimeout(this.retry); this.root = undefined; this.session = undefined
    this.deletedEntries.clear()
    this.update({ open: false })
  }
  dispose() { this.stopped = true; this.unsubscribeMaintenance?.(); this.close() }
}
