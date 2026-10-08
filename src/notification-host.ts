import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { ApprovalFact, View } from "./controller.js"
import type { NotificationPolicy } from "./notification-policy.js"
import { notificationClock, type NotificationClock } from "./notification-types.js"

type Target = { root: string; sessionID: string; title: string }
interface Request {
  sessionID: string
  received: number
  target?: Target
  root?: string
  resolving?: boolean
}
interface Root {
  since: number
  baselineUsers: Set<string>
  user?: string
  assistant?: Extract<Message, { role: "assistant" }>
  error?: { id: string; name: string }
  cancelled: boolean
  idle?: () => void
}
type HostApi = Pick<TuiPluginApi, "state" | "event" | "route" | "ui" | "lifecycle">

/** Public host bridge. Event births, not snapshots, establish new-request eligibility. */
export class NotificationHost {
  private roots = new Map<string, Root>()
  private visiting = new Map<string, number>()
  private permissions = new Map<string, Request>()
  private questions = new Map<string, Request>()
  private dispatched = new Map<string, { target: Target; automatic: boolean }>()
  private closed = new Set<string>()
  private views: readonly View[] = []
  private subscriptions: (() => void)[] = []
  private stopped = false
  private lookups = 0
  private ancestry = new Map<string, Promise<string>>()
  private sequence = 0
  private recentMessages = new Map<string, { message: Message; received: number }>()
  private created = new Map<string, number>()
  private deletedSessions = new Set<string>()
  constructor(private api: HostApi, private policy: NotificationPolicy,
    private resolveRoot: (id: string, signal: AbortSignal) => Promise<string>,
    private clock: NotificationClock = notificationClock) {
    const on = api.event.on
    this.subscriptions.push(
      on("permission.asked", e => this.asked("permission", e.properties)),
      on("question.asked", e => this.asked("question", e.properties)),
      on("permission.replied", e => this.resolved("permission", e.properties.requestID)),
      on("question.replied", e => this.resolved("question", e.properties.requestID)),
      on("question.rejected", e => this.resolved("question", e.properties.requestID)),
      on("session.deleted", e => this.deleted(e.properties.info.id)),
      on("message.updated", e => this.message(e.properties.info)),
      on("session.error", e => {
        const id = e.properties.sessionID
        if (!id) return
        const root = this.roots.get(id)
        if (!root) return // Recoverable child failures are not root failures.
        root.error = { id: e.id, name: e.properties.error?.name ?? "UnknownError" }
        if (root.error.name === "MessageAbortedError") root.cancelled = true
        this.idle(id)
      }),
      on("session.status", e => {
        const root = this.roots.get(e.properties.sessionID)
        if (!root) return
        root.idle?.(); root.idle = undefined
        if (e.properties.status.type === "idle") this.idle(e.properties.sessionID)
      }),
      on("session.idle", e => this.idle(e.properties.sessionID)),
      on("session.created", e => {
        if (this.created.size >= 1024) this.created.delete(this.created.keys().next().value!)
        this.created.set(e.properties.info.id, ++this.sequence)
        for (const [id, request] of this.permissions) this.admit("permission", id, request)
        for (const [id, request] of this.questions) this.admit("question", id, request)
      }),
    )
  }
  private rootOf(id: string): string | undefined {
    const seen = new Set<string>()
    for (let edge = 0; edge <= 16; edge++) {
      if (seen.has(id)) return
      seen.add(id)
      const session = this.api.state.session.get(id)
      if (!session) return
      if (!session.parentID) return id
      id = session.parentID
    }
  }
  private lookup(id: string) {
    const pending = this.ancestry.get(id)
    if (pending) return pending
    if (this.lookups >= 2 || this.stopped) return
    this.lookups++
    const worker = Promise.resolve().then(() => this.resolveRoot(id, this.api.lifecycle.signal))
      .finally(() => { this.ancestry.delete(id); this.lookups-- })
    this.ancestry.set(id, worker)
    return worker
  }
  visit(id?: string) {
    if (!id || this.stopped || this.visiting.has(id)) return
    const since = ++this.sequence
    const root = this.rootOf(id)
    if (root) { this.track(root, since); return }
    const lookup = this.lookup(id)
    if (!lookup) return
    this.visiting.set(id, since)
    void lookup.then(root => {
      if (!this.stopped) this.track(root, since)
    }).catch(() => {}).finally(() => { this.visiting.delete(id) })
  }
  private track(id: string, since: number) {
    if (this.deletedSessions.has(id) || this.roots.has(id) || this.roots.size >= 256) return
    const messages = this.api.state.session.messages(id)
    const root: Root = { since, baselineUsers: new Set(messages.filter(m => m.role === "user").slice(-4096).map(m => m.id)), cancelled: false }
    this.roots.set(id, root)
    for (const { message, received } of this.recentMessages.values()) {
      if (message.sessionID !== id || received < (this.created.get(id) ?? since)) continue
      if (message.role === "user") root.baselineUsers.delete(message.id)
      this.message(message)
    }
    for (const [key, request] of this.permissions) this.admit("permission", key, request)
    for (const [key, request] of this.questions) this.admit("question", key, request)
  }
  private asked(kind: "permission" | "question", value: PermissionRequest | QuestionRequest) {
    if (this.stopped || this.closed.has(`${kind}:${value.id}`)) return
    const entries = kind === "permission" ? this.permissions : this.questions
    if (entries.has(value.id) || entries.size >= 1024) return
    const request: Request = { sessionID: value.sessionID, received: ++this.sequence }
    entries.set(value.id, request)
    this.admit(kind, value.id, request)
    // State may already contain a new event's value, but only its event birth
    // authorizes a notification. Startup snapshot-only requests never enter here.
  }
  private admit(kind: "permission" | "question", id: string, request: Request) {
    if (request.target || this.stopped) return
    const rootID = request.root ?? this.rootOf(request.sessionID)
    if (!rootID) {
      if (request.resolving) return
      const lookup = this.lookup(request.sessionID)
      if (!lookup) return
      request.resolving = true
      void lookup.then(root => {
        const entries = kind === "permission" ? this.permissions : this.questions
        if (this.stopped || entries.get(id) !== request) return
        request.root = root
        this.admit(kind, id, request)
      }).catch(() => {}).finally(() => { request.resolving = false })
      return
    }
    const root = this.roots.get(rootID)
    if (!root || request.received < root.since) return
    const target = { root: rootID, sessionID: rootID, title: this.api.state.session.get(rootID)?.title ?? "OpenCode session" }
    request.target = target
    if (kind === "question") this.policy.question(id, target, true)
    else {
      const view = this.views.find(v => v.request.id === id)
      // permission event precedes controller publication in the TUI bridge.
      const value = view?.request ?? this.api.state.session.permission(request.sessionID).find(p => p.id === id)
      if (value) this.policy.permission(value, target, true)
      else request.target = undefined
    }
  }
  snapshot(views: readonly View[]) {
    if (this.stopped) return
    this.views = views
    for (const request of this.permissions.values()) if (request.target) {
      request.target.title = this.api.state.session.get(request.target.root)?.title ?? "OpenCode session"
    }
    this.policy.snapshot(views)
    for (const [id, request] of this.permissions) this.admit("permission", id, request)
    const pending = new Set(views.map(v => v.request.id))
    for (const [id] of this.permissions) if (!pending.has(id)) this.resolved("permission", id)
  }
  fact(fact: ApprovalFact) {
    if (this.stopped) return
    if (fact.type === "dispatched") {
      const target = this.permissions.get(fact.request.id)?.target
      if (target && this.dispatched.size < 1024) this.dispatched.set(fact.request.id, { target, automatic: fact.automatic })
    } else if (fact.type === "confirmed") {
      const dispatched = this.dispatched.get(fact.request.id)
      this.dispatched.delete(fact.request.id)
      if (dispatched?.automatic) {
        dispatched.target.title = this.api.state.session.get(dispatched.target.root)?.title ?? "OpenCode session"
        this.policy.approved(fact.request, dispatched.target)
      }
    } else this.dispatched.delete(fact.request.id)
  }
  private resolved(kind: "permission" | "question", id: string) {
    ;(kind === "permission" ? this.permissions : this.questions).delete(id)
    const key = `${kind}:${id}`
    if (this.closed.size >= 4096) this.closed.delete(this.closed.values().next().value!)
    this.closed.add(key)
    this.policy.resolved(kind, id)
  }
  private message(message: Message) {
    if (this.stopped) return
    if (!this.recentMessages.has(message.id)) {
      if (this.recentMessages.size >= 1024) this.recentMessages.delete(this.recentMessages.keys().next().value!)
      this.recentMessages.set(message.id, { message, received: ++this.sequence })
    } else this.recentMessages.get(message.id)!.message = message
    const root = this.roots.get(message.sessionID)
    if (!root || this.stopped) return
    if (message.role === "user") {
      if (root.baselineUsers.has(message.id) || root.user === message.id) return
      root.baselineUsers.add(message.id)
      if (root.baselineUsers.size > 4096) root.baselineUsers.delete(root.baselineUsers.values().next().value!)
      root.user = message.id; root.assistant = undefined; root.error = undefined; root.cancelled = false
      root.idle?.(); root.idle = undefined
    } else if (!message.summary && message.parentID === root.user) {
      if (!root.assistant || message.id >= root.assistant.id) root.assistant = message
      if (message.error?.name === "MessageAbortedError") root.cancelled = true
    }
  }
  private idle(id: string) {
    const root = this.roots.get(id)
    if (!root || this.stopped) return
    root.idle?.()
    // Host failure can publish idle before assistant cleanup. Defer to public
    // final message state; repeated idle/status events coalesce into one check.
    root.idle = this.clock.after(100, () => {
      root.idle = undefined
      if (this.stopped || this.roots.get(id) !== root || this.api.state.session.status(id)?.type !== "idle") return
      if (root.cancelled) return
      const messages = this.api.state.session.messages(id)
      const assistant = messages.findLast(m => m.role === "assistant" && !m.summary && m.parentID === root.user)
      if (assistant?.role === "assistant") root.assistant = assistant
      if (root.assistant?.error?.name === "MessageAbortedError" || root.error?.name === "MessageAbortedError") return
      if (this.views.some(v => this.rootOf(v.request.sessionID) === id)
        || [...this.questions.values()].some(q => this.rootOf(q.sessionID) === id)
        || this.api.state.session.question(id).length || this.api.state.session.permission(id).length) return
      const target = { root: id, sessionID: id, title: this.api.state.session.get(id)?.title ?? "OpenCode session" }
      const message = root.assistant
      if (message?.error || (root.error && (!message?.time.completed || !message.finish || message.finish === "error"))) {
        this.policy.turn("error", root.user ?? root.error!.id, target)
      } else if (root.user && message?.time.completed && message.finish && !["tool-calls", "unknown", "error"].includes(message.finish)) {
        this.policy.turn("ended", root.user, target)
      }
    })
  }
  click(sessionID: string) {
    if (this.stopped || this.deletedSessions.has(sessionID) || this.api.ui.dialog.open || !this.api.state.session.get(sessionID)) return
    this.api.route.navigate("session", { sessionID })
  }
  private deleted(id: string) {
    if (this.deletedSessions.size >= 4096) this.deletedSessions.delete(this.deletedSessions.values().next().value!)
    this.deletedSessions.add(id)
    this.roots.get(id)?.idle?.(); this.roots.delete(id)
    this.created.delete(id)
    for (const [key, request] of this.permissions) if (request.sessionID === id || request.target?.root === id) this.resolved("permission", key)
    for (const [key, request] of this.questions) if (request.sessionID === id || request.target?.root === id) this.resolved("question", key)
    for (const [key, dispatch] of this.dispatched) if (dispatch.target.root === id || dispatch.target.sessionID === id) this.dispatched.delete(key)
    this.policy.deleted(id)
  }
  dispose() {
    this.stopped = true
    for (const stop of this.subscriptions) stop()
    for (const root of this.roots.values()) root.idle?.()
    this.roots.clear(); this.permissions.clear(); this.questions.clear(); this.dispatched.clear(); this.closed.clear(); this.recentMessages.clear(); this.created.clear()
    this.deletedSessions.clear()
    return this.policy.dispose()
  }
}
