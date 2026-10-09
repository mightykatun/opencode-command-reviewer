import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { empty, type LifetimeTotals } from "../src/lifetime.js"
import { lifetimeTracker } from "../src/lifetime-view.js"
import type { HistoryRead } from "../src/history-store.js"
import type { HistoryResult } from "../src/history-schema.js"

const totals = (requests: number): LifetimeTotals => ({ ...empty(), requests, tokenRequests: requests, input: requests * 10,
  output: requests * 2, priced: requests, cost: requests * 0.01, since: requests ? 1 : null,
  safe: requests, ratingsSince: requests ? 1 : null,
  activity: { ...empty().activity, reviews: requests, usageRequests: requests, since: requests ? 1 : null } })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture(t: TestContext) {
  const calls: { signal: AbortSignal; value: ReturnType<typeof deferred<HistoryResult>>; cleanup: ReturnType<typeof deferred<void>> }[] = []
  const commits = new Set<() => unknown>(), failures = new Set<() => unknown>()
  let actual = 0, maximum = 0, replacements = 0, open = false, unregistered = 0
  const store = {
    query: (query: unknown, signal?: AbortSignal): HistoryRead => {
      assert.deepEqual(query, { type: "totals" })
      actual++; maximum = Math.max(maximum, actual)
      const call = { signal: signal!, value: deferred<HistoryResult>(), cleanup: deferred<void>() }
      calls.push(call)
      const read: HistoryRead = call.value.promise
      read.settled = call.cleanup.promise.then(() => { actual-- })
      return read
    },
    onCommit: (fn: () => unknown) => { commits.add(fn); return () => { commits.delete(fn) } },
    onWriteFailure: (fn: () => unknown) => { failures.add(fn); return () => { failures.delete(fn) } },
  }
  const parent = new AbortController(), disposers: (() => void)[] = []
  let command!: { run: () => void }
  const api = {
    lifecycle: { signal: parent.signal, onDispose: (run: () => void) => { disposers.push(run) } },
    state: { path: { directory: "/project" } }, route: { current: { name: "home" } },
    keymap: { registerLayer: (layer: { commands: { run: () => void }[] }) => {
      command = layer.commands[0]!; return () => { unregistered++ }
    } },
    // Do not evaluate JSX: a refresh must never replace a dismissed host dialog.
    ui: { dialog: { replace: () => { replacements++; open = true } } },
  } as unknown as TuiPluginApi
  const tracker = lifetimeTracker(api, store, async () => "root")
  const dispose = () => { parent.abort(); for (const run of disposers.splice(0)) run() }
  const finish = (index: number, value = totals(index + 1)) => {
    calls[index]!.value.resolve({ revision: index, totals: value }); calls[index]!.cleanup.resolve()
  }
  t.after(async () => {
    dispose()
    for (let i = 0; i < calls.length; i++) finish(i)
    await settle()
    assert.equal(actual, 0); assert.ok(maximum <= 1)
    assert.equal(commits.size, 0); assert.equal(failures.size, 0)
  })
  await settle()
  return { tracker, calls, command, dispose, finish, abort: () => parent.abort(),
    commit: () => { for (const fn of commits) fn() }, fail: () => { for (const fn of failures) fn() },
    dismiss: () => { open = false }, counts: () => ({ actual, maximum, reads: calls.length, replacements, open, unregistered }) }
}

test("palette fetches committed totals without replacing or resurrecting a dismissed dialog", async t => {
  const f = await fixture(t)
  f.finish(0, totals(1)); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0100\n1 ✓ 0 ✗")
  f.command.run(); f.dismiss(); f.finish(1, totals(2)); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0200\n2 ✓ 0 ✗")
  assert.equal(f.counts().replacements, 1); assert.equal(f.counts().open, false)
})

test("write failure invalidates active and queued snapshots; a local commit immediately recovers without warning", async t => {
  const f = await fixture(t)
  f.command.run(); f.fail()
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  f.finish(0, totals(99)); await settle()
  assert.equal(f.counts().reads, 1)
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  f.commit(); assert.equal(f.counts().reads, 2)
  f.finish(1, totals(2)); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0200\n2 ✓ 0 ✗")
})

test("two-second polling refreshes shared totals without invalidating a slow healthy read", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = await fixture(t)
  t.mock.timers.tick(2000); await settle()
  assert.equal(f.counts().reads, 1)
  f.finish(0, totals(1)); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0100\n1 ✓ 0 ✗")
  assert.equal(f.counts().reads, 2)
  f.finish(1, totals(2)); await settle()
  t.mock.timers.tick(1999); assert.equal(f.counts().reads, 2)
  t.mock.timers.tick(1); assert.equal(f.counts().reads, 3)
  f.finish(2, totals(3)); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0300\n3 ✓ 0 ✗")
})

test("expired reads retain actual cleanup ownership through storms and disposal", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = await fixture(t)
  f.calls[0]!.value.reject(Error("bounded read expired")); await settle()
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  for (let i = 0; i < 100; i++) { f.commit(); f.command.run() }
  t.mock.timers.tick(10000); await settle()
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().actual, 1)
  f.calls[0]!.cleanup.resolve(); await settle()
  assert.equal(f.counts().reads, 2)
  f.abort(); f.dismiss()
  const published = f.tracker.text(), replacements = f.counts().replacements
  f.finish(1, totals(99)); await settle()
  f.command.run(); t.mock.timers.tick(10000); await settle()
  assert.equal(f.tracker.text(), published); assert.equal(f.counts().replacements, replacements)
  assert.equal(f.counts().reads, 2)
})

test("rating-only totals remain available to the dialog without standalone inline usage", async t => {
  const f = await fixture(t)
  f.finish(0, { ...totals(0), safe: 1, unsafe: 1, ratingsSince: 1 }); await settle()
  assert.equal(f.tracker.text(), undefined)
  f.commit(); f.finish(1, { ...totals(1), unsafe: 1 }); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0100\n1 ✓ 1 ✗")
})
