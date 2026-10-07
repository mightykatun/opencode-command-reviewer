import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm, writeFile, stat, unlink, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { LifetimeUsage, lifetimeCost, lifetimeReport } from "../src/lifetime.js"

const exec = promisify(execFile)
const source = new URL("../src/lifetime.ts", import.meta.url).href

test("persistent totals include priced and unpriced completed usage across instances without request data", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-lifetime-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = new LifetimeUsage(directory)
  assert.equal(lifetimeCost(await first.totals()), "lifetime: no recorded usage")
  await Promise.all([first.record({ input: 100, output: 20, cost: 0.01 }), first.record({ input: 200, output: 30 })])
  const restarted = new LifetimeUsage(directory)
  await restarted.record({ input: 300, output: 40, cost: 0.02 })
  const totals = await restarted.totals()
  assert.deepEqual({ ...totals, since: null }, { requests: 3, input: 600, output: 90, priced: 2, cost: 0.03, since: null })
  assert.match(lifetimeReport(totals), /lifetime: \$0\.0300 \(partial pricing\)/)
  assert.match(lifetimeReport(totals), /Pricing available: 2\/3 requests/)
  assert.ok(totals.since! <= Date.now())
  const files = await readdir(directory)
  assert.equal(files.length, 2, "compact snapshots grow by instance, not by request")
  for (const file of files) {
    const contents = JSON.parse(await readFile(path.join(directory, file), "utf8"))
    assert.deepEqual(Object.keys(contents).sort(), ["version", "requests", "input", "output", "priced", "cost", "since"].sort())
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
  for (const contents of ["{", "x".repeat(1025), original.replace('"version":1', '"version":2'), original.replace('"requests":1', '"requests":-1')]) {
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
