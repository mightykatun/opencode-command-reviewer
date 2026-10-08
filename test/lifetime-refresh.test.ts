import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import { LifetimeRefresh } from "../src/lifetime-refresh.js"
import type { LifetimeTotals } from "../src/lifetime.js"

const totals = (requests: number): LifetimeTotals => ({ requests, tokenRequests: requests, input: requests * 10,
  output: requests * 2, priced: requests, cost: requests * 0.01, since: requests ? 1700000000000 : null,
  safe: 0, unsafe: 0, ratingsSince: null, activity: { reviews: 0, usageRequests: 0, retries: 0, autoApproved: 0,
    timedReviews: 0, meanFullReportMs: 0, meanRatingMs: 0, since: null } })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(t: TestContext) {
  const parent = new AbortController()
  const calls: { signal: AbortSignal; value: ReturnType<typeof deferred<LifetimeTotals>>; cleanup: ReturnType<typeof deferred<void>> }[] = []
  const publications: (LifetimeTotals | undefined)[] = []
  let actual = 0, maximum = 0
  const refresh = new LifetimeRefresh(async (signal) => {
    actual++
    maximum = Math.max(maximum, actual)
    const call = { signal, value: deferred<LifetimeTotals>(), cleanup: deferred<void>() }
    calls.push(call)
    try { return await call.value.promise }
    finally { try { await call.cleanup.promise } finally { actual-- } }
  }, (value) => { publications.push(value) }, parent.signal)
  const finish = (index: number, value = totals(index + 1)) => { calls[index]!.value.resolve(value); calls[index]!.cleanup.resolve() }
  t.after(async () => {
    refresh.dispose()
    for (const call of calls) { call.value.resolve(totals(0)); call.cleanup.resolve() }
    await settle()
    assert.equal(actual, 0)
    assert.ok(maximum <= 1, "actual read and cleanup transactions never overlap")
  })
  return { refresh, calls, publications, parent, finish, counts: () => ({ actual, maximum, reads: calls.length }) }
}

test("one current read publishes its totals after actual cleanup completes", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 })
  f.calls[0]!.value.resolve(totals(3))
  await settle()
  assert.equal(f.publications.length, 0)
  assert.equal(f.counts().actual, 1)
  f.calls[0]!.cleanup.resolve()
  await settle()
  assert.deepEqual(f.publications, [totals(3)])
  assert.equal(f.counts().actual, 0)
})

test("hundreds of overlapping requests use one actual read and one latest follow-up", async (t) => {
  const f = fixture(t)
  for (let i = 0; i < 200; i++) f.refresh.refresh()
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 })
  f.finish(0, totals(1))
  await settle()
  assert.equal(f.publications.length, 0, "an older requested revision cannot publish")
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 2 })
  f.finish(1, totals(200))
  await settle()
  assert.deepEqual(f.publications, [totals(200)])
  assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 2 })
})

test("follow-up work remains coalesced when a second burst arrives during the next read", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  for (let i = 0; i < 100; i++) f.refresh.refresh()
  f.finish(0)
  await settle()
  for (let i = 0; i < 100; i++) f.refresh.refresh()
  assert.equal(f.counts().reads, 2)
  f.finish(1)
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 3 })
  assert.equal(f.publications.length, 0)
  f.finish(2, totals(201))
  await settle()
  assert.deepEqual(f.publications, [totals(201)])
})

for (const outcome of ["resolve", "reject"] as const) test(`timeout publishes unavailable under repeated requests and retains ownership through late ${outcome} cleanup`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  for (let second = 0; second < 5; second++) {
    for (let i = 0; i < 100; i++) f.refresh.refresh()
    t.mock.timers.tick(1000)
    await settle()
  }
  assert.deepEqual(f.publications, [undefined], "queued newer revisions must not suppress unavailability")
  assert.equal(f.calls[0]!.signal.aborted, true)
  for (let i = 0; i < 200; i++) f.refresh.refresh()
  t.mock.timers.tick(15000)
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 })
  if (outcome === "resolve") f.calls[0]!.value.resolve(totals(999))
  else f.calls[0]!.value.reject(new Error("late read failure"))
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 }, "settled I/O still retains the slot through cleanup")
  assert.deepEqual(f.publications, [undefined])
  f.calls[0]!.cleanup.resolve()
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 2 })
  f.finish(1, totals(5))
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(5)])
  assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 2 })
})

test("failed reads publish unavailable despite a newer queued revision and then permit recovery", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  f.calls[0]!.value.reject(new Error("storage unavailable"))
  f.calls[0]!.cleanup.resolve()
  await settle()
  assert.deepEqual(f.publications, [undefined])
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 2 })
  f.finish(1)
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(2)])
})

