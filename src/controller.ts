import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import type { ReviewResult } from "./types.js"
import type { Config } from "./config.js"
import type { ApprovalTransport } from "./approval.js"
import { isDeepStrictEqual } from "node:util"
import { withDeadline } from "./reviewer.js"

export type AutoApproval = { status: "countdown"; seconds: number } | { status: "checking" | "allowing" | "cancelled" | "failed" }

export interface View {
  request: PermissionRequest
  status: "identifying" | "unidentified" | "analyzing" | "complete" | "unavailable" | "unrelated"
  assessment?: ReviewResult
  error?: string
  autoApproval?: AutoApproval
}

type Evaluate = (request: PermissionRequest, signal: AbortSignal, onIdentified: () => void) => Promise<ReviewResult | null>
interface Entry { view: View; abort: AbortController; cancelTimer?: () => void; deadline?: number; approvalAbort?: AbortController }

export interface ApprovalClock {
  now(): number
  after(ms: number, callback: () => void): () => void
}
const clock: ApprovalClock = {
  now: () => performance.now(),
  after: (ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) },
}
type Options = Pick<Config, "reviewBash" | "reviewEdits"> & Partial<Pick<Config, "autoApprove" | "autoApproveDelaySeconds">>
export interface Approval extends ApprovalTransport {
  /** Recompute actual presentation/order, rather than trusting a stale UI effect. */
  visibleID(): string | undefined
}

/** Reviews remain advisory unless explicitly configured with a once-only writer. */
export class Controller {
  private entries = new Map<string, Entry>()
  private stopped = false
  private version = 0
  private visibleID: string | undefined
  constructor(private evaluate: Evaluate, private changed: (views: View[]) => void,
    private options: Options = { reviewBash: true, reviewEdits: true },
    private approval?: Approval, private time: ApprovalClock = clock) {}
  get revision() { return this.version }
  get views() { return [...this.entries.values()].map((entry) => entry.view) }
  private publish() { if (!this.stopped) this.changed(this.views) }

  /** Called only after the assessment has actually been rendered, or to hide it. */
  presented(id?: string) {
    if (this.stopped) return
    if (id !== this.visibleID) {
      const old = this.visibleID
      this.visibleID = id
      if (old) this.cancelAutoApproval(old)
    }
    const entry = id ? this.entries.get(id) : undefined
    if (!entry || entry.view.autoApproval || !this.eligible(entry)) return
    entry.deadline = this.time.now() + (this.options.autoApproveDelaySeconds ?? 15) * 1000
    entry.view = { ...entry.view, autoApproval: { status: "countdown", seconds: this.options.autoApproveDelaySeconds ?? 15 } }
    this.publish()
    // Even zero delay goes through the same cancellable single-flight path.
    this.schedule(entry)
  }

  cancelAutoApproval(id: string) {
    const entry = this.entries.get(id)
    if (!entry || !["countdown", "checking"].includes(entry.view.autoApproval?.status ?? "")) return
    entry.cancelTimer?.()
    entry.cancelTimer = undefined
    entry.approvalAbort?.abort()
    entry.view = { ...entry.view, autoApproval: { status: "cancelled" } }
    this.publish()
  }

  private active(entry: Entry) {
    return !this.stopped && !entry.abort.signal.aborted && this.entries.get(entry.view.request.id) === entry
  }

  private eligible(entry: Entry) {
    return this.active(entry) && this.options.autoApprove === true && entry.view.status === "complete"
      && entry.view.assessment?.safe === true && this.visibleID === entry.view.request.id
      && this.approval?.visibleID() === entry.view.request.id
  }

  private schedule(entry: Entry) {
    if (!this.active(entry) || entry.view.autoApproval?.status !== "countdown") return
    const remaining = Math.max(0, entry.deadline! - this.time.now())
    entry.cancelTimer = this.time.after(Math.min(1000, remaining), () => {
      entry.cancelTimer = undefined
      if (!this.active(entry) || entry.view.autoApproval?.status !== "countdown") return
      if (!this.eligible(entry)) { this.cancelAutoApproval(entry.view.request.id); return }
      const seconds = Math.max(0, Math.ceil((entry.deadline! - this.time.now()) / 1000))
      if (seconds === 0) { void this.approveNow(entry.view.request.id); return }
      entry.view = { ...entry.view, autoApproval: { status: "countdown", seconds } }
      this.publish()
      this.schedule(entry)
    })
  }

