import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, stat, unlink, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { LifetimeUsage, lifetimeCost, lifetimeReport, type LifetimeTotals } from "../src/lifetime.js"
import { usageAttempt } from "../src/usage.js"
import { setImmediate as settle } from "node:timers/promises"

const exec = promisify(execFile)
const source = new URL("../src/lifetime.ts", import.meta.url).href
const usageTotals = ({ activity: _activity, ...totals }: LifetimeTotals) => totals

test("compact report uses weighted running averages and stores no individual timings", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-averages-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = new LifetimeUsage(directory)
  for (const [safe, fullReportMs, ratingMs] of [[true, 1000, 200], [false, 3000, 600], [true, 2000, 400]] as const) {
    await first.recordRating(safe, { fullReportMs, ratingMs })
  }
  await first.recordRetry(); await first.recordRetry(); await first.recordAutoApproval()
  await first.record({ input: 100, output: 20, cost: 0.05 }); await first.record({ cost: 0.1 })
  const second = new LifetimeUsage(directory)
  await second.recordRating(false, { fullReportMs: 10000, ratingMs: 1000 })
  const totals = await new LifetimeUsage(directory).totals()
  assert.equal(totals.activity.timedReviews, 4)
  assert.equal(totals.activity.meanFullReportMs, 4000)
  assert.equal(totals.activity.meanRatingMs, 550)
  assert.equal(totals.activity.retries, 2); assert.equal(totals.activity.autoApproved, 1)
  assert.equal(lifetimeReport(totals), [
    "Reviews: 4", "Retries: 2", "Tokens: 100 in 20 out (partial coverage)", "Cost: $0.1500", "",
    "Safe: 2 (50.0%)", "Unsafe: 2 (50.0%)", "Auto-approved: 1 (25.0%)", "",
    "Average time to full report: 4.00s", "Average time to rating: 0.55s",
  ].join("\n"))
  for (const file of await readdir(directory)) {
    const bytes = await readFile(path.join(directory, file))
    assert.ok(bytes.length <= 1024)
    const snapshot = JSON.parse(bytes.toString())
    assert.equal(snapshot.version, 4)
    assert.deepEqual(Object.keys(snapshot.activity).sort(), ["reviews", "usageRequests", "retries", "autoApproved", "timedReviews", "meanFullReportMs", "meanRatingMs", "since"].sort())
    assert.ok(Object.values(snapshot.activity).every(value => typeof value === "number" || value === null))
  }
})

test("v3 totals remain intact while new metrics expose partial history and measured-only averages", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "review-v4-history-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = path.join(root, "usage-v3"), current = path.join(root, "usage-v4")
  await mkdir(legacy)
  const file = path.join(legacy, "11111111-1111-4111-8111-111111111111.json")
  const text = JSON.stringify({ version: 3, requests: 10, tokenRequests: 10, input: 100, output: 20,
    priced: 10, cost: 1, since: 1, safe: 2, unsafe: 1, ratingsSince: 2 })
  await writeFile(file, text)
  const store = new LifetimeUsage(current, legacy)
  assert.match(lifetimeReport(await store.totals()), /Average time to full report: unavailable/)
  await store.recordRating(true, { fullReportMs: 2000, ratingMs: 500 })
  await store.recordAutoApproval(); await store.recordRetry()
  const totals = await store.totals()
  assert.equal(totals.safe, 3); assert.equal(totals.unsafe, 1); assert.equal(totals.cost, 1)
  assert.equal(totals.activity.timedReviews, 1)
  assert.match(lifetimeReport(totals), /Retries: 1 \(partial history\)/)
  assert.match(lifetimeReport(totals), /Auto-approved: 1 \(25\.0%\) \(partial history\)/)
  assert.match(lifetimeReport(totals), /Average time to rating: 0\.50s/)
  assert.equal(await readFile(file, "utf8"), text)
})

