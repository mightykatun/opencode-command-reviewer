import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { uiText } from "./ui-text.js"
import type { View } from "./controller.js"
import type { NotificationConfig } from "./notification-config.js"
import { notificationClock, notificationText, type NotificationBackend, type NotificationClock,
  type NotificationHandle, type NotificationKind, type NotificationMessage, type NotificationInteraction } from "./notification-types.js"
import { withDeadline } from "./deadline.js"

interface Target { root: string; sessionID: string; title: string }
interface Banner { abort: AbortController; handle?: NotificationHandle; target: Target; expire?: () => void; reminder: boolean }
interface Pending {
  identity: NotificationInteraction
  target: Target
  phase: "waiting" | "attention"
  banner?: Banner
  message?: NotificationMessage
  blocking?: boolean
  reminder?: () => void
}

/** Absence of a countdown is not evidence of manual-only approval. A completed
 * Safe request can still be waiting for its native queue position or rendering. */
function permissionAttention(view: View, auto: boolean): "attention" | "unsafe" | undefined {
  if (view.status === "identifying" || view.status === "analyzing") return
  const state = view.autoApproval?.status
  if (state === "countdown" || state === "checking" || state === "allowing") return
  if (state === "failed" && !view.approvalPendingConfirmed) return
  if (view.status === "complete") {
    if (!view.assessment) return
    if (!view.assessment.safe) return "unsafe"
    if (!auto || state === "cancelled" || state === "failed") return "attention"
    return
  }
  // These are terminal no-report states, not an evaluation in progress.
  if (["unrelated", "unidentified", "unavailable", "suspended"].includes(view.status)) return "attention"
}

/** Event policy owns no host reads, desktop processes, permission writes or models. */
export class NotificationPolicy {
  private permissions = new Map<string, Pending>()
  private questions = new Map<string, Pending>()
  private seen = new Set<string>()
  private views = new Map<string, View>()
  private blockers = new Map<string, NotificationInteraction>()
  private banners = new Set<Banner>()
  private stopped = false
  private lastApprovalSound = -Infinity
  constructor(private config: NotificationConfig, private auto: boolean,
    private backend: NotificationBackend, private clock: NotificationClock = notificationClock) {}

