import { test } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import type { Event, Message, Session, PermissionRequest } from "@opencode-ai/sdk/v2"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { NotificationHost } from "../src/notification-host.js"
import { NotificationPolicy } from "../src/notification-policy.js"
import type { NotificationMessage } from "../src/notification-types.js"
import type { View } from "../src/controller.js"

const request = (id = "p", sessionID = "root"): PermissionRequest => ({ id, sessionID, permission: "bash", patterns: [], always: [], metadata: {} })
function fixture(resolve: (id: string) => Promise<string> = async id => id) {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const sessions = new Map<string, { id: string; parentID?: string; title: string }>([
    ["root", { id: "root", title: "Root title" }], ["child", { id: "child", parentID: "root", title: "Child" }],
    ["deep", { id: "deep", parentID: "child", title: "Deep" }], ["other", { id: "other", title: "Other" }],
  ])
  const messages = new Map<string, Message[]>(), pending = new Map<string, PermissionRequest[]>()
  const banners: NotificationMessage[] = [], navigated: string[] = []
  const timers = new Set<() => void>()
  let now = 1, dialog = false, status: "idle" | "busy" | "retry" = "idle"
  const clock = { now: () => now, after(_ms: number, callback: () => void) { timers.add(callback); return () => { timers.delete(callback) } } }
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
    route: { navigate(_name: string, params: { sessionID: string }) { navigated.push(params.sessionID) } },
    ui: { dialog: { get open() { return dialog } } }, lifecycle: { signal: new AbortController().signal },
  } as unknown as TuiPluginApi
  const policy = new NotificationPolicy({ notify: true, notifySound: false }, true, {
    async show(message) { banners.push(message); return { close() {} } }, dispose() {},
  }, clock)
  const host = new NotificationHost(api, policy, resolve, clock)
  function emit(type: string, properties: unknown, id = "event") {
    for (const listener of listeners.get(type) ?? []) listener({ type, properties, id } as Event)
  }
  function message(value: Partial<Message> & { role: Message["role"]; id: string }, sessionID = "root") {
    const m = { sessionID, time: { created: 1 }, ...value } as Message
    const list = messages.get(sessionID) ?? []
    const index = list.findIndex(v => v.id === m.id)
    if (index < 0) list.push(m); else list[index] = m
    messages.set(sessionID, list); emit("message.updated", { info: m })
  }
  return { host, policy, banners, navigated, listeners, sessions, pending, emit, message,
    dialog: (value: boolean) => { dialog = value }, status: (value: typeof status) => { status = value },
    async tick() { now++; for (const callback of [...timers]) if (timers.delete(callback)) callback(); await settle() } }
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
  assert.equal(f.banners[1]?.body, "Root title"); assert.equal(f.banners[1]?.sessionID, "root")
  f.emit("question.asked", { id: "deep-question", sessionID: "deep", questions: [] }); await settle()
  assert.equal(f.banners[2]?.sessionID, "root", "child routes have no native input prompts in the pinned host")
  f.emit("question.replied", { requestID: "new-question", sessionID: "child", answers: [] })
  f.emit("question.asked", { id: "new-question", sessionID: "child", questions: [] }); await settle()
  assert.equal(f.banners.length, 3); f.host.dispose()
})

test("request events arriving during root visitation survive asynchronous baseline registration", async () => {
  let release!: (value: string) => void
  const f = fixture(() => new Promise(resolve => { release = resolve }))
  f.sessions.delete("root"); f.host.visit("root")
  f.emit("question.asked", { id: "during-visit", sessionID: "root", questions: [] })
  await settle(); assert.equal(f.banners.length, 0)
  f.sessions.set("root", { id: "root", title: "Root title" }); release("root")
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
  f.host.dispose()
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
  assert.deepEqual(f.banners.map(m => m.kind), ["attention", "ended"])
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