  async approveNow(id: string) {
    const entry = this.entries.get(id)
    if (!entry || entry.view.autoApproval?.status !== "countdown" || !this.approval) return
    if (!this.eligible(entry)) { this.cancelAutoApproval(id); return }
    entry.cancelTimer?.()
    entry.cancelTimer = undefined
    entry.approvalAbort = new AbortController()
    entry.view = { ...entry.view, autoApproval: { status: "checking" } }
    this.publish()
    try {
      await withDeadline(AbortSignal.any([entry.abort.signal, entry.approvalAbort.signal]), 5000, async (signal) => {
        const revision = this.version
        const pending = await this.approval!.list(signal)
        signal.throwIfAborted()
        if (!this.eligible(entry)) { this.cancelAutoApproval(id); return }
        if (revision !== this.version) throw new Error("Pending permissions changed during verification")
        const current = pending.find((request) => request.id === id)
        if (!current) { this.replied(id); return }
        if (!isDeepStrictEqual(current, entry.view.request)) throw new Error("Pending request changed")
        this.reconcile(pending, revision)
        if (!this.eligible(entry)) { this.cancelAutoApproval(id); return }
        entry.view = { ...entry.view, autoApproval: { status: "allowing" } }
        this.publish()
        // Publishing can synchronously trigger native resolution or visibility loss.
        signal.throwIfAborted()
        if (!this.eligible(entry)) {
          entry.view = { ...entry.view, autoApproval: { status: "cancelled" } }
          this.publish()
          return
        }
        await this.approval!.once(entry.view.request, signal)
        signal.throwIfAborted()
        this.replied(id)
      })
    } catch {
      // A native reply may abort our in-flight HTTP response after accepting it.
      if (!this.active(entry) || entry.view.autoApproval?.status === "cancelled") return
      entry.view = { ...entry.view, autoApproval: { status: "failed" } }
      this.publish()
      // Reconcile an uncertain outcome, without ever retrying the write.
      const revision = this.version
      try {
        const pending = await withDeadline(entry.abort.signal, 5000, (signal) => this.approval!.list(signal))
        this.reconcile(pending, revision)
      } catch { /* Periodic read-only reconciliation remains active. */ }
    }
  }

  asked(request: PermissionRequest) {
    if (this.stopped || this.entries.has(request.id)) return
    this.version++
    const enabled = request.permission === "edit" ? this.options.reviewEdits
      : (request.permission === "bash" || request.permission === "external_directory") && this.options.reviewBash
    const entry: Entry = {
      abort: new AbortController(),
      view: {
        request,
        status: !enabled ? "unrelated" : request.permission === "external_directory" ? "identifying" : "analyzing",
      },
    }
    this.entries.set(request.id, entry)
    this.publish()
    if (entry.view.status === "unrelated") return
    const active = () => !this.stopped && !entry.abort.signal.aborted && this.entries.get(request.id) === entry
    void Promise.resolve().then(() => {
      entry.abort.signal.throwIfAborted()
      return this.evaluate(request, entry.abort.signal, () => {
        // A timed-out evaluator may still call back after its review has settled.
        if (active() && (entry.view.status === "identifying" || entry.view.status === "analyzing")) {
          entry.view = { ...entry.view, status: "analyzing" }; this.publish()
        }
      })
    }).then((assessment) => {
      if (active()) { entry.view = assessment ? { ...entry.view, status: "complete", assessment } : { ...entry.view, status: "unrelated" }; this.publish() }
    }, (error: unknown) => {
      if (active()) {
        entry.view = { ...entry.view, status: entry.view.status === "identifying" ? "unidentified" : "unavailable", error: error instanceof Error ? error.message : "Review failed" }
        this.publish()
      }
    })
  }

  replied(id: string) {
    if (this.stopped) return
    // Increment even for an unknown ID: an in-flight snapshot may still contain it.
    this.version++
    this.entries.get(id)?.cancelTimer?.()
    this.entries.get(id)?.abort.abort()
    if (this.entries.delete(id)) this.publish()
  }

  deleted(sessionID: string) {
    if (this.stopped) return
    // A startup snapshot may contain requests for a session not yet tracked here.
    this.version++
    for (const entry of this.entries.values()) if (entry.view.request.sessionID === sessionID) this.replied(entry.view.request.id)
  }

  /** Reject stale HTTP snapshots if permission events arrived during the request. */
  reconcile(requests: readonly PermissionRequest[], revision: number) {
    if (this.stopped || this.version !== revision) return
    const ids = new Set(requests.map((request) => request.id))
    for (const id of this.entries.keys()) if (!ids.has(id)) this.replied(id)
    for (const request of requests) this.asked(request)
  }

  dispose() {
    this.stopped = true
    for (const entry of this.entries.values()) { entry.cancelTimer?.(); entry.abort.abort() }
    this.entries.clear()
  }
}

/** Mirrors the documented session scope; host source confirms direct children. */
export function visibleReview(
  views: readonly View[],
  sessionID: string | undefined,
  getSession: (id: string) => { id: string; parentID?: string } | undefined,
): View | undefined {
  if (!sessionID) return
  const session = getSession(sessionID)
  if (!session || session.parentID) return
  let first: View | undefined
  for (const view of views) {
    const request = view.request
    if (request.sessionID !== sessionID && getSession(request.sessionID)?.parentID !== sessionID) continue
    // Match native code-unit ordering; hidden requests still participate in selection.
    if (!first || request.sessionID < first.request.sessionID ||
      (request.sessionID === first.request.sessionID && request.id < first.request.id)) first = view
  }
  return first && first.status !== "unrelated" && first.status !== "identifying" && first.status !== "unidentified" ? first : undefined
}

export function displayText(text: string): string {
  // Escape controls rather than letting source/model text issue terminal commands
  // or reorder the displayed rating through bidi controls.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
}
