import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { uiText } from "./ui-text.js"
import type { View } from "./controller.js"
import type { NotificationConfig } from "./notification-config.js"
import { notificationClock, notificationText, type NotificationBackend, type NotificationClock,
  type NotificationHandle, type NotificationKind } from "./notification-types.js"
import { withDeadline } from "./deadline.js"

interface Target { root: string; sessionID: string; title: string }
interface Banner { abort: AbortController; handle?: NotificationHandle; target: Target; expire?: () => void }
interface Pending {
  target: Target
  phase: "waiting" | "attention" | "automatic"
  banner?: Banner
  grace?: () => void
}

/** Event policy owns no host reads, desktop processes, permission writes or models. */
export class NotificationPolicy {
  private permissions = new Map<string, Pending>()
  private questions = new Map<string, Pending>()
  private seen = new Set<string>()
  private views = new Map<string, View>()
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
    this.permissions.set(request.id, { target, phase: "waiting" })
    const view = this.views.get(request.id)
    if (view) this.update(view)
  }
  question(id: string, target: Target, fresh: boolean) {
    if (this.stopped || !this.config.notify || !this.remember(`question:${id}`) || !fresh) return
    if (this.questions.size >= 1024) return
    const entry: Pending = { target, phase: "waiting" }
    this.questions.set(id, entry)
    this.attention(entry)
  }
  private withdraw(banner?: Banner) {
    if (!banner) return
    banner.expire?.()
    banner.abort.abort()
    if (banner.handle) { try { void Promise.resolve(banner.handle.close()).catch(() => {}) } catch {} }
    this.banners.delete(banner)
  }
  private show(kind: NotificationKind, title: string, target: Target): Banner | undefined {
    if (this.stopped || !this.config.notify || this.banners.size >= 64) return
    const banner: Banner = { abort: new AbortController(), target }
    this.banners.add(banner)
    let sound = this.config.notifySound
    if (kind === "approved" && sound) {
      sound = this.clock.now() - this.lastApprovalSound >= 2000
      if (sound) this.lastApprovalSound = this.clock.now()
    }
    // Dispatch off the controller's publication stack; failures never propagate.
    void Promise.resolve().then(() => {
      if (banner.abort.signal.aborted || this.stopped) return
      return this.backend.show({ kind, title, body: notificationText(target.title), sessionID: target.sessionID, sound }, banner.abort.signal)
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
  private attention(entry: Pending) {
    entry.grace?.(); entry.grace = undefined
    if (entry.phase === "attention") return
    this.withdraw(entry.banner)
    entry.phase = "attention"
    entry.banner = this.show("attention", uiText.notifications.attention, entry.target)
  }
  snapshot(views: readonly View[]) {
    if (this.stopped) return
    this.views = new Map(views.map((view) => [view.request.id, view]))
    for (const [id] of this.permissions) {
      const view = this.views.get(id)
      if (view) this.update(view)
      else this.resolved("permission", id)
    }
  }
  private update(view: View) {
    const entry = this.permissions.get(view.request.id)
    if (!entry) return
    const state = view.autoApproval?.status
    if (state === "countdown" || state === "checking" || state === "allowing") {
      entry.grace?.(); entry.grace = undefined
      if (entry.phase !== "automatic") {
        this.withdraw(entry.banner)
        entry.phase = "automatic"
        entry.banner = undefined
      }
      return
    }
    if (state === "failed") {
      if (entry.phase !== "attention") { this.withdraw(entry.banner); entry.banner = undefined }
      if (view.approvalPendingConfirmed) this.attention(entry)
      return
    }
    if (state === "cancelled" || ["unrelated", "unidentified", "unavailable", "suspended"].includes(view.status)) {
      this.attention(entry); return
    }
    if (view.status !== "complete" || !view.assessment) return
    if (!this.auto || !view.assessment.safe) { this.attention(entry); return }
    if (entry.phase !== "waiting" || entry.grace) return
    entry.grace = this.clock.after(1000, () => {
      entry.grace = undefined
      if (this.permissions.get(view.request.id) !== entry || this.stopped) return
      const current = this.views.get(view.request.id)
      if (current?.status === "complete" && current.assessment?.safe && !current.autoApproval) this.attention(entry)
    })
  }
  approved(request: PermissionRequest, target?: Target) {
    if (!this.remember(`approved:${request.id}`)) return
    const current = this.permissions.get(request.id)
    if (current || target) this.show("approved", uiText.notifications.approved, current?.target ?? target!)
  }
  resolved(kind: "permission" | "question", id: string) {
    const entries = kind === "permission" ? this.permissions : this.questions
    const entry = entries.get(id)
    entry?.grace?.()
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
    for (const entry of this.permissions.values()) entry.grace?.()
    for (const banner of this.banners) this.withdraw(banner)
    this.permissions.clear(); this.questions.clear(); this.views.clear(); this.seen.clear()
    return withDeadline(new AbortController().signal, 5000, async () => { await this.backend.dispose() }).catch(() => {})
  }
}
