import { withDeadline } from "./deadline.js"
import type { LifetimeTotals } from "./lifetime.js"

interface Transaction {
  revision: number
  settled: boolean
  finished: boolean
}

/** One actual totals read, including cleanup, and at most one requested follow-up. */
export class LifetimeRefresh {
  private revision = 0
  private followUp = false
  private stopped = false
  private active?: Transaction
  private abort = new AbortController()
  private signal: AbortSignal
  constructor(private read: (signal: AbortSignal) => Promise<LifetimeTotals>,
    private publish: (totals: LifetimeTotals | undefined) => void, parent: AbortSignal) {
    this.signal = AbortSignal.any([parent, this.abort.signal])
  }

  refresh() {
    if (this.stopped || this.signal.aborted) return
    this.revision++
    if (this.active) { this.followUp = true; return }
    this.start()
  }

  /** A failed write invalidates active results and requests queued before it. */
  failed() {
    if (this.stopped || this.signal.aborted) return
    this.revision++
    this.followUp = false
    this.publish(undefined)
  }

  private start() {
    if (this.stopped || this.signal.aborted) return
    this.followUp = false
    const transaction = { revision: this.revision, settled: true, finished: false }
    this.active = transaction
    void this.run(transaction)
  }

  private live(transaction: Transaction) {
    return !this.stopped && !this.signal.aborted && this.active === transaction
  }

  private async run(transaction: Transaction) {
    try {
      const totals = await withDeadline(this.signal, 5000, (signal) => {
        transaction.settled = false
        const worker = Promise.resolve().then(() => { signal.throwIfAborted(); return this.read(signal) })
        const settled = () => { transaction.settled = true; this.release(transaction) }
        // Observe actual settlement separately from the bounded wait. Rejections
        // and late cleanup must be consumed without releasing another read's slot.
        void worker.then(settled, settled)
        return worker
      }, "Lifetime usage loading")
      if (this.live(transaction) && this.revision === transaction.revision) this.publish(totals)
    } catch {
      // New refresh requests do not hide a failed/expired read when its actual
      // work still owns the slot and the queued request cannot run yet.
      if (this.live(transaction)) this.publish(undefined)
    } finally {
      transaction.finished = true
      this.release(transaction)
    }
  }

  private release(transaction: Transaction) {
    if (this.active !== transaction || !transaction.finished || !transaction.settled) return
    this.active = undefined
    if (this.followUp) this.start()
  }

  dispose() {
    this.stopped = true
    this.followUp = false
    this.revision++
    this.abort.abort()
  }
}
