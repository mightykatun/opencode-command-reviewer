import type { HistoryStore } from "./history-store.js"
import type { HistoryQuery } from "./history-records.js"
import { snapshotQuery } from "./history-records.js"
import type { HistoryResult } from "./history-schema.js"

/** One actual store read and one coalesced follow-up. Selection changes invalidate old snapshots. */
export class HistoryRefresh {
  private revision = 0
  private active = false
  private again = false
  private stopped = false
  private abort = new AbortController()
  private timer: ReturnType<typeof setInterval>
  private offCommit: () => void
  private offFailure: () => void
  constructor(private store: Pick<HistoryStore, "query" | "onCommit" | "onWriteFailure">,
    private query: HistoryQuery, private publish: (result: HistoryResult | undefined) => void) {
    this.query = snapshotQuery(query)
    this.offCommit = store.onCommit(() => this.refresh())
    // A write outage does not hide readable history. Analytics retains its unavailable policy.
    this.offFailure = store.onWriteFailure(() => {
      if (this.query.type !== "totals" || this.stopped) return
      this.revision++; this.again = false; this.publish(undefined)
    })
    // A healthy read taking over two seconds must still be publishable.
    this.timer = setInterval(() => {
      if (this.active) this.again = true
      else this.refresh()
    }, 2000)
    this.refresh()
  }
  select(query: HistoryQuery) { this.query = snapshotQuery(query); this.refresh() }
  refresh() {
    if (this.stopped) return
    this.revision++
    if (this.active) { this.again = true; return }
    this.start()
  }
  private start() {
    this.active = true; this.again = false
    const revision = this.revision
    const read = this.store.query(this.query, this.abort.signal)
    void read.then(value => {
      if (!this.stopped && revision === this.revision) this.publish(value)
    }, () => { if (!this.stopped && revision === this.revision) this.publish(undefined) }).finally(async () => {
      await read.settled
      this.active = false
      if (this.again && !this.stopped) this.start()
    }).catch(() => {})
  }
  dispose() {
    this.stopped = true; this.revision++; this.again = false; this.abort.abort()
    clearInterval(this.timer); this.offCommit(); this.offFailure()
  }
}
