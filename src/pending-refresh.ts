import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { withDeadline } from "./deadline.js"

interface PendingState {
  readonly revision: number
  reconcile(requests: readonly PermissionRequest[], revision: number): void
}

/** Read-only recovery. Deadline callbacks produce data, never controller effects. */
export class PendingRefresh {
  private syncing = false
  private stopped = false
  private again = false
  private generation = 0
  private abort = new AbortController()
  private signal: AbortSignal
  constructor(private pending: PendingState, private read: (signal: AbortSignal) => Promise<PermissionRequest[]>, parent: AbortSignal,
    private health?: (healthy: boolean) => void) {
    this.signal = AbortSignal.any([parent, this.abort.signal])
  }

  async refresh(): Promise<void> {
    if (this.stopped || this.signal.aborted) return
    if (this.syncing) { this.again = true; return }
    this.syncing = true
    const generation = ++this.generation
    const revision = this.pending.revision
    let worker: Promise<PermissionRequest[]> | undefined
    const report = (healthy: boolean) => { if (!this.stopped && !this.signal.aborted) { try { this.health?.(healthy) } catch {} } }
    try {
      const requests = await withDeadline(this.signal, 5000, signal => worker = Promise.resolve().then(() => {
        signal.throwIfAborted(); return this.read(signal)
      }), "Pending permission refresh")
      if (this.stopped || this.signal.aborted || this.generation !== generation || this.pending.revision !== revision) { report(false); return }
      this.pending.reconcile(requests, revision)
      report(true)
    } catch { report(false) }
    finally {
      const release = () => {
        if (this.generation === generation) {
          this.syncing = false
          const again = this.again
          this.again = false
          if (again) void this.refresh()
        }
      }
      // Caller completion is bounded; physical settlement owns admission.
      if (worker) void worker.then(release, release)
      else release()
    }
  }

  dispose() {
    this.stopped = true
    this.again = false
    this.generation++
    this.abort.abort()
  }
}
