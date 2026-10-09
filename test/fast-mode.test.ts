import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { setImmediate as settle } from "node:timers/promises"
import { DatabaseSync } from "node:sqlite"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Controller, visibleReview, type ApprovalFact } from "../src/controller.js"
import { parseConfig } from "../src/config.js"
import { HistoryCoordinator } from "../src/history-coordinator.js"
import { HistorySQL, type HistorySelection, type HistoryTotals } from "../src/history-schema.js"
import { encodeEvent, type HistoryEvent } from "../src/history-records.js"
import { NotificationPolicy } from "../src/notification-policy.js"
import type { NotificationMessage } from "../src/notification-types.js"
import type { ReviewProgress, ReviewResult } from "../src/types.js"

const request = (id = "a", sessionID = "root"): PermissionRequest => ({ id, sessionID, permission: "bash", patterns: [id], always: [], metadata: {} })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture(t: TestContext, options: Record<string, unknown> = {}) {
  const config = parseConfig({ baseURL: "https://example.com/v1", model: "fixture", stream: true, autoApprove: true,
    fastMode: true, autoApproveDelaySeconds: 999, notifySound: false, staleReminderSeconds: 0, ...options })
  const db = new DatabaseSync(":memory:"), sql = new HistorySQL(db)
  let sequence = 0, enabled = true, shown: string | undefined = "root", failedStorage = false
  const events: HistoryEvent[] = [], banners: NotificationMessage[] = [], facts: ApprovalFact[] = []
  const history = new HistoryCoordinator("/host", {
    admit: e => { if (failedStorage) return false; events.push(e); sql.apply("fixture", ++sequence, encodeEvent(e)); return true },
    query: q => Promise.resolve(sql.query(q)), onCommit: () => () => {},
  }, async () => "root")
  const target = { root: "root", sessionID: "root", title: "Fixture" }
  const policy = new NotificationPolicy(config, config.autoApprove, {
    show: async message => { banners.push(message); return { close() {} } }, dispose() {},
  })
  const workers = new Map<string, { signal: AbortSignal; progress: (p: ReviewProgress) => void;
    finish(safe?: boolean): void; fail(): void }>()
  let pending: PermissionRequest[] = []
  const writes: { request: PermissionRequest; signal: AbortSignal; ack: ReturnType<typeof deferred<void>> }[] = []
  let list: (signal: AbortSignal) => Promise<PermissionRequest[]> = async () => pending
  const controller: Controller = new Controller((req, signal, identify, progress, execution) => {
    const observer = history.observation(req, "shell", config, execution!)
    observer.observe!({ type: "dispatched", review: execution!.review, attempt: "one", retry: "initial" })
    const result = deferred<ReviewResult>()
    signal.addEventListener("abort", () => result.reject(Error("aborted")), { once: true })
    identify(); progress({ attempt: 0, phase: "evaluating" })
    workers.set(req.id, { signal, progress,
      finish(safe = true) {
        observer.observe!({ type: "finalized", review: execution!.review, attempt: "one", usage: { input: 10, output: 5 } })
        result.resolve({ safe, desc: "Complete " + req.id, usage: { input: 10, output: 5 },
          metadata: { review: execution!.review, kind: "shell", provider: config.baseURL, configuredModel: config.model } })
      },
      fail() { observer.observe!({ type: "finalized", review: execution!.review, attempt: "one", usage: { input: 10, output: 5 } }); result.reject(Error("invalid remainder")) },
    })
    return result.promise
  }, () => {
    const views = controller.pendingViews
    const first = pending[0]
    policy.snapshot(views, first ? new Map([["root", { kind: "permission", id: first.id }]]) : new Map())
  }, config, {
    visibleID: () => shown ? visibleReview(controller.views, shown, id => ({ id }))?.request.id : undefined,
    list: signal => list(signal),
    once: (req, signal) => { const ack = deferred<void>(); writes.push({ request: req, signal, ack }); return ack.promise },
  }, undefined, { root: async () => "root", load: async () => {}, enabled: () => enabled }, fact => {
    facts.push(fact); history.approval(fact)
    if (fact.type === "confirmed" && fact.automatic) policy.approved(fact.request, target)
  }, undefined, history.lifecycle)
  const ask = async (req: PermissionRequest) => {
    pending.push(req); policy.permission(req, target, true); controller.asked(req); await settle()
  }
  const resolved = (id = "a") => {
    pending = pending.filter(p => p.id !== id)
    history.reply({ requestID: id, sessionID: "root", reply: "once" })
    controller.replied(id)
  }
  t.after(async () => {
    for (const write of writes) write.ack.reject(Error("cleanup"))
    await controller.dispose(); history.dispose(); await policy.dispose(); sql.close()
  })
  await ask(request())
  controller.presented("a")
  return { controller, config, workers, writes, facts, events, banners, ask, resolved,
    rate: (safe = true, id = "a", attempt = 0) => workers.get(id)!.progress({ attempt, phase: "streaming", preview: { safe, desc: "Partial " + id } }),
    mode: (value: boolean) => { enabled = value; controller.modeChanged("root") },
    hide: () => { shown = undefined; controller.presented() },
    show: () => { shown = "root"; controller.presented(visibleReview(controller.views, "root", id => ({ id }))?.request.id) },
    list: (fn: typeof list) => { list = fn }, failStorage: () => { failedStorage = true },
    saved: () => sql.query({ type: "history", scope: "/host", root: "root" }) as HistorySelection,
    totals: () => (sql.query({ type: "totals" }) as HistoryTotals).totals,
  }
}

