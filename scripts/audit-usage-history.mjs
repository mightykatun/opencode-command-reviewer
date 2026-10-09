// Local, deterministic provider-response replay against the actual v0.7.0 tag
// and current source. No provider calls, user stores, reset or repair operations.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "esbuild"
import { DatabaseSync } from "node:sqlite"

const root = path.resolve(import.meta.dirname, ".."), ref = "v0.7.0"
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
const commit = git("rev-parse", `${ref}^{commit}`).trim()
const prompts = Object.fromEntries(["shell", "edit", "mcp", "custom", "external-directory", "extraCareful", "contract", "correction"].map(key => [key, "Fixture review {{validationError}}"] ))
async function load(historical) {
  const contents = `export { review } from './src/reviewer.js'; export { parseConfig } from './src/config.js';
    export { responseUsage } from './src/usage.js'; export { lifetimeReport } from './src/lifetime.js';
    ${historical ? "export { LifetimeUsage } from './src/lifetime.js'" : "export { HistorySQL } from './src/history-schema.js'"}`
  const result = await build({ stdin: { contents, resolveDir: root, sourcefile: "audit-entry.js" }, bundle: true, write: false,
    platform: "node", format: "esm", target: "es2023", define: { __REVIEW_PROMPTS__: JSON.stringify(prompts) },
    plugins: historical ? [{ name: "historical-source", setup(builder) {
      builder.onResolve({ filter: /^\./ }, args => {
        const base = args.namespace === "historical" ? path.posix.dirname(args.importer) : ""
        const file = path.posix.normalize(path.posix.join(base, args.path)).replace(/\.js$/, ".ts")
        return { path: file, namespace: "historical" }
      })
      builder.onLoad({ filter: /.*/, namespace: "historical" }, args => ({
        contents: git("show", `${ref}:${args.path}`), loader: args.path.endsWith(".json") ? "json" : "ts",
      }))
    } }] : [] })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`)
}
const directory = await mkdtemp(path.join(tmpdir(), "reviewer-usage-audit-"))
const observations = []
try {
  for (const historical of [true, false]) {
    const module = await load(historical), name = historical ? ref : "current"
    const local = path.join(directory, name); await mkdir(local)
    const legacy = historical ? new module.LifetimeUsage(path.join(local, "usage-v4"), path.join(local, "usage-v1")) : undefined
    const sql = historical ? undefined : new module.HistorySQL(new DatabaseSync(path.join(local, "history.sqlite")))
    const writes = [], received = [], dispatched = [], bodies = []
    let sequence = 0, posts = 0
    const context = { scope: "/fixture", root: "root", session: "child", permission: "p", review: "r",
      category: "bash", configuredModel: "fixture", provider: "https://openrouter.ai/api/v1" }
    const persist = (usage) => {
      received.push(usage)
      if (legacy) writes.push(legacy.record(usage))
    }
    const config = module.parseConfig({ baseURL: context.provider, model: "fixture", stream: true, formatRetries: 1 })
    const frame = body => `data: ${JSON.stringify(body)}\n\n`
    const completion = (content, counts) => new Response([
      frame({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }),
      ...counts.map(usage => frame({ choices: [], usage })),
      frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }), "data: [DONE]\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } })
    const usage = (input, output, cost) => ({ prompt_tokens: input, completion_tokens: output, cost,
      prompt_tokens_details: { cached_tokens: input / 2, cache_write_tokens: input / 10 } })
    const evidence = { kind: "shell", command: "printf fixture", files: [] }
    const result = await module.review(evidence, config, new AbortController().signal, async (_url, request) => {
      bodies.push(JSON.parse(request.body)); posts++
      return posts === 1 ? completion('{"safe":"invalid","desc":"format correction fixture"}',
        [usage(1000, 10, 0.01), usage(1200, 30, 0.012), usage(1200, 30, 0.012)])
        : completion('{"safe":true,"desc":"Final validated report"}', [usage(1500, 40, 0.015), usage(1500, 40, 0.015)])
    }, {}, undefined, undefined, persist, undefined, undefined,
    () => { if (legacy) writes.push(legacy.recordRetry()) },
    { review: "r", observe: event => {
      dispatched.push(event)
      sql.apply("audit", ++sequence, JSON.stringify(event.type === "dispatched"
        ? { type: "attemptDispatched", context, at: sequence, attempt: event.attempt, retry: event.retry }
        : { type: "attemptFinalized", context, at: sequence, attempt: event.attempt, usage: event.usage }))
    } })
    assert.equal(posts, 2); assert.equal(received.length, 2)
    assert.deepEqual(result.usage, { input: 2700, output: 70, cost: 0.027 })
    assert.deepEqual(received.map(u => [u.input, u.output]), [[1200, 30], [1500, 40]])
    assert.equal(bodies[1].messages.length, 4, "correction resends the original evidence plus failed output and feedback")
    if (legacy) writes.push(legacy.recordRating(true, { fullReportMs: 100, ratingMs: 50 }))
    else sql.apply("audit", ++sequence, JSON.stringify({ type: "reviewAccepted", context, at: sequence,
      accepted: { safe: true, completedAt: sequence, timing: { fullReportMs: 100, ratingMs: 50 } } }))
    await Promise.all(writes)
    const totals = legacy ? await legacy.totals() : sql.query({ type: "totals" }).totals
    assert.equal(totals.input, 2700); assert.equal(totals.output, 70); assert.equal(totals.requests, 2)
    assert.equal(totals.activity.reviews, 1); assert.equal(totals.activity.retries, 1)
    for (let i = 0; i < 5; i++) assert.deepEqual(legacy ? await legacy.totals() : sql.query({ type: "totals" }).totals, totals)
    if (legacy) {
      const resumed = new module.LifetimeUsage(path.join(local, "usage-v4"), path.join(local, "usage-v1"))
      assert.deepEqual(await resumed.totals(), totals)
      await mkdir(path.join(local, "usage-v1"))
      await writeFile(path.join(local, "usage-v1", "00000000-0000-0000-0000-000000000001.json"), JSON.stringify({
        version: 1, requests: 1, input: 100, output: 5, priced: 0, cost: 0, since: 1,
      }))
      assert.equal((await resumed.totals()).input, 2800, "legacy history is summed once, not per refresh or restart")
      assert.equal((await resumed.totals()).input, 2800)
    } else {
      assert.equal(dispatched.filter(e => e.type === "dispatched").length, 2)
      assert.equal(new Set(dispatched.map(e => e.attempt)).size, 2)
      sql.close()
      const resumed = new module.HistorySQL(new DatabaseSync(path.join(local, "history.sqlite")))
      assert.deepEqual(resumed.query({ type: "totals" }).totals, totals)
      assert.deepEqual(resumed.query({ type: "conversationTotals", scope: "/fixture", root: "root" }).totals, totals)
      resumed.close()
    }
    const cached = module.responseUsage({ usage: usage(1000, 20, 0.01) }, "fixture", () => ({ input: 1, output: 2, cache: { read: 0.1, write: 1 } }), "https://generic.example/v1")
    assert.equal(cached.input, 1000); assert.equal(cached.output, 20)
    assert.ok(Math.abs(cached.cost - 0.00059) < 1e-12)
    assert.match(module.lifetimeReport(totals), /Tokens: 2700 in 70 out/)
    const failed = [], interrupted = []
    await assert.rejects(module.review(evidence, { ...config, stream: false, formatRetries: 0 }, new AbortController().signal,
      async () => new Response(JSON.stringify({ usage: usage(320, 11, 0.0032), error: { message: "synthetic terminal error" } })),
      {}, undefined, undefined, value => failed.push(value)))
    assert.deepEqual(failed, [{ input: 320, output: 11, cost: 0.0032 }])
    const abort = new AbortController()
    await assert.rejects(module.review(evidence, config, abort.signal, async () => new Response([
      frame({ choices: [], usage: usage(400, 9, 0.004) }),
      frame({ choices: [{ index: 0, delta: { content: '{"safe":true,' }, finish_reason: null }] }),
    ].join(""), { headers: { "content-type": "text/event-stream" } }), {}, undefined, undefined,
    value => interrupted.push(value), progress => { if (progress.preview) abort.abort() }))
    assert.deepEqual(interrupted, [{ input: 400, output: 9, cost: 0.004 }])
    observations.push({ version: name, commit: historical ? commit : undefined, posts, received: received.length,
      input: totals.input, output: totals.output, retries: totals.activity.retries, reviews: totals.activity.reviews,
      cacheInput: cached.input, repeatedReadsAndRestart: "unchanged", failedUsage: failed[0], interruptedUsage: interrupted[0] })
  }
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, ".runtime/usage-history-audit.json"), JSON.stringify(observations, null, 2))
  console.log(JSON.stringify(observations, null, 2))
  console.log("PASS: historical/current cumulative usage, per-POST finalization, correction aggregation, caching, persistence, refresh and display")
} finally { await rm(directory, { recursive: true, force: true }) }
