import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, stat, unlink, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { LifetimeUsage, lifetimeCost, lifetimeReport } from "../src/lifetime.js"
import { usageAttempt } from "../src/usage.js"
import { setImmediate as settle } from "node:timers/promises"

const exec = promisify(execFile)
const source = new URL("../src/lifetime.ts", import.meta.url).href

test("persistent totals include priced and unpriced usage across instances without request data", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-lifetime-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = new LifetimeUsage(directory)
  assert.equal(lifetimeCost(await first.totals()), "lifetime: no recorded usage")
  await Promise.all([first.record({ input: 100, output: 20, cost: 0.01 }), first.record({ input: 200, output: 30 })])
  const restarted = new LifetimeUsage(directory)
  await restarted.record({ input: 300, output: 40, cost: 0.02 })
  const totals = await restarted.totals()
  assert.deepEqual({ ...totals, since: null }, { requests: 3, tokenRequests: 3, input: 600, output: 90, priced: 2, cost: 0.03, since: null })
  assert.match(lifetimeReport(totals), /lifetime: \$0\.0300 \(partial pricing\)/)
  assert.match(lifetimeReport(totals), /Pricing available: 2\/3 requests/)
  assert.ok(totals.since! <= Date.now())
  const files = await readdir(directory)
  assert.equal(files.length, 2, "compact snapshots grow by instance, not by request")
  for (const file of files) {
    const contents = JSON.parse(await readFile(path.join(directory, file), "utf8"))
    assert.deepEqual(Object.keys(contents).sort(), ["version", "requests", "tokenRequests", "input", "output", "priced", "cost", "since"].sort())
    assert.equal(contents.version, 2)
    assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o600)
  }
})

test("concurrent processes cannot lose updates and readers only see complete snapshots", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-concurrent-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reader = new LifetimeUsage(directory)
  let finished = false
  const workers = Promise.all(Array.from({ length: 3 }, () => exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { LifetimeUsage } from ${JSON.stringify(source)}; const ledger = new LifetimeUsage(${JSON.stringify(directory)}); await Promise.all(Array.from({length: 20}, () => ledger.record({input: 10, output: 2, cost: 0.01})));`,
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
  for (const contents of ["{", "x".repeat(1025), original.replace('"version":2', '"version":3'), original.replace('"requests":1', '"requests":-1'),
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
  assert.match(lifetimeReport(costOnly), /tokens unavailable/)
  assert.doesNotMatch(lifetimeReport(costOnly), /tokens in\/out: 0\/0/)
  await store.record({ cost: 0.02 })
  await store.record({ input: 10, output: 2 })
  await store.record({ input: 0, output: 0, cost: 0.01 })
  const totals = await new LifetimeUsage(directory).totals()
  assert.deepEqual({ ...totals, since: null }, { requests: 4, tokenRequests: 2, input: 10, output: 2, priced: 3, cost: 0.03, since: null })
  const report = lifetimeReport(totals)
  assert.match(report, /lifetime: \$0\.0300 \(partial pricing\)/)
  assert.match(report, /tokens in\/out: 10\/2 \(partial coverage\)/)
  assert.match(report, /Token counts available: 2\/4 requests/)
  assert.match(report, /4 requests with recorded usage/)
  assert.match(report, /Unreported charges remain unknown/)
  assert.match(report, /legacy history retains its original estimates/)
  assert.doesNotMatch(report, /completed requests|Canceled requests.*excluded|format retries/)
  for (const usage of [{}, { input: 1 }, { output: 1 }, { input: 1, cost: 0.01 }, { input: NaN, output: 1, cost: 0.01 }, { cost: -1 }, { cost: Infinity }]) {
    await assert.rejects(store.record(usage), /Invalid request usage/)
  }
  assert.deepEqual(await store.totals(), totals)
})

test("v1 history is read unchanged alongside v2 snapshots without copying or double-counting on restart", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-migration-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = path.join(root, "usage-v1"), current = path.join(root, "usage-v2")
  await mkdir(legacy)
  const file = path.join(legacy, "11111111-1111-4111-8111-111111111111.json")
  const contents = JSON.stringify({ version: 1, requests: 3, input: 123, output: 45, priced: 2, cost: 1.23, since: 1700000000000 })
  await writeFile(file, contents)
  const store = new LifetimeUsage(current, legacy)
  const old = await store.totals()
  assert.deepEqual(old, { requests: 3, tokenRequests: 3, input: 123, output: 45, priced: 2, cost: 1.23, since: 1700000000000 })
  assert.equal(lifetimeCost(old), "lifetime: $1.2300 (partial pricing)")
  await store.record({ cost: 0.5 })
  const restarted = new LifetimeUsage(current, legacy)
  await restarted.record({ input: 10, output: 2, cost: 0 })
  const totals = { requests: 5, tokenRequests: 4, input: 133, output: 47, priced: 4, cost: 1.73, since: 1700000000000 }
  assert.deepEqual(await restarted.totals(), totals)
  assert.deepEqual(await store.totals(), totals)
  assert.equal(await readFile(file, "utf8"), contents)
  for (const name of await readdir(current)) {
    const snapshot = JSON.parse(await readFile(path.join(current, name), "utf8"))
    assert.equal(snapshot.requests, 1, "new snapshots must not contain imported totals")
    assert.equal(snapshot.version, 2)
  }
  // Mixed versions are supported too; specifying the same directory twice reads it only once.
  const mixed = new LifetimeUsage(legacy, `${legacy}/.`)
  await mixed.record({ cost: 0.25 })
  assert.deepEqual(await mixed.totals(), { ...old, requests: 4, priced: 3, cost: 1.48 })
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
