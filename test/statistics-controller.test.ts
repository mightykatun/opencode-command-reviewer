import { test } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import { StatisticsController } from "../src/statistics-controller.js"
import { empty } from "../src/lifetime.js"
import type { HistoryRead } from "../src/history-store.js"
import type { HistoryResult } from "../src/history-schema.js"
import type { HistoryQuery } from "../src/history-records.js"
import { SessionModes } from "../src/session-mode.js"
import { HistoryCoordinator } from "../src/history-coordinator.js"

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(t: any, ancestry: (session: string, signal: AbortSignal) => Promise<string> = async session => session === "child" ? "root" : session) {
  const queries: HistoryQuery[] = [], calls: { value: ReturnType<typeof deferred<HistoryResult>>; cleanup: ReturnType<typeof deferred<void>> }[] = []
  const commits = new Set<() => void>(), failures = new Set<() => void>()
  const controller = new StatisticsController("/host", {
    query(query): HistoryRead {
      queries.push(query)
      const value = deferred<HistoryResult>(), cleanup = deferred<void>(); calls.push({ value, cleanup })
      return Object.assign(value.promise, { settled: cleanup.promise })
    },
    onCommit(fn) { commits.add(fn); return () => { commits.delete(fn) } },
    onWriteFailure(fn) { failures.add(fn); return () => { failures.delete(fn) } },
  }, ancestry, () => {})
  const finish = (index: number, input = 10) => {
    const totals = { ...empty(), requests: 1, tokenRequests: 1, input, output: 2, since: 1 }
    const q = queries[index]!
    calls[index]!.value.resolve({ revision: index, totals,
      ...(q.type === "totals" && q.conversation ? { conversation: { totals, partialHistory: false } } : {}) })
    calls[index]!.cleanup.resolve()
  }
  t.after(async () => { controller.dispose(); calls.forEach((_, i) => finish(i)); await settle() })
  return { controller, state: () => controller.state, calls, queries, finish, fail: () => failures.forEach(fn => fn()), commit: () => commits.forEach(fn => fn()) }
}

test("Conversation resolves descendant ancestry without mode loading; both views share one coalesced snapshot read", async t => {
  const f = fixture(t)
  f.finish(0); await settle()
  const token = f.controller.open("child")
  f.controller.select("conversation"); await settle()
  assert.equal(f.calls.length, 2)
  f.finish(1); await settle()
  assert.deepEqual(f.queries[2], { type: "totals", conversation: { scope: "/host", root: "root" } })
  f.finish(2, 200); await settle()
  assert.equal(f.controller.state.conversation?.totals.input, 200)
  f.controller.select("lifetime"); f.finish(3, 300); await settle()
  assert.equal(f.controller.state.totals?.input, 300)
  assert.equal(f.controller.state.view, "lifetime")
  f.controller.close(token); f.finish(4); await settle()
  assert.equal(f.controller.state.open, false)
})

test("old aggregate results and old dialog cleanup cannot replace a newly opened root", async t => {
  const f = fixture(t)
  f.finish(0); await settle()
  const old = f.controller.open("a"); f.controller.select("conversation"); await settle()
  f.finish(1); await settle()
  f.controller.open("b"); f.controller.select("conversation"); f.controller.close(old); await settle()
  f.finish(2, 999); await settle()
  assert.equal(f.controller.state.conversation, undefined)
  assert.equal(f.controller.state.open, true)
  assert.deepEqual(f.queries[3], { type: "totals", conversation: { scope: "/host", root: "b" } })
  f.finish(3, 20); await settle()
  assert.equal(f.state().conversation?.totals.input, 20)
})

test("ancestry failures do not guess a root and home has no fabricated conversation statistics", async t => {
  const f = fixture(t, async () => { throw new Error("unavailable") })
  f.finish(0); await settle()
  f.controller.open("child"); f.controller.select("conversation"); await settle()
  assert.equal(f.controller.state.ancestry, "unavailable")
  assert.equal(f.queries.some(q => q.type === "totals" && q.conversation), false)
  f.controller.open(); f.controller.select("conversation")
  assert.equal(f.controller.state.ancestry, "none"); assert.equal(f.controller.state.conversation, undefined)
})

