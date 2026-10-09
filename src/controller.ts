import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import type { ReviewProgress, ReviewResult, ReviewTiming } from "./types.js"
import type { Config } from "./config.js"
import type { ApprovalTransport } from "./approval.js"
import { isDeepStrictEqual } from "node:util"
import { randomUUID } from "node:crypto"
import { withDeadline } from "./reviewer.js"
import { candidateEnabled, type ReviewOptions } from "./classification.js"
import type { SessionModeGate } from "./session-mode.js"
import { SCANNER_INTERVAL_MS } from "./appearance.js"
import { remainingTime, reviewStage } from "./deadline.js"
import { uiText } from "./ui-text.js"
import type { HistoryTarget } from "./history-records.js"

export type AutoApproval = { status: "countdown"; seconds: number } | { status: "checking" | "allowing" | "cancelled" | "failed" | "approved" }

export interface View {
  request: PermissionRequest
  status: "identifying" | "unidentified" | "analyzing" | "complete" | "unavailable" | "unrelated" | "suspended"
  assessment?: ReviewResult
  progress?: ReviewProgress
  error?: string
  autoApproval?: AutoApproval
  approvalPendingConfirmed?: boolean
  /** Fast-mode dispatched review retained independently of native permission lifetime. */
  retained?: boolean
  resolved?: boolean
}

type Evaluate = (request: PermissionRequest, signal: AbortSignal, onIdentified: () => void, onProgress: (progress: ReviewProgress) => void,
  execution?: { review: string; root?: string }) => Promise<ReviewResult | null>
interface Entry {
  view: View; abort: AbortController; root?: string; gateRevision: number
  suspension?: "mode" | "unavailable"
  cancelTimer?: () => void; deadline?: number; approvalAbort?: AbortController
  attempt: number; progressGeneration: number; pendingProgress?: ReviewProgress; cancelProgress?: () => void
  startedAt?: number; ratingAt?: number
  review: string
  approvalDispatched?: boolean
  approvalRefresh?: boolean
  fastApproval?: "pending" | "confirmed"
}

export interface ApprovalClock {
  now(): number
  after(ms: number, callback: () => void): () => void
}
const clock: ApprovalClock = {
  now: () => performance.now(),
  after: (ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) },
}
const permissionResolved = Object.freeze({ reason: "permission resolved" })
type Options = ReviewOptions & Partial<Pick<Config, "autoApprove" | "fastMode" | "autoApproveDelaySeconds" | "stream">>
export interface Approval extends ApprovalTransport {
  /** Recompute actual presentation/order, rather than trusting a stale UI effect. */
  visibleID(): string | undefined
}

export type ApprovalFact = { type: "dispatched" | "confirmed" | "settled"; request: PermissionRequest; automatic: boolean;
  approval?: string; review?: string; result?: "not-sent" | "uncertain" }
export type ApprovalObserver = (fact: ApprovalFact) => unknown
export type ReviewLifecycleFact =
  | { type: "accepted"; request: PermissionRequest; result: ReviewResult; timing: ReviewTiming; root?: string; review: string; completedAt: number }
  | { type: "cancelled"; request: PermissionRequest; reason: "explicit" | "visibility" | "mode" }
  | { type: "removed"; request: PermissionRequest; reason: "resolved" | "reconciled" | "deleted" | "disposed" }
export type ReviewLifecycleObserver = (fact: ReviewLifecycleFact) => unknown

/** Reviews remain advisory unless explicitly configured with a once-only writer. */
export class Controller {
  private entries = new Map<string, Entry>()
  private stopped = false
  private version = 0
  private visibleID: string | undefined
  private modeChanges = new Map<string, number>()
  private manual = new Map<string, "cancelled" | "failed">()
  private workers = new Set<Promise<unknown>>()
  private acknowledgements = new Map<AbortController, { request: PermissionRequest; root?: string }>()
  private approvalWorkers = new Set<Promise<unknown>>()
  private approvalRead?: Promise<PermissionRequest[]>
  constructor(private evaluate: Evaluate, private changed: (views: View[]) => void,
    private options: Options = { reviewBash: true, reviewEdits: true },
    private approval?: Approval, private time: ApprovalClock = clock, private modes?: SessionModeGate,
    private approvalObserver?: ApprovalObserver, private ratingObserver?: (safe: boolean, timing: ReviewTiming) => unknown,
    private lifecycleObserver?: ReviewLifecycleObserver) {}
  get revision() { return this.version }
  get views() { return [...this.entries.values()].map((entry) => entry.view) }
  get pendingViews() { return this.views.filter(view => !view.resolved) }
  retained(root: string, target: HistoryTarget) {
    const entry = this.entries.get(target.permission)
    return entry?.fastApproval === "confirmed" && entry.view.status === "analyzing"
      && entry.view.request.sessionID === target.session && entry.root === root ? entry.view : undefined
  }
  private publish() { if (!this.stopped) this.changed(this.views) }
  private approvalFact(fact: ApprovalFact) {
    if (this.stopped) return
    try { void Promise.resolve(this.approvalObserver?.(fact)).catch(() => {}) } catch {}
  }
  private lifecycleFact(fact: ReviewLifecycleFact) {
    try { void Promise.resolve(this.lifecycleObserver?.(fact)).catch(() => {}) } catch {}
  }