test("fast Safe dispatches once without countdown, retains response across resolution, and saves only after final acceptance", async t => {
  const f = await fixture(t)
  f.rate(); await settle()
  assert.equal(f.writes.length, 1)
  assert.equal(f.controller.views[0]?.assessment, undefined)
  assert.equal(f.saved().total, 0); assert.equal(f.totals().safe, 0)
  f.resolved(); assert.equal(f.workers.get("a")!.signal.aborted, false)
  assert.equal(f.controller.pendingViews.length, 0); assert.equal(f.controller.views.length, 1)
  assert.equal(f.banners.length, 0)
  f.writes[0]!.ack.resolve(); await settle()
  assert.equal(f.controller.views[0]?.autoApproval?.status, "approved")
  assert.equal(f.totals().activity.autoApproved, 1)
  assert.equal(f.saved().total, 0)
  assert.deepEqual(f.banners.map(m => [m.kind, m.history]), [["approved", { session: "root", permission: "a" }]])
  f.controller.reconcile([], f.controller.revision); f.rate(); f.show(); await settle()
  assert.equal(f.writes.length, 1)
  assert.equal(f.controller.retained("root", { session: "root", permission: "a" })?.request.id, "a")
  f.workers.get("a")!.finish(); await settle()
  assert.equal(f.controller.views.length, 0)
  assert.equal(f.controller.retained("root", { session: "root", permission: "a" }), undefined)
  assert.equal(f.saved().record?.payload.desc, "Complete a")
  assert.equal(f.saved().record?.outcome, "auto")
  assert.equal(f.totals().safe, 1); assert.equal(f.totals().requests, 1)
  assert.equal(f.events.filter(e => e.type === "permissionResolved").length, 1)
})

test("retained approved report stays ahead of the next permission without blocking native notification order", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.writes[0]!.ack.resolve(); await settle()
  await f.ask(request("b")); f.rate(true, "b"); f.show(); await settle()
  assert.equal(visibleReview(f.controller.views, "root", id => ({ id }))?.request.id, "a")
  assert.deepEqual(f.controller.pendingViews.map(v => v.request.id), ["b"])
  assert.equal(f.writes.length, 1); assert.deepEqual(f.banners.map(m => m.kind), ["approved"])
  f.workers.get("a")!.finish(); await settle(); f.show(); await settle()
  assert.equal(f.writes[1]?.request.id, "b")
  f.resolved("b"); f.writes[1]!.ack.resolve(); f.workers.get("b")!.finish(); await settle()
  assert.equal(f.saved().total, 2); assert.equal(f.controller.views.length, 0)
})

test("fast approval survives hidden UI and disable, continues retries, and can save a final Unsafe report", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.writes[0]!.ack.resolve(); await settle()
  f.hide(); f.mode(false)
  assert.equal(f.workers.get("a")!.signal.aborted, false)
  f.workers.get("a")!.progress({ attempt: 1, phase: "retrying" })
  f.rate(false, "a", 1); await settle()
  assert.equal(f.controller.views[0]?.progress?.preview?.safe, false)
  assert.equal(f.controller.views[0]?.autoApproval?.status, "approved")
  f.workers.get("a")!.finish(false); await settle()
  assert.equal(f.saved().record?.payload.safe, false); assert.equal(f.saved().record?.outcome, "auto")
  assert.equal(f.totals().unsafe, 1); assert.equal(f.totals().activity.autoApproved, 1)
  assert.deepEqual(f.banners.map(m => m.kind), ["approved"])
})

test("failed remainder retains received usage and confirmed approval accounting but saves no report", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.writes[0]!.ack.resolve(); await settle()
  f.workers.get("a")!.fail(); await settle()
  assert.equal(f.controller.views.length, 0); assert.equal(f.saved().total, 0)
  assert.equal(f.totals().requests, 1); assert.equal(f.totals().safe, 0)
  assert.equal(f.totals().activity.autoApproved, 1); assert.equal(f.banners.length, 1)
})

