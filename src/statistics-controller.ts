import { HistoryRefresh } from "./history-refresh.js"
import type { HistoryStore } from "./history-store.js"
import type { ConversationTotals } from "./history-schema.js"
import type { LifetimeTotals } from "./lifetime.js"
import { withDeadline } from "./deadline.js"

export type StatisticsScope = "conversation" | "lifetime"
export interface StatisticsState {
  open: boolean; view: StatisticsScope; totals?: LifetimeTotals; unavailable: boolean
  conversation?: ConversationTotals; ancestry: "none" | "loading" | "ready" | "unavailable"
}

/** One refresh owns both aggregates in a single read snapshot. Browsing is read-only. */
export class StatisticsController {
  state: StatisticsState = { open: false, view: "lifetime", unavailable: false, ancestry: "none" }
  private refresh: HistoryRefresh
  private session?: string
  private root?: string
  private generation = 0
  private lookup = false
  private lookupAgain = false
  private abort?: AbortController
  private stopped = false
  constructor(private scope: string, store: Pick<HistoryStore, "query" | "onCommit" | "onWriteFailure">,
    private ancestry: (session: string, signal: AbortSignal) => Promise<string>, private publish: (state: StatisticsState) => void) {
    this.refresh = new HistoryRefresh(store, { type: "totals" }, value => {
      if (value && "totals" in value) this.update({ totals: value.totals, conversation: value.conversation, unavailable: false })
      else this.update({ unavailable: true })
    })
  }
  private update(value: Partial<StatisticsState>) { this.state = { ...this.state, ...value }; this.publish(this.state) }
  open(session?: string) {
    if (this.stopped) return this.generation
    this.generation++; this.abort?.abort(); this.session = session; this.root = undefined
    this.update({ open: true, view: "lifetime", conversation: undefined, ancestry: session ? "loading" : "none" })
    this.refresh.select({ type: "totals" })
    return this.generation
  }
  current(token: number) { return !this.stopped && this.state.open && token === this.generation }
  select(view: StatisticsScope) {
    if (this.stopped || !this.state.open) return
    this.update({ view })
    if (view === "conversation" && this.session && !this.root) {
      this.update({ ancestry: "loading", conversation: undefined })
      void this.resolve()
    }
    this.query()
  }
  private query() {
    this.refresh.select({ type: "totals", ...(this.state.open && this.state.view === "conversation" && this.root
      ? { conversation: { scope: this.scope, root: this.root } } : {}) })
  }
  private async resolve() {
    if (this.stopped || !this.session || !this.state.open) return
    if (this.lookup) { this.lookupAgain = true; return }
    this.lookup = true
    this.lookupAgain = false
    const generation = this.generation, session = this.session, abort = this.abort = new AbortController()
    let worker: Promise<string> | undefined
    try {
      const root = await withDeadline(abort.signal, 5000, signal => {
        worker = Promise.resolve().then(() => { signal.throwIfAborted(); return this.ancestry(session, signal) })
        return worker
      })
      if (!this.current(generation) || abort.signal.aborted) return
      this.root = root; this.update({ ancestry: "ready" }); this.query()
    } catch {
      if (this.current(generation) && !abort.signal.aborted) this.update({ ancestry: "unavailable" })
    } finally {
      // A timed-out lookup retains actual ownership. Rapid reopen/scope changes
      // coalesce to the newest session instead of spawning abandoned host reads.
      await worker?.catch(() => {})
      this.lookup = false
      if (!this.stopped && this.state.open && !this.root && this.state.view === "conversation"
        && (generation !== this.generation || this.lookupAgain)) void this.resolve()
    }
  }
  close(token: number) {
    if (!this.current(token)) return
    this.generation++; this.abort?.abort(); this.root = undefined; this.session = undefined
    this.update({ open: false, conversation: undefined, ancestry: "none" }); this.refresh.select({ type: "totals" })
  }
  dispose() { this.stopped = true; this.generation++; this.abort?.abort(); this.refresh.dispose() }
}