  /** Local state is already switched; invalidate snapshots before any publication. */
  modeChanged(root: string) {
    if (this.stopped) return
    this.modeChanges.set(root, ++this.version)
    for (const entry of this.entries.values()) if (entry.root === root) this.suspend(entry)
    this.publish()
  }

  private suspend(entry: Entry, reason: "mode" | "unavailable" = "mode") {
    // A dispatched fast approval cannot be unsent. Finish its acknowledgement and
    // assessment even if review is disabled while the POST is settling.
    if (entry.fastApproval) return
    const id = entry.view.request.id
    const state = entry.view.autoApproval?.status
    if (state === "countdown" || state === "checking" || (state === "allowing" && !entry.approvalDispatched))
      this.lifecycleFact({ type: "cancelled", request: entry.view.request, reason: "mode" })
    const uncertain = state === "failed" || (state === "allowing" && entry.approvalDispatched)
    if (state) this.manual.set(id, uncertain ? "failed" : "cancelled")
    entry.cancelTimer?.()
    this.clearProgress(entry)
    entry.approvalAbort?.abort()
    entry.abort.abort()
    entry.suspension = reason
    entry.view = { request: entry.view.request, status: "suspended",
      // Suspension hides the report, but cannot turn an uncertain/dispatched
      // approval into a confirmed manual wait. Read-only reconciliation still
      // owns that confirmation, and the existing tombstone still forbids retry.
      ...(uncertain ? { autoApproval: { status: "failed" as const },
        ...(state === "failed" && entry.view.approvalPendingConfirmed ? { approvalPendingConfirmed: true } : {}) } : {}),
    }
  }

  /** Normal mode requires final rendering; fast mode requires physical panel visibility. */
  presented(id?: string) {
    if (this.stopped) return
    if (id !== this.visibleID) {
      const old = this.visibleID
      this.visibleID = id
      if (old) this.cancelAutoApproval(old, "visibility")
    }
    const entry = id ? this.entries.get(id) : undefined
    if (!entry || entry.view.autoApproval || !this.eligible(entry)) return
    if (this.options.fastMode) {
      entry.view = { ...entry.view, autoApproval: { status: "checking" } }
      this.publish()
      void this.approveNow(entry.view.request.id, true)
      return
    }
    const seconds = this.options.autoApproveDelaySeconds ?? 15
    // Hold the configured starting number for one extra second so the first
    // rendered countdown value is observable. Zero remains an immediate attempt.
    entry.deadline = this.time.now() + (seconds + (seconds > 0 ? 1 : 0)) * 1000
    entry.view = { ...entry.view, autoApproval: { status: "countdown", seconds } }
    this.publish()
    // Even zero delay goes through the same cancellable single-flight path.
    this.schedule(entry)
  }

  cancelAutoApproval(id: string, reason: "explicit" | "visibility" = "explicit") {
    const entry = this.entries.get(id)
    if (!entry || entry.approvalDispatched || !["countdown", "checking", "allowing"].includes(entry.view.autoApproval?.status ?? "")) return
    this.lifecycleFact({ type: "cancelled", request: entry.view.request, reason })
    entry.cancelTimer?.()
    entry.cancelTimer = undefined
    entry.approvalAbort?.abort()
    this.manual.set(id, "cancelled")
    entry.view = { ...entry.view, autoApproval: { status: "cancelled" } }
    this.publish()
  }

  private active(entry: Entry) {
    return !this.stopped && !entry.abort.signal.aborted && this.entries.get(entry.view.request.id) === entry
  }