  private remember(key: string) {
    if (this.seen.has(key)) return false
    if (this.seen.size >= 4096) this.seen.delete(this.seen.values().next().value!)
    this.seen.add(key)
    return true
  }
  permission(request: PermissionRequest, target: Target, fresh: boolean) {
    if (this.stopped || !this.config.notify || !this.remember(`permission:${request.id}`) || !fresh) return
    if (this.permissions.size >= 1024) return
    const entry: Pending = { identity: { kind: "permission", id: request.id }, target, phase: "waiting" }
    this.permissions.set(request.id, entry)
    this.select(entry)
  }
  question(id: string, target: Target, fresh: boolean) {
    if (this.stopped || !this.config.notify || !this.remember(`question:${id}`) || !fresh) return
    if (this.questions.size >= 1024) return
    const entry: Pending = { identity: { kind: "question", id }, target, phase: "waiting" }
    this.questions.set(id, entry)
    this.select(entry)
    this.attention(entry, "question")
  }
  /** Native queue identity, independent of route visibility and notification eligibility. */
  pending(blockers: ReadonlyMap<string, NotificationInteraction>) {
    if (this.stopped) return
    this.blockers = new Map(blockers)
    for (const entry of this.permissions.values()) this.select(entry)
    for (const entry of this.questions.values()) this.select(entry)
  }
  private select(entry: Pending) {
    const next = this.blockers.get(entry.target.root)
    const blocking = next?.kind === entry.identity.kind && next.id === entry.identity.id
    if (entry.identity.kind === "permission") {
      entry.blocking = blocking
      // Re-evaluate the latest outcome even on queue-only publications. Never
      // replay an assessment captured when this request first became pending.
      const view = this.views.get(entry.identity.id)
      if (view) this.update(view)
      else this.wait(entry)
      return
    }
    if (entry.blocking === blocking) return
    entry.blocking = blocking
    this.stopReminder(entry)
    // A reminder may still be preparing audio or waiting to reach the backend.
    // Losing the queue position invalidates that delivery, not just its timer.
    if (!blocking && entry.banner?.reminder) { this.withdraw(entry.banner); entry.banner = undefined }
    if (blocking) this.remind(entry)
  }
  private stopReminder(entry: Pending) { entry.reminder?.(); entry.reminder = undefined }
  private remind(entry: Pending) {
    const message = entry.message
    if (!entry.blocking || entry.phase !== "attention" || !message || !this.config.staleReminderSeconds || this.stopped) return
    let stopped = false, cancel: (() => void) | undefined
    // Seconds remain representable even for MAX_SAFE_INTEGER. Chunk long waits
    // below Node/Bun's signed 32-bit timer limit instead of overflowing to 1 ms.
    let remaining = this.config.staleReminderSeconds, at = this.clock.now()
    const schedule = () => { cancel = this.clock.after(Math.min(remaining * 1000, 2147483647), tick) }
    const tick = () => {
      if (stopped || this.stopped || !entry.blocking || entry.message !== message || entry.phase !== "attention") return
      const now = this.clock.now()
      remaining -= Math.max(0, now - at) / 1000; at = now
      if (remaining > 0) { schedule(); return }
      this.withdraw(entry.banner)
      entry.banner = this.dispatch({ ...message, title: uiText.notifications.reminder(message.title) }, entry.target, true)
      // No catch-up burst after a stalled event loop or suspended machine.
      remaining = this.config.staleReminderSeconds
      schedule()
    }
    entry.reminder = () => { stopped = true; cancel?.() }
    schedule()
  }
  private withdraw(banner?: Banner) {
    if (!banner) return
    banner.expire?.()
    banner.abort.abort()
    if (banner.handle) { try { void Promise.resolve(banner.handle.close()).catch(() => {}) } catch {} }
    this.banners.delete(banner)
  }
  private show(kind: NotificationKind, title: string, target: Target): Banner | undefined {
    if (this.banners.size >= 64) return
    const message = this.message(kind, title, target)
    return message ? this.dispatch(message, target) : undefined
  }
  private message(kind: NotificationKind, title: string, target: Target): NotificationMessage | undefined {
    if (this.stopped || !this.config.notify) return
    const controls = this.config.notifications[kind]
    let sound = this.config.notifySound && controls.sound
    if (kind === "approved" && sound) {
      sound = this.clock.now() - this.lastApprovalSound >= 2000
      if (sound) this.lastApprovalSound = this.clock.now()
    }
    if (!controls.banner && !sound) return
    return { kind, title, body: notificationText(target.title), sessionID: target.sessionID, banner: controls.banner, sound }
  }
  private dispatch(message: NotificationMessage, target: Target, reminder = false): Banner | undefined {
    if (this.stopped || this.banners.size >= 64) return
    const banner: Banner = { abort: new AbortController(), target, reminder }
    this.banners.add(banner)
    // Dispatch off the controller's publication stack; failures never propagate.
    void Promise.resolve().then(() => {
      if (banner.abort.signal.aborted || this.stopped) return
      return this.backend.show(message, banner.abort.signal)
    }).then((handle) => {
      banner.handle = handle
      if (banner.abort.signal.aborted || this.stopped) this.withdraw(banner)
      else if (!handle) { banner.expire?.(); this.banners.delete(banner) }
      else if (handle.closed) {
        const release = () => { banner.expire?.(); this.banners.delete(banner) }
        void handle.closed.then(release, release)
      }
    }).catch(() => this.withdraw(banner))
    // Bound non-persistent click ownership even on desktops ignoring expiry.
    const cancel = this.clock.after(120000, () => this.withdraw(banner))
    banner.expire = cancel
    banner.abort.signal.addEventListener("abort", cancel, { once: true })
    return banner
  }
  private attention(entry: Pending, kind: "attention" | "unsafe" | "question" = "attention") {
    if (entry.phase === "attention" && entry.message?.kind === kind) return
    this.stopReminder(entry)
    this.withdraw(entry.banner)
    entry.phase = "attention"
    entry.message = this.message(kind, uiText.notifications[kind], entry.target)
    entry.banner = entry.message ? this.dispatch(entry.message, entry.target) : undefined
    this.remind(entry)
  }
  private wait(entry: Pending) {
    this.stopReminder(entry)
    this.withdraw(entry.banner)
    entry.banner = undefined; entry.message = undefined; entry.phase = "waiting"
  }
  snapshot(views: readonly View[], blockers: ReadonlyMap<string, NotificationInteraction> = this.blockers) {
    if (this.stopped) return
    // Queue identity and outcomes must change together. Otherwise handing off
    // the queue could briefly notify from an older completed/manual snapshot.
    this.views = new Map(views.map((view) => [view.request.id, view]))
    this.blockers = new Map(blockers)
    for (const [id, entry] of this.permissions) {
      if (this.views.has(id)) this.select(entry)
      else this.resolved("permission", id)
    }
    for (const entry of this.questions.values()) this.select(entry)
  }
  private update(view: View) {
    const entry = this.permissions.get(view.request.id)
    if (!entry) return
    const kind = entry.blocking ? permissionAttention(view, this.auto) : undefined
    if (kind) this.attention(entry, kind)
    else this.wait(entry)
  }
  approved(request: PermissionRequest, target?: Target) {
    if (!this.remember(`approved:${request.id}`)) return
    const current = this.permissions.get(request.id)
    if (current || target) this.show("approved", uiText.notifications.approved, current?.target ?? target!)
  }
  resolved(kind: "permission" | "question", id: string) {
    const entries = kind === "permission" ? this.permissions : this.questions
    const entry = entries.get(id)
    if (entry) this.stopReminder(entry)
    this.withdraw(entry?.banner)
    entries.delete(id)
    this.remember(`${kind}:${id}`)
  }
  turn(kind: "error" | "ended", id: string, target: Target) {
    if (this.remember(`turn:${target.root}:${id}`)) this.show(kind, uiText.notifications[kind], target)
  }
  deleted(sessionID: string) {
    for (const banner of this.banners) if (banner.target.root === sessionID || banner.target.sessionID === sessionID) this.withdraw(banner)
    for (const [id, entry] of this.permissions) if (entry.target.root === sessionID || entry.target.sessionID === sessionID) this.resolved("permission", id)
    for (const [id, entry] of this.questions) if (entry.target.root === sessionID || entry.target.sessionID === sessionID) this.resolved("question", id)
  }
  dispose() {
    this.stopped = true
    for (const entry of [...this.permissions.values(), ...this.questions.values()]) this.stopReminder(entry)
    for (const banner of this.banners) this.withdraw(banner)
    this.permissions.clear(); this.questions.clear(); this.views.clear(); this.seen.clear(); this.blockers.clear()
    return withDeadline(new AbortController().signal, 5000, async () => { await this.backend.dispose() }).catch(() => {})
  }
}
