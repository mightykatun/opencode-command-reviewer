import { test } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import type { Event, Message, Session, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { NotificationHost } from "../src/notification-host.js"
import { NotificationPolicy } from "../src/notification-policy.js"
import { parseNotificationConfig } from "../src/notification-config.js"
import type { NotificationMessage } from "../src/notification-types.js"
import type { HistoryTarget } from "../src/history-records.js"
import type { View } from "../src/controller.js"

const request = (id = "p", sessionID = "root"): PermissionRequest => ({ id, sessionID, permission: "bash", patterns: [], always: [], metadata: {} })
function fixture(resolve: (id: string) => Promise<string> = async id => id, options: Record<string, unknown> = {},
  readQuestions?: (signal: AbortSignal) => Promise<readonly QuestionRequest[]>) {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const sessions = new Map<string, { id: string; parentID?: string; title: string }>([
    ["root", { id: "root", title: "Root title" }], ["child", { id: "child", parentID: "root", title: "Child" }],
    ["deep", { id: "deep", parentID: "child", title: "Deep" }], ["other", { id: "other", title: "Other" }],
  ])
  const messages = new Map<string, Message[]>(), pending = new Map<string, PermissionRequest[]>()
  const banners: NotificationMessage[] = [], navigated: string[] = []
  const opened: { sessionID: string; history: HistoryTarget }[] = []
  const timers = new Set<{ at: number; callback: () => void }>()
  let now = 1, dialog = false, status: "idle" | "busy" | "retry" = "idle"
  let current = "root"
  const clock = { now: () => now, after(ms: number, callback: () => void) {
    const timer = { at: now + ms, callback }; timers.add(timer); return () => { timers.delete(timer) }
  } }
  const api = {
    event: { on(type: string, handler: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
      return () => { listeners.get(type)!.delete(handler) }
    } },
    state: { session: {
      get: (id: string) => sessions.get(id) as Session | undefined,
      messages: (id: string) => messages.get(id) ?? [],
      permission: (id: string) => pending.get(id) ?? [],
      question: () => [], status: () => ({ type: status }),
    } },
    route: { get current() { return { name: "session", params: { sessionID: current } } },
      navigate(_name: string, params: { sessionID: string }) { current = params.sessionID; navigated.push(params.sessionID) } },
    ui: { dialog: { get open() { return dialog } } }, lifecycle: { signal: new AbortController().signal },
  } as unknown as TuiPluginApi
  const questions = new Map<string, { id: string; sessionID: string; questions: [] }>()
  const policy = new NotificationPolicy(parseNotificationConfig({ notifySound: false, staleReminderSeconds: 0, ...options }), true, {
    async show(message) { banners.push(message); return { close() {} } }, dispose() {},
  }, clock)
  const host = new NotificationHost(api, policy, resolve, readQuestions ?? (async () => [...questions.values()]), clock,
    (sessionID, history) => opened.push({ sessionID, history }))
  function emit(type: string, properties: unknown, id = "event") {
    const value = properties as { id: string; sessionID: string; questions: []; requestID: string }
    if (type === "question.asked") questions.set(value.id, value)
    if (type === "question.replied" || type === "question.rejected") questions.delete(value.requestID)
    for (const listener of listeners.get(type) ?? []) listener({ type, properties, id } as Event)
  }
  function message(value: Partial<Message> & { role: Message["role"]; id: string }, sessionID = "root") {
    const m = { sessionID, time: { created: 1 }, ...value } as Message
    const list = messages.get(sessionID) ?? []
    const index = list.findIndex(v => v.id === m.id)
    if (index < 0) list.push(m); else list[index] = m
    messages.set(sessionID, list); emit("message.updated", { info: m })
  }
  async function advance(ms: number) {
    now += ms
    for (const timer of [...timers]) if (timer.at <= now && timers.delete(timer)) timer.callback()
    await settle()
  }
  return { host, policy, banners, navigated, opened, listeners, sessions, pending, questions, timers, emit, message, advance,
    route: (session: string) => { current = session },
    dialog: (value: boolean) => { dialog = value }, status: (value: typeof status) => { status = value },
    tick: () => advance(2000) }
}

test("only event-born requests in visited roots notify; baseline snapshots and unrelated roots stay silent", async () => {
  const f = fixture(); f.host.visit("root")
  const old: View = { request: request("old"), status: "unavailable" }
  f.host.snapshot([old]); await settle(); assert.equal(f.banners.length, 0)
  f.emit("permission.asked", request("new"))
  f.host.snapshot([old, { request: request("new"), status: "unrelated" }]); await settle()
  assert.equal(f.banners.length, 1)
  f.emit("question.asked", { id: "unrelated", sessionID: "other", questions: [] })
  await settle(); assert.equal(f.banners.length, 1)
  f.host.visit("other"); await settle(); assert.equal(f.banners.length, 1)
  f.emit("question.asked", { id: "new-question", sessionID: "child", questions: [] }); await settle()
  assert.equal(f.banners.length, 1, "questions wait behind all native permissions")
  for (const requestID of ["new", "old"]) f.emit("permission.replied", { requestID, sessionID: "root", reply: "once" })
  f.host.snapshot([]); await settle()
  assert.equal(f.banners[1]?.body, "Root title"); assert.equal(f.banners[1]?.sessionID, "root")
  f.emit("question.asked", { id: "deep-question", sessionID: "deep", questions: [] }); await settle()
  assert.equal(f.banners.length, 2, "deep descendants have no native root input prompt in the pinned host")
  f.emit("question.replied", { requestID: "new-question", sessionID: "child", answers: [] })
  f.emit("question.asked", { id: "new-question", sessionID: "child", questions: [] }); await settle()
  assert.equal(f.banners.length, 2); f.host.dispose()
})

test("request events arriving during root visitation survive asynchronous baseline registration", async () => {
  let release!: (value: string) => void
  const f = fixture(() => new Promise(resolve => { release = resolve }))
  f.sessions.delete("root"); f.host.visit("root")
  f.emit("question.asked", { id: "during-visit", sessionID: "root", questions: [] })
  await settle(); assert.equal(f.banners.length, 0)
  f.sessions.set("root", { id: "root", title: "Root title" }); release("root")
  await f.tick()
  await settle(); assert.equal(f.banners.length, 1)
  assert.equal(f.banners[0]?.body, "Root title"); f.host.dispose()
})

test("zero-delay confirmation retains dispatched attribution after native resolution; manual footer stays silent", async () => {
  const f = fixture(); f.host.visit("root")
  for (const automatic of [true, false]) {
    const req = request(automatic ? "automatic" : "manual")
    f.emit("permission.asked", req); f.host.snapshot([{ request: req, status: "complete", assessment: { safe: true, desc: "fixture" }, autoApproval: { status: "allowing" } }])
    f.host.fact({ type: "dispatched", request: req, automatic })
    f.emit("permission.replied", { requestID: req.id, sessionID: "root", reply: "once" })
    f.host.snapshot([])
    f.host.fact({ type: "confirmed", request: req, automatic })
    f.host.fact({ type: "settled", request: req, automatic })
  }
  await settle(); assert.deepEqual(f.banners.map(m => m.title), ["Reviewer approved a permission"])
  assert.deepEqual(f.banners[0]?.history, { session: "root", permission: "automatic" })
  f.host.dispose()
})

test("approval notifications retain each child's permission target after native resolution", async () => {
  const f = fixture(); f.host.visit("root")
  for (const session of ["root", "child", "deep"]) {
    const req = request("approved-" + session, session)
    f.emit("permission.asked", req)
    f.host.snapshot([{ request: req, status: "complete", assessment: { safe: true, desc: "fixture" } }])
    f.host.fact({ type: "dispatched", request: req, automatic: true })
    f.emit("permission.replied", { requestID: req.id, sessionID: session, reply: "once" })
    f.host.snapshot([])
    f.host.fact({ type: "confirmed", request: req, automatic: true })
  }
  await settle()
  assert.deepEqual(f.banners.map(m => [m.sessionID, m.history]), ["root", "child", "deep"].map(session =>
    ["root", { session, permission: "approved-" + session }]))
  const first = f.banners[0]!
  f.host.click(first.sessionID, first.history)
  assert.deepEqual(f.opened, [{ sessionID: "root", history: { session: "root", permission: "approved-root" } }])
  f.host.dispose()
})

test("latest approval click waits for dialogs, keeps its own target, and opens once", async () => {
  const f = fixture(); f.dialog(true)
  f.host.click("root", { session: "child", permission: "old" })
  const staleClick = [...f.timers].find(timer => timer.at === 101)!
  await f.advance(1000)
  assert.deepEqual(f.navigated, []); assert.deepEqual(f.opened, [])
  const target = { session: "other", permission: "new" }
  f.host.click("other", target); target.permission = "mutated"
  f.dialog(false); staleClick.callback(); assert.deepEqual(f.navigated, [])
  await f.advance(100)
  assert.deepEqual(f.navigated, ["other"])
  assert.deepEqual(f.opened, [{ sessionID: "other", history: { session: "other", permission: "new" } }])
  await f.advance(1000); assert.equal(f.opened.length, 1)
  f.host.dispose()
})

test("deleted roots/children, route changes, newer ordinary clicks, and disposal cancel deferred history navigation", async () => {
  for (const action of ["root", "child", "route", "ordinary", "dispose"]) {
    const f = fixture(); f.dialog(true)
    f.host.click("root", { session: "child", permission: "p" })
    if (action === "dispose") f.host.dispose()
    else if (action === "route") f.route("other")
    else if (action === "ordinary") f.host.click("other")
    else f.emit("session.deleted", { info: { id: action } })
    f.dialog(false); await f.advance(1000)
    assert.deepEqual(f.navigated, []); assert.deepEqual(f.opened, [])
    f.host.dispose()
  }
})

test("root completion requires a new turn and final message; retries, question pauses, tool steps and children stay silent", async () => {
  const f = fixture()
  f.message({ id: "old", role: "user" }); f.host.visit("root")
  f.emit("session.idle", { sessionID: "root" }); await f.tick(); assert.equal(f.banners.length, 0)
  f.message({ id: "user", role: "user" })
  f.status("busy"); f.emit("session.status", { sessionID: "root", status: { type: "busy" } })
  f.message({ id: "a1", role: "assistant", parentID: "user", finish: "tool-calls", time: { created: 2, completed: 3 } })
  f.status("idle"); f.emit("session.idle", { sessionID: "root" }); await f.tick(); assert.equal(f.banners.length, 0)
  f.emit("question.asked", { id: "q", sessionID: "root", questions: [] }); await settle()
  f.message({ id: "a2", role: "assistant", parentID: "user", finish: "stop", time: { created: 4, completed: 5 } })
  f.emit("session.idle", { sessionID: "root" }); await f.tick(); assert.equal(f.banners.length, 1)
  f.emit("question.replied", { requestID: "q", sessionID: "root", answers: [] })
  f.emit("session.idle", { sessionID: "root" }); await f.tick()
  f.emit("session.idle", { sessionID: "root" }); await f.tick()
  assert.deepEqual(f.banners.map(m => m.kind), ["question", "ended"])
  f.message({ id: "child-user", role: "user" }, "child")
  f.message({ id: "child-a", role: "assistant", parentID: "child-user", finish: "stop", time: { created: 6, completed: 7 } }, "child")
  f.emit("session.idle", { sessionID: "child" }); await f.tick(); assert.equal(f.banners.length, 2)
  f.host.dispose()
})

test("fatal errors notify once; aborted turns and recovered retry/overflow errors do not become failures", async () => {
  const f = fixture(); f.host.visit("root")
  f.message({ id: "u1", role: "user" })
  f.status("retry"); f.emit("session.error", { sessionID: "root", error: { name: "ContextOverflowError" } })
  await f.tick(); assert.equal(f.banners.length, 0)
  f.message({ id: "a1", role: "assistant", parentID: "u1", error: { name: "APIError" } } as never)
  f.status("idle"); f.emit("session.idle", { sessionID: "root" }); await f.tick()
  f.emit("session.idle", { sessionID: "root" }); await f.tick(); assert.equal(f.banners[0]?.kind, "error")
  f.message({ id: "u2", role: "user" })
  f.emit("session.error", { sessionID: "root", error: { name: "MessageAbortedError" } })
  f.emit("session.idle", { sessionID: "root" }); await f.tick(); assert.equal(f.banners.length, 1)
  f.message({ id: "u3", role: "user" })
  f.emit("session.error", { sessionID: "root", error: { name: "ContextOverflowError" } })
  f.message({ id: "a3", role: "assistant", parentID: "u3", finish: "stop", time: { created: 8, completed: 9 } })
  f.emit("session.idle", { sessionID: "root" }); await f.tick()
  assert.deepEqual(f.banners.map(m => m.kind), ["error", "ended"]); f.host.dispose()
})

test("click respects native dialogs and deleted targets; disposal removes event subscriptions", () => {
  const f = fixture(); f.host.visit("root")
  f.dialog(true); f.host.click("root"); assert.equal(f.navigated.length, 0)
  f.dialog(false); f.host.click("root"); assert.deepEqual(f.navigated, ["root"])
  f.host.click("missing"); assert.equal(f.navigated.length, 1)
  f.emit("session.deleted", { info: { id: "root" } })
  f.host.click("root"); assert.equal(f.navigated.length, 1, "deletion defeats stale public metadata")
  f.host.dispose(); f.host.click("root"); assert.equal(f.navigated.length, 1)
  assert.ok([...f.listeners.values()].every(set => !set.size))
})

test("native priority includes silent baseline blockers and hands reminders off after a full interval", async () => {
  const f = fixture(undefined, { staleReminderSeconds: 10 })
  f.questions.set("baseline", { id: "baseline", sessionID: "child", questions: [] })
  f.host.visit("root"); await settle()
  f.emit("question.asked", { id: "q", sessionID: "root", questions: [] }); await settle()
  await f.advance(10000)
  assert.equal(f.banners.length, 0, "an older child question blocks initial notifications and reminders without replay")
  f.emit("question.replied", { requestID: "baseline", sessionID: "child", answers: [] })
  await settle(); assert.equal(f.banners[0]?.title, "Agent has a question")
  await f.advance(9999); assert.equal(f.banners.length, 1)
  await f.advance(1); assert.equal(f.banners[1]?.title, "Agent has a question (Reminder)")
  const p = request("p")
  f.emit("permission.asked", p)
  f.host.snapshot([{ request: p, status: "complete", assessment: { safe: false, desc: "fixture" } }]); await settle()
  f.host.click("root"); f.host.visit("other")
  f.emit("question.asked", { id: "other", sessionID: "other", questions: [] }); await settle()
  await f.advance(10000)
  assert.deepEqual(f.banners.slice(-2).map(m => [m.kind, m.sessionID]), [["unsafe", "root"], ["question", "other"]])
  f.emit("permission.replied", { requestID: "p", sessionID: "root", reply: "once" }); f.host.snapshot([])
  f.emit("question.rejected", { requestID: "other", sessionID: "other" })
  await settle() // Returning to the front starts a new actionable question episode.
  const before = f.banners.length
  await f.advance(9999); assert.equal(f.banners.length, before)
  await f.advance(1); assert.equal(f.banners.at(-1)?.title, "Agent has a question (Reminder)")
  f.emit("session.deleted", { info: { id: "root" } })
  await f.advance(20000); assert.equal(f.banners.length, before + 1)
  await f.host.dispose(); assert.equal(f.timers.size, 0)
})

test("public question reconciliation stops missed resolutions, never admits baseline notifications", async () => {
  const f = fixture(undefined, { staleReminderSeconds: 10 })
  f.host.visit("root"); await settle()
  f.emit("question.asked", { id: "q", sessionID: "child", questions: [] }); await settle()
  await f.advance(10000); assert.equal(f.banners.length, 2)
  f.questions.delete("q") // Native resolution without the public event reaching this instance.
  await f.advance(2000)
  await f.advance(10000); assert.equal(f.banners.length, 2)
  f.questions.set("backlog", { id: "backlog", sessionID: "root", questions: [] })
  await f.advance(2000); await f.advance(10000); assert.equal(f.banners.length, 2)
  await f.host.dispose()
})

test("pending question reads retain ownership and event-raced results cannot resurrect resolved questions", async () => {
  let calls = 0, resolve!: (questions: QuestionRequest[]) => void
  const f = fixture(undefined, { staleReminderSeconds: 10 }, async () => {
    calls++
    return new Promise(yes => { resolve = yes })
  })
  f.host.visit("root"); await settle()
  f.emit("question.asked", { id: "q", sessionID: "root", questions: [] }); await settle()
  await f.advance(10000); assert.equal(calls, 1); assert.equal(f.banners.length, 0)
  f.emit("question.rejected", { requestID: "q", sessionID: "root" })
  resolve([{ id: "q", sessionID: "root", questions: [] }]); await settle()
  await f.advance(2000); assert.equal(calls, 2)
  await f.host.dispose()
  resolve([{ id: "q", sessionID: "root", questions: [] }]); await settle()
  await f.advance(10000); assert.equal(f.banners.length, 0); assert.equal(f.timers.size, 0)
})

test("question read outages withdraw question delivery and recovery restarts the reminder interval", async () => {
  let fail = false
  const f = fixture(undefined, { staleReminderSeconds: 10 }, async () => {
    if (fail) throw new Error("public list unavailable")
    return [{ id: "q", sessionID: "root", questions: [] }]
  })
  f.host.visit("root"); f.host.visit("other"); await settle()
  f.emit("question.asked", { id: "q", sessionID: "root", questions: [] })
  const p = request("p", "other")
  f.emit("permission.asked", p); f.host.snapshot([{ request: p, status: "unavailable" }]); await settle()
  fail = true; await f.advance(2000)
  await f.advance(10000)
  assert.equal(f.banners.filter(m => m.kind === "question").length, 1)
  assert.equal(f.banners.filter(m => m.kind === "attention").length, 2)
  fail = false; await f.advance(2000)
  assert.equal(f.banners.filter(m => m.kind === "question").length, 2)
  await f.advance(9999); assert.equal(f.banners.filter(m => m.kind === "question").length, 2)
  await f.advance(1); assert.equal(f.banners.filter(m => m.kind === "question").length, 3)
  await f.host.dispose()
})

test("question deadline expiry retains the actual read slot through late settlement", async () => {
  let calls = 0, release!: (value: QuestionRequest[]) => void, signal!: AbortSignal
  const f = fixture(undefined, { staleReminderSeconds: 1 }, async current => {
    calls++; signal = current
    return new Promise(resolve => { release = resolve })
  })
  f.host.visit("root"); await settle()
  f.emit("question.asked", { id: "q", sessionID: "root", questions: [] }); await settle()
  await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
  await settle(); assert.equal(signal.aborted, true)
  await f.advance(10000); assert.equal(calls, 1); assert.equal(f.banners.length, 0)
  release([{ id: "q", sessionID: "root", questions: [] }]); await settle()
  await f.advance(2000); assert.equal(calls, 2)
  await f.host.dispose(); release([]); await settle()
  assert.equal(f.banners.length, 0); assert.equal(f.timers.size, 0)
})

test("host publishes queue and review outcomes atomically across a snapshot-only handoff", async () => {
  const f = fixture(undefined, { staleReminderSeconds: 1 })
  f.host.visit("root"); await settle()
  const a = request("a"), b = request("b")
  f.emit("permission.asked", a); f.emit("permission.asked", b)
  f.host.snapshot([{ request: a, status: "analyzing" }, { request: b, status: "complete", assessment: { safe: false, desc: "old report" } }])
  await f.advance(5000); assert.equal(f.banners.length, 0)
  // Reconciliation removes a as a new mode revision starts b's replacement review.
  f.host.snapshot([{ request: b, status: "identifying", autoApproval: { status: "cancelled" } }])
  await f.advance(5000); assert.equal(f.banners.length, 0)
  f.host.snapshot([{ request: b, status: "complete", assessment: { safe: true, desc: "replacement" }, autoApproval: { status: "cancelled" } }])
  await settle(); assert.deepEqual(f.banners.map(m => m.title), ["Session needs attention"])
  f.host.snapshot([{ request: b, status: "analyzing", autoApproval: { status: "cancelled" } }])
  await f.advance(5000); assert.equal(f.banners.length, 1)
  await f.host.dispose()
})