test("noncooperative ancestry retains one actual lookup through rapid reopen and disposal", async t => {
  const root = deferred<string>(); let count = 0
  const f = fixture(t, async session => { count++; return count === 1 ? root.promise : session })
  f.finish(0); await settle()
  f.controller.open("old"); f.controller.select("conversation"); await settle()
  for (let i = 0; i < 50; i++) { f.controller.open(`root-${i}`); f.controller.select("conversation") }
  await settle(); assert.equal(count, 1)
  root.resolve("old"); await settle(); assert.equal(count, 2)
  f.finish(1); await settle()
  assert.deepEqual(f.queries[2], { type: "totals", conversation: { scope: "/host", root: "root-49" } })
  f.controller.dispose(); f.finish(2, 999); await settle()
  assert.equal(f.controller.state.conversation, undefined)
})

test("write failures and actual read cleanup guard scoped snapshots and recover without resetting stored metrics", async t => {
  const f = fixture(t)
  f.finish(0); await settle()
  f.controller.open("root"); f.controller.select("conversation"); await settle()
  f.finish(1); await settle()
  f.calls[2]!.value.reject(new Error("read expired")); await settle()
  assert.equal(f.controller.state.unavailable, true)
  for (let i = 0; i < 20; i++) { f.commit(); f.controller.select("conversation") }
  assert.equal(f.calls.length, 3)
  f.calls[2]!.cleanup.resolve(); await settle()
  f.fail(); f.finish(3, 999); await settle()
  assert.equal(f.controller.state.unavailable, true); assert.equal(f.controller.state.conversation, undefined)
  f.commit(); f.finish(4, 40); await settle()
  assert.equal(f.controller.state.unavailable, false); assert.equal(f.state().conversation?.totals.input, 40)
})

test("production ancestry composition retains physical ownership through statistics reopen storms", async t => {
  const pending: { id: string; resolve: (v: { id: string }) => void }[] = []
  const modes = new SessionModes({ read: async () => { throw Error("must not load mode") }, write: async () => {}, flush: async () => {} },
    id => new Promise(resolve => pending.push({ id, resolve })))
  const h = new HistoryCoordinator("/host", { admit: () => true, query: async () => ({}), onCommit: () => () => {} }, (id, signal) => modes.root(id, signal))
  const f = fixture(t, (id, signal) => h.root(id, signal))
  try {
    f.finish(0); await settle()
    f.controller.open("old"); f.controller.select("conversation"); await settle()
    for (let n = 0; n < 25; n++) { f.controller.open(`new-${n}`); f.controller.select("conversation"); await settle() }
    assert.equal(pending.length, 1, "deadline wrapper settlement is not actual metadata settlement")
    pending[0]!.resolve({ id: "old" }); await settle()
    assert.deepEqual(pending.map(p => p.id), ["old", "new-24"])
    pending[1]!.resolve({ id: "new-24" }); await settle()
    f.finish(1); await settle()
    assert.deepEqual(f.queries[2], { type: "totals", conversation: { scope: "/host", root: "new-24" } })
  } finally {
    f.controller.dispose(); h.dispose()
    for (const p of pending) p.resolve({ id: p.id })
    await settle()
  }
})

for (const outcome of ["resolve", "reject"] as const) test(`production statistics deadline and disposal retain actual ancestry through late ${outcome}`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  const actual = deferred<{ id: string }>(), cleanup = deferred<void>(); let calls = 0
  const modes = new SessionModes({ read: async () => true, write: async () => {}, flush: async () => {} }, async () => {
    calls++; try { return await actual.promise } finally { await cleanup.promise }
  })
  const h = new HistoryCoordinator("/host", { admit: () => true, query: async () => ({}), onCommit: () => () => {} }, (id, signal) => modes.root(id, signal))
  const f = fixture(t, (id, signal) => h.root(id, signal))
  try {
    f.finish(0); await settle(); f.controller.open("old"); f.controller.select("conversation"); await settle()
    t.mock.timers.tick(5000); await settle(); assert.equal(f.state().ancestry, "unavailable")
    for (let n = 0; n < 10; n++) { f.controller.select("conversation"); t.mock.timers.tick(5000); await settle() }
    assert.equal(calls, 1)
    if (outcome === "resolve") actual.resolve({ id: "old" }); else actual.reject(Error("late failure"))
    await settle(); assert.equal(calls, 1)
    f.controller.dispose(); cleanup.resolve(); await settle()
    assert.equal(calls, 1); assert.equal(f.state().conversation, undefined)
    assert.equal(f.queries.some(q => q.type === "totals" && q.conversation), false)
  } finally { f.controller.dispose(); h.dispose(); actual.resolve({ id: "old" }); cleanup.resolve(); await settle() }
})