  private reviewing(entry: Entry) {
    return this.active(entry) && entry.view.status === "analyzing"
      && (!!entry.fastApproval || !this.modes || (entry.root !== undefined && this.modes.enabled(entry.root)
        && (this.modeChanges.get(entry.root) ?? 0) <= entry.gateRevision))
  }

  private clearProgress(entry: Entry) {
    entry.progressGeneration++
    entry.cancelProgress?.()
    entry.cancelProgress = undefined
    entry.pendingProgress = undefined
  }

  private progress(entry: Entry, value: ReviewProgress) {
    if (!this.reviewing(entry) || !Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.attempt < entry.attempt) return
    if (value.attempt > entry.attempt) {
      // Only an explicit attempt start can advance the generation. Delayed chunks
      // from an old attempt cannot restart it or clear a newer report.
      if (value.attempt !== entry.attempt + 1 || value.phase !== (value.attempt ? "retrying" : "evaluating")) return
      this.clearProgress(entry)
      entry.attempt = value.attempt
      entry.ratingAt = undefined
      entry.view = { ...entry.view, progress: { attempt: value.attempt, phase: value.phase } }
      this.publish()
      return
    }
    if (value.phase !== "streaming" || this.options.stream !== true) return
    if (!value.preview) {
      this.clearProgress(entry)
      entry.view = { ...entry.view, progress: { attempt: value.attempt, phase: value.phase } }
      this.publish()
      return
    }
    const preview = { ...(typeof value.preview.safe === "boolean" ? { safe: value.preview.safe } : {}),
      ...(typeof value.preview.desc === "string" ? { desc: value.preview.desc } : {}) }
    if (typeof preview.safe === "boolean" && entry.ratingAt === undefined) entry.ratingAt = this.time.now()
    entry.pendingProgress = { attempt: value.attempt, phase: "streaming", preview }
    if (preview.safe !== entry.view.progress?.preview?.safe) {
      const desc = entry.view.progress?.preview?.desc
      entry.view = { ...entry.view, progress: { attempt: value.attempt, phase: "streaming",
        preview: { ...(preview.safe === undefined ? {} : { safe: preview.safe }), ...(desc === undefined ? {} : { desc }) } } }
      this.publish() // Rating is immediate; text remains on the coalesced cadence.
      if (this.options.fastMode && preview.safe === true) this.presented(this.visibleID)
    }
    if (!this.reviewing(entry) || entry.cancelProgress || !entry.pendingProgress) return
    const generation = entry.progressGeneration
    const attempt = entry.attempt
    entry.cancelProgress = this.time.after(SCANNER_INTERVAL_MS, () => {
      if (!this.reviewing(entry) || entry.progressGeneration !== generation || entry.attempt !== attempt) return
      entry.cancelProgress = undefined
      const progress = entry.pendingProgress
      entry.pendingProgress = undefined
      if (progress) { entry.view = { ...entry.view, progress }; this.publish() }
    })
  }

  private eligible(entry: Entry) {
    const safe = entry.view.status === "complete" ? entry.view.assessment?.safe === true
      : this.options.fastMode === true && entry.view.status === "analyzing" && entry.view.progress?.preview?.safe === true
    return this.active(entry) && !entry.view.resolved && !entry.fastApproval && this.options.autoApprove === true && safe
      && (!this.modes || (entry.root !== undefined && this.modes.enabled(entry.root)))
      && this.visibleID === entry.view.request.id
      && this.approval?.visibleID() === entry.view.request.id
  }

  private schedule(entry: Entry) {
    if (!this.active(entry) || entry.view.autoApproval?.status !== "countdown") return
    const remaining = Math.max(0, entry.deadline! - this.time.now())
    entry.cancelTimer = this.time.after(Math.min(1000, remaining), () => {
      entry.cancelTimer = undefined
      if (!this.active(entry) || entry.view.autoApproval?.status !== "countdown") return
      if (!this.eligible(entry)) { this.cancelAutoApproval(entry.view.request.id, "visibility"); return }
      const seconds = Math.min(this.options.autoApproveDelaySeconds ?? 15,
        Math.max(0, Math.ceil((entry.deadline! - this.time.now()) / 1000)))
      if (seconds === 0) { void this.approveNow(entry.view.request.id, true); return }
      if (entry.view.autoApproval.seconds !== seconds) {
        entry.view = { ...entry.view, autoApproval: { status: "countdown", seconds } }
        this.publish()
      }
      this.schedule(entry)
    })
  }