test("failed cleanup releases actual ownership, reports unavailable and permits one queued recovery", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  f.calls[0]!.value.resolve(totals(99))
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 })
  f.calls[0]!.cleanup.reject(new Error("closing the read failed"))
  await settle()
  assert.deepEqual(f.publications, [undefined])
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 2 })
  f.finish(1, totals(2))
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(2)])
})

test("elapsed time rejects completed cleanup before timer delivery and a follow-up uses a fresh deadline", async (t) => {
  let now = 0
  t.mock.method(performance, "now", () => now)
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  now = 5000
  f.finish(0, totals(99))
  await settle()
  assert.deepEqual(f.publications, [undefined])
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 2 })
  f.finish(1, totals(2))
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(2)])
})

test("a write failure invalidates active success and older queued requests until a new refresh", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  f.refresh.failed()
  assert.deepEqual(f.publications, [undefined])
  f.finish(0, totals(99))
  await settle()
  assert.deepEqual(f.publications, [undefined])
  assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 1 })
  f.refresh.refresh()
  await settle()
  f.finish(1, totals(2))
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(2)])
})

test("a new refresh after a write failure waits for existing cleanup before publishing recovery", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.failed()
  for (let i = 0; i < 100; i++) f.refresh.refresh()
  f.calls[0]!.value.resolve(totals(99))
  await settle()
  assert.deepEqual(f.counts(), { actual: 1, maximum: 1, reads: 1 })
  f.calls[0]!.cleanup.resolve()
  await settle()
  f.finish(1, totals(2))
  await settle()
  assert.deepEqual(f.publications, [undefined, totals(2)])
})

test("write failure after a timeout cancels the older queued follow-up without freeing cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  t.mock.timers.tick(5000)
  await settle()
  f.refresh.failed()
  f.calls[0]!.value.resolve(totals(99))
  await settle()
  assert.equal(f.counts().actual, 1)
  f.calls[0]!.cleanup.resolve()
  await settle()
  assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 1 })
  assert.ok(f.publications.every((value) => value === undefined))
})

for (const stop of ["dispose", "parent abort"] as const) for (const outcome of ["resolve", "reject"] as const) {
  test(`${stop} aborts the wait and suppresses queued reads and late ${outcome} publication`, async (t) => {
    const f = fixture(t)
    f.refresh.refresh()
    await settle()
    f.refresh.refresh()
    if (stop === "dispose") f.refresh.dispose()
    else f.parent.abort()
    assert.equal(f.calls[0]!.signal.aborted, true)
    await settle()
    if (outcome === "resolve") f.calls[0]!.value.resolve(totals(99))
    else f.calls[0]!.value.reject(new Error("late read failure"))
    await settle()
    assert.equal(f.counts().actual, 1)
    f.calls[0]!.cleanup.resolve()
    await settle()
    f.refresh.refresh()
    f.refresh.failed()
    await settle()
    assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 1 })
    assert.equal(f.publications.length, 0)
  })
}

test("disposal while timed-out cleanup owns the slot prevents its follow-up from starting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(t)
  f.refresh.refresh()
  await settle()
  f.refresh.refresh()
  t.mock.timers.tick(5000)
  await settle()
  assert.deepEqual(f.publications, [undefined])
  f.refresh.dispose()
  f.finish(0, totals(99))
  await settle()
  assert.deepEqual(f.publications, [undefined])
  assert.deepEqual(f.counts(), { actual: 0, maximum: 1, reads: 1 })
})

test("stop before dispatch starts no actual read or cleanup", async (t) => {
  const f = fixture(t)
  f.refresh.refresh()
  f.refresh.refresh()
  f.refresh.dispose()
  await settle()
  assert.deepEqual(f.counts(), { actual: 0, maximum: 0, reads: 0 })
  assert.equal(f.publications.length, 0)
})

test("an already aborted lifecycle accepts neither reads nor write-failure publications", async (t) => {
  const f = fixture(t)
  f.parent.abort()
  f.refresh.refresh()
  f.refresh.failed()
  await settle()
  assert.deepEqual(f.counts(), { actual: 0, maximum: 0, reads: 0 })
  assert.equal(f.publications.length, 0)
})

test("synchronous reader errors settle ownership and a later request can succeed", async () => {
  let reads = 0
  const publications: (LifetimeTotals | undefined)[] = []
  const refresh = new LifetimeRefresh(() => {
    if (++reads === 1) throw new Error("read failed before returning a promise")
    return Promise.resolve(totals(1))
  }, (value) => { publications.push(value) }, new AbortController().signal)
  refresh.refresh()
  await settle()
  assert.deepEqual(publications, [undefined])
  refresh.refresh()
  await settle()
  assert.deepEqual(publications, [undefined, totals(1)])
  refresh.dispose()
})