test("invalid activity metrics fail without resetting stored history", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-invalid-activity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.recordRating(true, { fullReportMs: 1000, ratingMs: 100 })
  const before = await store.totals()
  for (const timing of [{ fullReportMs: -1, ratingMs: 0 }, { fullReportMs: Infinity, ratingMs: 0 }, { fullReportMs: 1, ratingMs: 2 }]) {
    await assert.rejects(store.recordRating(false, timing), /Invalid review timing/)
  }
  assert.deepEqual(await store.totals(), before)
  const file = path.join(directory, (await readdir(directory))[0]!)
  const snapshot = JSON.parse(await readFile(file, "utf8"))
  for (const change of [{ retries: -1 }, { autoApproved: 0.5 }, { timedReviews: 2 }, { meanRatingMs: 1001 },
    { meanFullReportMs: null }, { since: null }, { timedReviews: 0 }, { usageRequests: 1 }]) {
    await writeFile(file, JSON.stringify({ ...snapshot, activity: { ...snapshot.activity, ...change } }))
    await assert.rejects(new LifetimeUsage(directory).totals(), /Invalid lifetime activity totals/)
  }
})

test("ratings persist independently of usage and retain their own recording start", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-ratings-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.recordRating(true)
  await store.recordRating(false)
  const first = await store.totals()
  assert.equal(first.safe, 1); assert.equal(first.unsafe, 1)
  assert.equal(first.requests, 0); assert.equal(first.since, null)
  assert.ok(first.ratingsSince! <= Date.now())
  const restarted = new LifetimeUsage(directory)
  await restarted.recordRating(true)
  const total = await restarted.totals()
  assert.equal(total.safe, 2); assert.equal(total.unsafe, 1)
  assert.equal(total.ratingsSince, first.ratingsSince)
  assert.match(lifetimeReport(total), /Safe: 2 \(66\.7%\)/)
  assert.match(lifetimeReport(total), /Unsafe: 1 \(33\.3%\)/)
  assert.match(lifetimeReport(total), /Average time to rating: unavailable/)
  for (const value of [undefined, null, "true", 1, {}]) await assert.rejects(store.recordRating(value as boolean), /Invalid review rating/)
  assert.deepEqual(await store.totals(), total)
})

test("rating writes recover after storage failure without losing or duplicating counts", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "review-rating-write-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "store")
  await writeFile(directory, "blocked")
  const store = new LifetimeUsage(directory)
  await assert.rejects(store.recordRating(false))
  await assert.rejects(store.flush())
  await unlink(directory)
  await store.record({ cost: 0.1 })
  await store.recordRating(true)
  await store.flush()
  const total = await new LifetimeUsage(directory).totals()
  assert.equal(total.safe, 1); assert.equal(total.unsafe, 1)
  assert.equal(total.requests, 1); assert.equal(total.cost, 0.1)
})

test("v3 aggregates untouched v1/v2 history without inventing earlier ratings", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "review-rating-history-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directories = [1, 2, 3].map(version => path.join(root, `usage-v${version}`))
  const files: [string, string][] = []
  for (const version of [1, 2]) {
    await mkdir(directories[version - 1]!)
    const file = path.join(directories[version - 1]!, "11111111-1111-4111-8111-111111111111.json")
    const text = JSON.stringify({ version, requests: 1, input: 10, output: 2, priced: 1, cost: 0.1, since: version,
      ...(version === 2 ? { tokenRequests: 1 } : {}) })
    files.push([file, text]); await writeFile(file, text)
  }
  const store = new LifetimeUsage(directories[2]!, directories[1]!, directories[0]!)
  const old = await store.totals()
  assert.equal(old.requests, 2); assert.equal(old.cost, 0.2)
  assert.equal(old.safe, 0); assert.equal(old.unsafe, 0); assert.equal(old.ratingsSince, null)
  await store.recordRating(false)
  const total = await new LifetimeUsage(directories[2]!, directories[1]!, directories[0]!).totals()
  assert.equal(total.requests, 2); assert.equal(total.cost, 0.2)
  assert.equal(total.safe, 0); assert.equal(total.unsafe, 1); assert.equal(total.since, 1)
  for (const [file, text] of files) assert.equal(await readFile(file, "utf8"), text)
  const snapshot = JSON.parse(await readFile(path.join(directories[2]!, (await readdir(directories[2]!))[0]!), "utf8"))
  assert.equal(snapshot.requests, 0, "new snapshots never import history")
  assert.equal(snapshot.unsafe, 1)
})