test("save failure never keeps a completed fast report on screen or changes approval", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.writes[0]!.ack.resolve(); await settle()
  f.failStorage(); f.workers.get("a")!.finish(); await settle()
  assert.equal(f.controller.views.length, 0); assert.equal(f.writes.length, 1); assert.equal(f.banners.length, 1)
})

test("nonstream fast mode respects stream:false and waits for validation, then skips the delay", async t => {
  const f = await fixture(t, { stream: false })
  f.rate(); f.show(); await settle(); assert.equal(f.writes.length, 0)
  f.workers.get("a")!.finish(); await settle(); f.show(); await settle()
  assert.equal(f.writes.length, 1)
  f.writes[0]!.ack.resolve(); await settle()
  assert.equal(f.controller.views.length, 0); assert.equal(f.saved().total, 1)
})

for (const options of [{ fastMode: false }, { autoApprove: false }]) test(`fast approval remains opt-in: ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options)
  f.rate(); f.show(); await settle(); assert.equal(f.writes.length, 0)
  f.workers.get("a")!.finish(); await settle(); f.show(); await settle()
  assert.equal(f.writes.length, 0)
  assert.equal(f.controller.views[0]?.autoApproval?.status, options.autoApprove === false ? undefined : "countdown")
})

test("hidden Safe and visible Unsafe previews never approve, but visible Safe can later become eligible", async t => {
  const f = await fixture(t)
  f.rate(false); await settle(); assert.equal(f.writes.length, 0)
  f.hide(); f.rate(); await settle(); assert.equal(f.writes.length, 0)
  f.show(); await settle(); assert.equal(f.writes.length, 1)
})

for (const cancel of ["hide", "cancel", "retry", "unsafe", "disable"] as const) test(`fast verification rechecks eligibility after ${cancel}`, async t => {
  const f = await fixture(t), read = deferred<PermissionRequest[]>()
  f.list(() => read.promise)
  f.rate(); await settle()
  if (cancel === "hide") f.hide()
  if (cancel === "cancel") f.controller.cancelAutoApproval("a")
  if (cancel === "retry") f.workers.get("a")!.progress({ attempt: 1, phase: "retrying" })
  if (cancel === "unsafe") f.rate(false)
  if (cancel === "disable") f.mode(false)
  read.resolve([request()]); await settle()
  assert.equal(f.writes.length, 0)
})

test("native resolution before dispatch remains manual, while an uncertain early write never retries or saves a report", async t => {
  const f = await fixture(t), read = deferred<PermissionRequest[]>()
  f.list(() => read.promise); f.rate(); await settle(); f.resolved(); read.resolve([]); await settle()
  assert.equal(f.writes.length, 0); assert.equal(f.controller.views.length, 0)
  const g = await fixture(t)
  g.rate(); await settle(); g.resolved(); g.writes[0]!.ack.reject(Error("acknowledgement lost")); await settle()
  assert.equal(g.controller.views.length, 0); assert.equal(g.workers.get("a")!.signal.aborted, true)
  assert.equal(g.saved().total, 0); assert.equal(g.banners.length, 0); assert.equal(g.writes.length, 1)
})

test("report completion before acknowledgement waits for confirmed approval and persists exactly once", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.workers.get("a")!.finish(); await settle()
  assert.equal(f.saved().total, 0); assert.equal(f.controller.views.length, 1)
  f.writes[0]!.ack.resolve(); await settle()
  assert.equal(f.saved().total, 1); assert.equal(f.controller.views.length, 0)
  assert.equal(f.events.filter(e => e.type === "permissionResolved").length, 1)
})

test("session deletion cancels retained work and late completion cannot recreate history", async t => {
  const f = await fixture(t)
  f.rate(); await settle(); f.resolved(); f.writes[0]!.ack.resolve(); await settle()
  f.controller.deleted("root"); f.workers.get("a")!.finish(); await settle()
  assert.equal(f.controller.views.length, 0); assert.equal(f.saved().total, 0)
})

test("disable while a dispatched fast write settles retains only confirmed approvals", async t => {
  for (const confirmed of [true, false]) {
    const f = await fixture(t)
    f.rate(); await settle(); f.mode(false)
    assert.equal(f.workers.get("a")!.signal.aborted, false)
    if (confirmed) f.writes[0]!.ack.resolve()
    else f.writes[0]!.ack.reject(Error("write failed"))
    await settle()
    assert.equal(f.workers.get("a")!.signal.aborted, !confirmed)
    if (confirmed) {
      f.workers.get("a")!.finish(); await settle(); assert.equal(f.saved().total, 1)
    } else {
      assert.equal(f.controller.views[0]?.status, "suspended")
      assert.equal(f.saved().total, 0); assert.equal(f.banners.filter(m => m.kind === "approved").length, 0)
    }
  }
})