  /** A deadline can stop waiting, but only actual list settlement frees the slot. */
  private async approvalList(signal: AbortSignal) {
    while (this.approvalRead) {
      await this.approvalRead.catch(() => {})
      reviewStage(signal, "Approval verification")
    }
    reviewStage(signal, "Approval verification")
    const read = this.approval!.list(signal)
    this.approvalRead = read
    try { return await read }
    finally { if (this.approvalRead === read) this.approvalRead = undefined }
  }

  async approveNow(id: string, automatic = false) {
    const entry = this.entries.get(id)
    if (!entry || !this.approval || entry.approvalRefresh || !(entry.view.autoApproval?.status === "countdown"
      || (this.options.fastMode && automatic && entry.view.autoApproval?.status === "checking" && !entry.approvalAbort))) return
    if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
    entry.cancelTimer?.()
    entry.cancelTimer = undefined
    entry.approvalAbort = new AbortController()
    entry.view = { ...entry.view, autoApproval: { status: "checking" } }
    this.publish()
    let dispatched = false
    let confirmed = false
    const approvalID = randomUUID()
    const fact = (type: ApprovalFact["type"]) => this.approvalFact({ type, request: entry.view.request, automatic,
      approval: approvalID, review: entry.review,
      ...(type === "settled" && !confirmed ? { result: dispatched ? "uncertain" as const : "not-sent" as const } : {}) })
    try {
      await withDeadline(AbortSignal.any([entry.abort.signal, entry.approvalAbort.signal]), 5000, async (signal) => {
        // Three sequential reads bound churn without accepting a stale snapshot
        // or replenishing the original five-second read/write budget.
        for (let reads = 0; reads < 3; reads++) {
          reviewStage(signal, "Approval verification")
          if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
          const revision = this.version
          const pending = await this.approvalList(signal)
          reviewStage(signal, "Approval verification")
          if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
          if (revision !== this.version) continue
          const current = pending.find((request) => request.id === id)
          if (!current) { this.replied(id, true, "reconciled"); return }
          if (!isDeepStrictEqual(current, entry.view.request)) throw new Error("Pending request changed")
          const verified = structuredClone(current)
          this.reconcile(pending, revision)
          const verifiedRevision = this.version
          if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
          // This is only a cancellable reservation. Publication may schedule
          // microtasks that change eligibility before the deferred write callback.
          entry.view = { ...entry.view, autoApproval: { status: "allowing" } }
          this.publish()
          const remaining = remainingTime(signal)
          const acknowledgement = new AbortController()
          const abort = () => { if (!dispatched || signal.reason !== permissionResolved) acknowledgement.abort(signal.reason) }
          signal.addEventListener("abort", abort, { once: true })
          if (signal.aborted) abort()
          const write = withDeadline(acknowledgement.signal, remaining, async (bounded) => {
            reviewStage(signal, "Approval verification")
            reviewStage(bounded, "Approval acknowledgement")
            if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
            if (verifiedRevision !== this.version) return
            if (!isDeepStrictEqual(verified, entry.view.request)) throw new Error("Pending request changed")
            reviewStage(signal, "Approval verification")
            reviewStage(bounded, "Approval acknowledgement")
            // No observer, publication or await may separate this guard and once.
            // Mark actual invocation first so synchronous native resolution inside
            // the transport keeps the same bounded acknowledgement/fast response.
            this.manual.set(id, "failed")
            dispatched = true
            entry.approvalDispatched = true
            if (this.options.fastMode && automatic) {
              entry.fastApproval = "pending"
              entry.view = { ...entry.view, retained: true }
            }
            this.acknowledgements.set(acknowledgement, { request: entry.view.request, root: entry.root })
            try {
              let response: Promise<void>
              try { response = this.approval!.once(entry.view.request, bounded) }
              finally { fact("dispatched") } // Even a synchronous throw is an invoked, uncertain write.
              await response
              if (!bounded.aborted) {
                confirmed = true
                if (entry.fastApproval && this.active(entry)) {
                  entry.fastApproval = "confirmed"
                  entry.view = { ...entry.view, resolved: true, autoApproval: { status: "approved" } }
                }
                fact("confirmed")
                if (entry.fastApproval && this.active(entry)) { this.publish(); this.finishFast(entry) }
              }
            } finally { fact("settled") }
          }).finally(() => {
            this.acknowledgements.delete(acknowledgement)
            signal.removeEventListener("abort", abort)
          })
          this.approvalWorkers.add(write)
          void write.then(() => this.approvalWorkers.delete(write), () => this.approvalWorkers.delete(write))
          await write
          signal.throwIfAborted()
          if (dispatched) { this.replied(id); return }
          if (!this.eligible(entry)) { this.cancelAutoApproval(id, "visibility"); return }
          entry.view = { ...entry.view, autoApproval: { status: "checking" } }
          this.publish()
        }
        // Exhausted stale snapshots are neither cancellation nor uncertain writes.
        // Stay silent until ordinary fresh reconciliation releases this reservation;
        // repeated frames/clicks cannot create an unbounded verification loop.
        if (this.active(entry)) {
          entry.approvalRefresh = true
          entry.view = { ...entry.view, autoApproval: { status: "checking" } }
          this.publish()
        }
      })
    } catch {
      // A native reply may abort our in-flight HTTP response after accepting it.
      if (!this.active(entry) || entry.view.autoApproval?.status === "cancelled") return
      if (entry.fastApproval) {
        entry.fastApproval = undefined
        if (entry.view.resolved) { this.replied(id); return }
        entry.view = { ...entry.view, retained: undefined }
      }
      this.manual.set(id, "failed")
      entry.view = { ...entry.view, autoApproval: { status: "failed" } }
      if (entry.root !== undefined && this.modes && !this.modes.enabled(entry.root)) this.suspend(entry)
      this.publish()
      // Reconcile an uncertain outcome, without ever retrying the write.
      if (this.approvalRead) return // Timeout is not physical list settlement.
      const revision = this.version
      try {
        const pending = await withDeadline(entry.abort.signal, 5000, (signal) => this.approvalList(signal))
        this.reconcile(pending, revision)
      } catch { /* Periodic read-only reconciliation remains active. */ }
    } finally { if (!dispatched) fact("settled") }
  }