test("invalid or overflowing rating snapshots fail explicitly", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-rating-invalid-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.recordRating(true)
  const file = path.join(directory, (await readdir(directory))[0]!)
  const original = JSON.parse(await readFile(file, "utf8"))
  for (const change of [{ safe: -1 }, { unsafe: 0.5 }, { safe: "1" }, { safe: null }, { ratingsSince: null },
    { safe: 0, unsafe: 0 }, { ratingsSince: 9e15 }, { safe: Number.MAX_SAFE_INTEGER, unsafe: 1 }]) {
    await writeFile(file, JSON.stringify({ ...original, ...change }))
    await assert.rejects(new LifetimeUsage(directory).totals(), /Invalid lifetime usage totals/)
  }
  await writeFile(file, JSON.stringify({ ...original, safe: Number.MAX_SAFE_INTEGER }))
  await writeFile(path.join(directory, "11111111-1111-4111-8111-111111111111.json"), JSON.stringify(original))
  await assert.rejects(new LifetimeUsage(directory).totals(), /Invalid lifetime usage totals/)
})

test("persistent totals include priced and unpriced usage across instances without request data", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-lifetime-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = new LifetimeUsage(directory)
  assert.equal(lifetimeCost(await first.totals()), "lifetime: no recorded usage")
  await Promise.all([first.record({ input: 100, output: 20, cost: 0.01 }), first.record({ input: 200, output: 30 })])
  const restarted = new LifetimeUsage(directory)
  await restarted.record({ input: 300, output: 40, cost: 0.02 })
  const totals = await restarted.totals()
  assert.deepEqual({ ...usageTotals(totals), since: null }, { requests: 3, tokenRequests: 3, input: 600, output: 90, priced: 2, cost: 0.03, since: null,
    safe: 0, unsafe: 0, ratingsSince: null })
  assert.match(lifetimeReport(totals), /Cost: \$0\.0300 \(partial pricing\)/)
  assert.ok(totals.since! <= Date.now())
  const files = await readdir(directory)
  assert.equal(files.length, 2, "compact snapshots grow by instance, not by request")
  for (const file of files) {
    const contents = JSON.parse(await readFile(path.join(directory, file), "utf8"))
    assert.deepEqual(Object.keys(contents).sort(), ["version", "requests", "tokenRequests", "input", "output", "priced", "cost", "since", "safe", "unsafe", "ratingsSince", "activity"].sort())
    assert.equal(contents.version, 4)
    assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o600)
  }
})

