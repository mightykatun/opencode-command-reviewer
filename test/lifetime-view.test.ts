import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setImmediate as settle } from "node:timers/promises"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { LifetimeUsage, type LifetimeTotals } from "../src/lifetime.js"
import { lifetimeTracker } from "../src/lifetime-view.js"
import { usageAttempt } from "../src/usage.js"

const totals = (requests: number): LifetimeTotals => ({ requests, tokenRequests: requests, input: requests * 10,
  output: requests * 2, priced: requests, cost: requests * 0.01, since: 1700000000000,
  safe: requests, unsafe: 0, ratingsSince: requests ? 1700000000000 : null })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

async function fixture(t: TestContext) {
  const state = await mkdtemp(path.join(tmpdir(), "review-lifetime-ui-"))
  const directory = path.join(state, "opencode-reviewer", "usage-v3")
  const originalTotals = LifetimeUsage.prototype.totals
  const calls: { signal: AbortSignal; value: ReturnType<typeof deferred<LifetimeTotals>>; cleanup: ReturnType<typeof deferred<void>> }[] = []
  let actual = 0, maximum = 0, replacements = 0, open = false, unregistered = 0
  t.mock.method(LifetimeUsage.prototype, "totals", async (signal: AbortSignal) => {
    actual++
    maximum = Math.max(maximum, actual)
    const call = { signal, value: deferred<LifetimeTotals>(), cleanup: deferred<void>() }
    calls.push(call)
    try { return await call.value.promise }
    finally { await call.cleanup.promise; actual-- }
  })
  const parent = new AbortController()
  const disposers: (() => void)[] = []
  let command!: { run: () => void }
  const api = {
    state: { path: { state } },
    lifecycle: { signal: parent.signal, onDispose: (run: () => void) => { disposers.push(run) } },
    keymap: { registerLayer: (layer: { commands: { run: () => void }[] }) => {
      command = layer.commands[0]!
      return () => { unregistered++ }
    } },
    // Keep the render callback unopened: async refreshes must never replace a
    // dismissed host dialog, independently of JSX or host rendering mechanics.
    ui: { dialog: { replace: () => { replacements++; open = true } } },
  } as unknown as TuiPluginApi
  const tracker = lifetimeTracker(api)
  const dispose = () => { parent.abort(); for (const run of disposers.splice(0)) run() }
  const finish = (index: number, value = totals(index + 1)) => { calls[index]!.value.resolve(value); calls[index]!.cleanup.resolve() }
  const saved = () => originalTotals.call(new LifetimeUsage(directory))
  t.after(async () => {
    dispose()
    for (const call of calls) { call.value.resolve(totals(0)); call.cleanup.resolve() }
    await settle()
    await tracker.flush()
    await rm(state, { recursive: true, force: true })
    assert.equal(actual, 0)
    assert.ok(maximum <= 1)
  })
  await settle()
  return { tracker, calls, directory, command, dispose, finish, saved,
    dismiss: () => { open = false }, counts: () => ({ actual, maximum, reads: calls.length, replacements, open, unregistered }) }
}

test("palette refresh updates tracker state without replacing or reopening a dismissed dialog", async (t) => {
  const f = await fixture(t)
  assert.equal(f.counts().replacements, 0)
  f.finish(0, totals(1))
  await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0100\nSafe: 1 · Unsafe: 0")
  f.command.run()
  await settle()
  assert.equal(f.counts().replacements, 1)
  f.dismiss()
  f.finish(1, totals(2))
  await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.0200\nSafe: 2 · Unsafe: 0")
  assert.equal(f.counts().replacements, 1)
  assert.equal(f.counts().open, false)
})

test("write failure invalidates older queued totals and a later successful record recovers all increments", async (t) => {
  const f = await fixture(t)
  await mkdir(path.dirname(f.directory), { recursive: true })
  await writeFile(f.directory, "blocked lifetime directory")
  f.command.run()
  f.tracker.record({ cost: 0.1 })
  await f.tracker.flush()
  await settle()
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  f.finish(0, totals(99))
  await settle()
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  assert.equal(f.counts().reads, 1, "a queued refresh older than the failed write stays invalidated")
  await unlink(f.directory)
  f.tracker.record({ cost: 0.2 })
  await f.tracker.flush()
  await settle()
  const saved = await f.saved()
  assert.equal(saved.requests, 2)
  assert.ok(Math.abs(saved.cost - 0.3) < 1e-12)
  assert.equal(f.counts().reads, 2)
  f.finish(1, saved)
  await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.3000\nSafe: 0 · Unsafe: 0")
})

test("rating-only records persist and refresh independently of request usage", async t => {
  const f = await fixture(t)
  f.tracker.recordRating(true); f.tracker.recordRating(false)
  await f.tracker.flush(); await settle()
  const saved = await f.saved()
  assert.equal(saved.requests, 0)
  assert.equal(saved.safe, 1); assert.equal(saved.unsafe, 1)
  f.finish(0, totals(0)); await settle()
  f.finish(1, saved); await settle()
  assert.equal(f.tracker.text(), undefined, "rating-only history stays in the palette without standalone inline usage")
  f.tracker.record({ cost: 0.1 })
  await f.tracker.flush(); await settle()
  f.finish(2, await f.saved()); await settle()
  assert.equal(f.tracker.text(), "lifetime: $0.1000\nSafe: 1 · Unsafe: 1")
})

test("disposal finalizers record and flush while timed-out totals cleanup remains outstanding", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = await fixture(t)
  f.tracker.record({ cost: 0.1 })
  await f.tracker.flush()
  await settle()
  for (let i = 0; i < 100; i++) f.command.run()
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(f.tracker.text(), "lifetime: usage unavailable")
  assert.equal(f.counts().actual, 1)

  const finishWorker = deferred<void>()
  const workerAbort = new AbortController()
  const worker = (async () => {
    const attempt = usageAttempt("https://openrouter.ai/api/v1", "fixture", undefined, f.tracker.record)
    try {
      attempt.observe({ usage: { cost: 0.2 } })
      attempt.observe({ usage: { cost: 0.2 } })
      await finishWorker.promise
      workerAbort.signal.throwIfAborted()
    } finally { attempt.finalize(); attempt.finalize() }
  })()
  const rejected = assert.rejects(worker, { name: "AbortError" })
  f.dispose()
  workerAbort.abort()
  finishWorker.resolve()
  await rejected
  await f.tracker.flush()
  const saved = await f.saved()
  assert.equal(saved.requests, 2)
  assert.equal(saved.tokenRequests, 0)
  assert.ok(Math.abs(saved.cost - 0.3) < 1e-12)
  assert.equal(f.counts().actual, 1, "write flush is independent of stalled read cleanup")
  assert.equal(f.counts().reads, 1)
  assert.equal(f.counts().unregistered, 1)
  const published = f.tracker.text()
  f.finish(0, totals(99))
  await settle()
  assert.equal(f.counts().actual, 0)
  assert.equal(f.counts().reads, 1)
  assert.equal(f.tracker.text(), published)
})