  asked(request: PermissionRequest) {
    if (this.stopped || this.entries.has(request.id)) return
    this.version++
    const enabled = candidateEnabled(request, this.options)
    const entry: Entry = {
      abort: new AbortController(),
      review: randomUUID(),
      attempt: -1, progressGeneration: 0,
      gateRevision: this.version,
      view: {
        request,
        status: enabled ? "identifying" : "unrelated",
        ...(this.manual.has(request.id) ? { autoApproval: { status: this.manual.get(request.id)! } } : {}),
      },
    }
    this.entries.set(request.id, entry)
    this.publish()
    if (entry.view.status === "unrelated") return
    const active = () => !this.stopped && !entry.abort.signal.aborted && this.entries.get(request.id) === entry
    const worker = Promise.resolve().then(async () => {
      entry.abort.signal.throwIfAborted()
      if (this.modes) {
        try {
          const root = await this.modes.root(request.sessionID, entry.abort.signal)
          if (!active()) return null
          entry.root = root
          await this.modes.load(root, entry.abort.signal)
          if (!active()) return null
          if (!this.modes.enabled(root) || (this.modeChanges.get(root) ?? 0) > entry.gateRevision) {
            this.suspend(entry); this.publish(); return null
          }
        } catch {
          if (active()) { this.suspend(entry, "unavailable"); this.publish() }
          return null
        }
      }
      entry.startedAt = this.time.now()
      return this.evaluate(request, entry.abort.signal, () => {
        // A timed-out evaluator may still call back after its review has settled.
        if (active() && (entry.view.status === "identifying" || entry.view.status === "analyzing")) {
          entry.view = { ...entry.view, status: "analyzing" }; this.publish()
        }
      }, (progress) => this.progress(entry, progress), { review: entry.review, root: entry.root })
    }).then((assessment) => {
      this.clearProgress(entry)
      if (active()) {
        entry.view = assessment ? { ...entry.view, status: "complete", assessment, progress: undefined }
          : { ...entry.view, status: "unrelated", progress: undefined }
        // Count final accepted reviews, not previews, transport attempts or UI
        // publications. Accounting failures cannot affect review or approval.
        if (assessment) {
          try {
            const fullReportMs = Math.max(0, this.time.now() - entry.startedAt!)
            const ratingMs = entry.ratingAt === undefined ? fullReportMs : Math.max(0, entry.ratingAt - entry.startedAt!)
            this.lifecycleFact({ type: "accepted", request, result: assessment, timing: { fullReportMs, ratingMs },
              root: entry.root, review: entry.review, completedAt: Date.now() })
            void Promise.resolve(this.ratingObserver?.(assessment.safe, { fullReportMs, ratingMs })).catch(() => {})
          } catch {}
        }
        this.publish()
        this.finishFast(entry)
      }
    }, (error: unknown) => {
      this.clearProgress(entry)
      if (active()) {
        entry.view = { ...entry.view, status: entry.view.status === "identifying" ? "unidentified" : "unavailable", progress: undefined, error: error instanceof Error ? error.message : uiText.review.failed }
        this.publish()
        this.finishFast(entry)
      }
    })
    this.workers.add(worker)
    void worker.finally(() => this.workers.delete(worker))
  }