test("concurrent processes cannot lose updates and readers only see complete snapshots", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-concurrent-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reader = new LifetimeUsage(directory)
  let finished = false
  const workers = Promise.all(Array.from({ length: 3 }, () => exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { LifetimeUsage } from ${JSON.stringify(source)}; const ledger = new LifetimeUsage(${JSON.stringify(directory)}); await Promise.all(Array.from({length: 20}, (_, i) => Promise.all([ledger.record({input: 10, output: 2, cost: 0.01}), ledger.recordRating(i % 2 === 0)])));`,
  ]))).finally(() => { finished = true })
  let previous = 0
  while (!finished) {
    const value = await reader.totals()
    assert.ok(value.requests >= previous && value.requests <= 60)
    previous = value.requests
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await workers
  const value = await reader.totals()
  assert.equal(value.requests, 60)
  assert.equal(value.tokenRequests, 60)
  assert.equal(value.input, 600)
  assert.equal(value.output, 120)
  assert.equal(value.priced, 60)
  assert.equal(value.safe, 30)
  assert.equal(value.unsafe, 30)
  assert.ok(Math.abs(value.cost - 0.6) < 1e-12)
  assert.equal((await readdir(directory)).length, 3)
})

test("unpriced usage never appears free; valid zero-cost pricing does", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-unpriced-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.record({ input: 10, output: 2 })
  assert.equal(lifetimeCost(await store.totals()), "lifetime: cost unavailable")
  await store.record({ input: 10, output: 2, cost: 0 })
  assert.equal(lifetimeCost(await store.totals()), "lifetime: $0.0000 (partial pricing)")
})

test("corrupt, oversized, symlinked and future snapshots fail explicitly without resetting recorded data", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-corrupt-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.record({ input: 10, output: 2, cost: 0.01 })
  const file = path.join(directory, (await readdir(directory))[0]!)
  const original = await readFile(file, "utf8")
  for (const contents of ["{", "x".repeat(1025), original.replace('"version":4', '"version":5'), original.replace('"requests":1', '"requests":-1'),
    original.replace('"tokenRequests":1', '"tokenRequests":2'), original.replace('"tokenRequests":1', '"tokenRequests":0'),
    original.replace('"tokenRequests":1', '"tokenRequests":null')]) {
    await writeFile(file, contents)
    await assert.rejects(new LifetimeUsage(directory).totals())
    assert.equal(await readFile(file, "utf8"), contents)
  }
  await unlink(file)
  await symlink("missing", file)
  await assert.rejects(new LifetimeUsage(directory).totals())
  await unlink(file)
  await writeFile(file, original)
  await writeFile(path.join(directory, "interrupted.tmp"), "{")
  assert.equal((await store.totals()).requests, 1, "incomplete temporary writes are not committed usage")
})

test("failed persistence can recover without losing increments; invalid usage and aborted reads do not change totals", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-write-failure-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "store")
  await writeFile(directory, "not a directory")
  const store = new LifetimeUsage(directory)
  await assert.rejects(store.record({ input: 10, output: 2, cost: 0.01 }))
  await assert.rejects(store.flush())
  await unlink(directory)
  await store.record({ input: 20, output: 3, cost: 0.02 })
  const before = await store.totals()
  assert.equal(before.requests, 2)
  await assert.rejects(store.record({ input: -1, output: 0 }))
  await assert.rejects(store.record({ input: 1, output: 0, cost: Infinity }))
  assert.deepEqual(await store.totals(), before)
  await assert.rejects(store.totals(AbortSignal.abort()), { name: "AbortError" })
})

test("a canceled totals read waiting for flush does not cancel or discard independent writes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-canceled-totals-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  const originalFlush = store.flush.bind(store)
  t.mock.method(store, "flush", () => waiting)
  const abort = new AbortController()
  const read = assert.rejects(store.totals(abort.signal), { name: "AbortError" })
  await settle()
  abort.abort()
  await store.record({ cost: 0.1 })
  await originalFlush()
  finish()
  await read
  const saved = await new LifetimeUsage(directory).totals()
  assert.equal(saved.requests, 1)
  assert.equal(saved.cost, 0.1)
})

test("cost-only observations preserve independent token coverage and show one accumulated history cost", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-cost-only-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new LifetimeUsage(directory)
  await store.record({ cost: 0 })
  const costOnly = await store.totals()
  assert.equal(costOnly.tokenRequests, 0)
  assert.equal(lifetimeCost(costOnly), "lifetime: $0.0000")
  assert.match(lifetimeReport(costOnly), /Tokens: unavailable/)
  assert.doesNotMatch(lifetimeReport(costOnly), /Tokens: 0 in 0 out/)
  await store.record({ cost: 0.02 })
  await store.record({ input: 10, output: 2 })
  await store.record({ input: 0, output: 0, cost: 0.01 })
  const totals = await new LifetimeUsage(directory).totals()
  assert.deepEqual({ ...usageTotals(totals), since: null }, { requests: 4, tokenRequests: 2, input: 10, output: 2, priced: 3, cost: 0.03, since: null,
    safe: 0, unsafe: 0, ratingsSince: null })
  const report = lifetimeReport(totals)
  assert.match(report, /Cost: \$0\.0300 \(partial pricing\)/)
  assert.match(report, /Tokens: 10 in 2 out \(partial coverage\)/)
  assert.match(report, /Reviews: 0/, "usage-only requests do not invent completed reviews")
  assert.match(report, /Safe: 0 \(n\/a\)/)
  assert.doesNotMatch(report, /completed requests|Canceled requests.*excluded|format retries/)
  for (const usage of [{}, { input: 1 }, { output: 1 }, { input: 1, cost: 0.01 }, { input: NaN, output: 1, cost: 0.01 }, { cost: -1 }, { cost: Infinity }]) {
    await assert.rejects(store.record(usage), /Invalid request usage/)
  }
  assert.deepEqual(await store.totals(), totals)
})

test("v1 history is read unchanged alongside v4 snapshots without copying or double-counting on restart", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-migration-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = path.join(root, "usage-v1"), current = path.join(root, "usage-v4")
  await mkdir(legacy)
  const file = path.join(legacy, "11111111-1111-4111-8111-111111111111.json")
  const contents = JSON.stringify({ version: 1, requests: 3, input: 123, output: 45, priced: 2, cost: 1.23, since: 1700000000000 })
  await writeFile(file, contents)
  const store = new LifetimeUsage(current, legacy)
  const old = await store.totals()
  assert.deepEqual(usageTotals(old), { requests: 3, tokenRequests: 3, input: 123, output: 45, priced: 2, cost: 1.23, since: 1700000000000,
    safe: 0, unsafe: 0, ratingsSince: null })
  assert.equal(lifetimeCost(old), "lifetime: $1.2300 (partial pricing)")
  await store.record({ cost: 0.5 })
  const restarted = new LifetimeUsage(current, legacy)
  await restarted.record({ input: 10, output: 2, cost: 0 })
  const totals = { requests: 5, tokenRequests: 4, input: 133, output: 47, priced: 4, cost: 1.73, since: 1700000000000,
    safe: 0, unsafe: 0, ratingsSince: null }
  assert.deepEqual(usageTotals(await restarted.totals()), totals)
  assert.deepEqual(usageTotals(await store.totals()), totals)
  assert.equal(await readFile(file, "utf8"), contents)
  for (const name of await readdir(current)) {
    const snapshot = JSON.parse(await readFile(path.join(current, name), "utf8"))
    assert.equal(snapshot.requests, 1, "new snapshots must not contain imported totals")
    assert.equal(snapshot.version, 4)
  }
  // Mixed versions are supported too; specifying the same directory twice reads it only once.
  const mixed = new LifetimeUsage(legacy, `${legacy}/.`)
  await mixed.record({ cost: 0.25 })
  assert.deepEqual(usageTotals(await mixed.totals()), { ...usageTotals(old), requests: 4, priced: 3, cost: 1.48 })
})

test("cost-only failed writes recover once and finalizing interrupted workers before flush persists their observations", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-finalize-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "store")
  await writeFile(directory, "not a directory")
  const store = new LifetimeUsage(directory)
  await assert.rejects(store.record({ cost: 0.1 }))
  await assert.rejects(store.flush())
  await unlink(directory)
  const controller = new AbortController()
  let finish!: () => void
  const interrupted = new Promise<void>((resolve) => { finish = resolve })
  controller.signal.addEventListener("abort", finish, { once: true })
  const worker = (async () => {
    const attempt = usageAttempt("https://openrouter.ai/api/v1", "fixture", undefined, (usage) => { void store.record(usage) })
    try {
      attempt.observe({ usage: { cost: 0.2 } })
      attempt.observe({ usage: { cost: 0.2 } })
      await interrupted
      controller.signal.throwIfAborted()
    } finally { attempt.finalize(); attempt.finalize() }
  })()
  controller.abort()
  await assert.rejects(worker, { name: "AbortError" })
  await store.flush()
  const totals = await new LifetimeUsage(directory).totals()
  assert.equal(totals.requests, 2)
  assert.equal(totals.tokenRequests, 0)
  assert.equal(totals.priced, 2)
  assert.ok(Math.abs(totals.cost - 0.3) < 1e-12)
})