  replied(id: string, resolved = true, reason: "resolved" | "reconciled" = "resolved") {
    if (this.stopped) return
    // Increment even for an unknown ID: an in-flight snapshot may still contain it.
    this.version++
    this.entries.get(id)?.cancelTimer?.()
    const entry = this.entries.get(id)
    if (entry?.fastApproval && resolved) {
      entry.view = { ...entry.view, resolved: true }
      this.publish()
      this.finishFast(entry)
      return
    }
    if (entry) this.lifecycleFact({ type: "removed", request: entry.view.request, reason: resolved ? reason : "deleted" })
    if (entry) this.clearProgress(entry)
    this.entries.get(id)?.abort.abort(resolved ? permissionResolved : undefined)
    this.manual.delete(id)
    if (this.entries.delete(id)) this.publish()
  }

  private finishFast(entry: Entry) {
    if (!this.active(entry) || entry.fastApproval !== "confirmed" || entry.view.status === "analyzing") return
    entry.fastApproval = undefined
    this.replied(entry.view.request.id)
  }

  deleted(sessionID: string) {
    if (this.stopped) return
    // A startup snapshot may contain requests for a session not yet tracked here.
    this.version++
    for (const [abort, value] of this.acknowledgements)
      if (value.request.sessionID === sessionID || value.root === sessionID) abort.abort()
    for (const entry of this.entries.values()) if (entry.view.request.sessionID === sessionID || entry.root === sessionID) this.replied(entry.view.request.id, false)
  }

  /** Reject stale HTTP snapshots if permission events arrived during the request. */
  reconcile(requests: readonly PermissionRequest[], revision: number) {
    if (this.stopped || this.version !== revision) return
    const ids = new Set(requests.map((request) => request.id))
    for (const [id, entry] of this.entries) if (!ids.has(id) && !entry.view.resolved) this.replied(id, true, "reconciled")
    for (const request of requests) {
      const entry = this.entries.get(request.id)
      if (entry?.approvalRefresh && entry.view.autoApproval?.status === "checking") {
        entry.approvalRefresh = false
        entry.approvalAbort = undefined
        entry.view = { ...entry.view, autoApproval: undefined }
        this.publish()
      }
      if (entry?.view.autoApproval?.status === "failed" && !entry.view.approvalPendingConfirmed) {
        entry.view = { ...entry.view, approvalPendingConfirmed: true }
        this.publish()
      }
      if (entry && !entry.root) entry.gateRevision = this.version
      if (entry?.view.status === "suspended" && (entry.suspension === "unavailable" || !entry.root || this.modes?.enabled(entry.root))) {
        // A failed saved-mode read is unknown, not a cached disabled choice.
        // Only an accepted fresh snapshot may retry the gate, never enrichment directly.
        this.entries.delete(request.id)
      }
      this.asked(request)
    }
  }

  async dispose() {
    this.stopped = true
    for (const abort of this.acknowledgements.keys()) abort.abort()
    for (const entry of this.entries.values()) {
      this.lifecycleFact({ type: "removed", request: entry.view.request, reason: "disposed" })
      entry.cancelTimer?.(); this.clearProgress(entry); entry.abort.abort()
    }
    this.entries.clear()
    await Promise.allSettled([...this.workers])
    await Promise.allSettled([...this.approvalWorkers])
    this.manual.clear()
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
  let retained: View | undefined
  for (const view of views) {
    const request = view.request
    if (request.sessionID !== sessionID && getSession(request.sessionID)?.parentID !== sessionID) continue
    if (view.retained) { retained ??= view; continue }
    if (view.resolved) continue
    // Match native code-unit ordering; hidden requests still participate in selection.
    if (!first || request.sessionID < first.request.sessionID ||
      (request.sessionID === first.request.sessionID && request.id < first.request.id)) first = view
  }
  return retained ?? (first && first.status !== "unrelated" && first.status !== "identifying" && first.status !== "unidentified" && first.status !== "suspended" ? first : undefined)
}

export function displayText(text: string): string {
  // Escape controls rather than letting source/model text issue terminal commands
  // or reorder the displayed rating through bidi controls.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
}
