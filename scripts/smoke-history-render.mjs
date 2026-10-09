// Phase 0: real production Markdown below an opaque fixture-owned cover.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeRuntime, smokeMetrics } from "./smoke-runtime.mjs"
import { inspectPackageArchive } from "./release-artifact.mjs"

const scenario = process.argv[2] ?? "covered"
assert.ok(["covered", "countdown", "dialog", "fullscreen"].includes(scenario))
const root = path.resolve(import.meta.dirname, "..")
const host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8", timeout: 10000 }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-history-render-"))
const project = path.join(temp, "project")
const artifacts = path.join(root, ".runtime", `history-render-${scenario}`)
await mkdir(project)
await mkdir(path.join(temp, "config"))
await mkdir(artifacts, { recursive: true })
execFileSync("git", ["init", "--quiet", project])
const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: root, encoding: "utf8" }))
const pack = Array.isArray(packed) ? packed[0] : packed["opencode-reviewer"]
const { files } = inspectPackageArchive(await readFile(path.join(temp, pack.filename)))
assert.equal(files.size, 5)
const bundle = path.join(temp, "bundle.mjs")
await writeFile(bundle, files.get("dist/tui.js"))
const observations = path.join(temp, "observations.json")
const plugin = path.join(temp, "probe.mjs")
await writeFile(plugin, `
import { withHistoryRenderProbe } from ${JSON.stringify(pathToFileURL(bundle).href)}
import { BoxRenderable, TextRenderable } from '@opentui/core'
import { writeFile, rename } from 'node:fs/promises'
const file = ${JSON.stringify(observations)}
export default { id: 'history-render-probe', tui: async (api, options) => {
  const records = { renders: [], diagnostics: [], toggles: [], replies: [], dropped: 0 }
  let dirty = false, writing, last = new Map()
  function persist() {
    dirty = true
    if (!writing) writing = (async () => {
      while (dirty) { dirty = false; await writeFile(file + '.tmp', JSON.stringify(records)); await rename(file + '.tmp', file) }
    })().finally(() => { writing = undefined; if (dirty) void persist() })
    return writing
  }
  const cover = new BoxRenderable(api.renderer, { id: 'history-proof-cover', position: 'absolute', top: 0, right: 0, width: 42, height: '100%', zIndex: 2,
    padding: 2, backgroundColor: api.theme.current.backgroundPanel, visible: ${scenario !== "countdown"} })
  cover.add(new TextRenderable(api.renderer, { content: 'Analysis history\\n\\nOpaque fixture report\\n\\n1/1', fg: api.theme.current.text }))
  const off = api.keymap.registerLayer({ priority: 100, mode: 'base', bindings: [{ key: 'f6', cmd: () => {
    cover.visible = !cover.visible
    records.toggles.push({ at: performance.now(), visible: cover.visible })
    void persist()
  } }] })
  api.event.on('permission.replied', event => { records.replies.push({ at: performance.now(), reply: event.properties.reply }); void persist() })
  await withHistoryRenderProbe({ cover: () => cover, observe: event => {
    const { at, ...state } = event
    const signature = JSON.stringify(state)
    if (last.get(event.stage) === signature) return
    last.set(event.stage, signature)
    if (records.renders.length < 1024) records.renders.push(event); else records.dropped++
    return persist()
  } }, event => {
    if (records.diagnostics.length < 512) records.diagnostics.push(event); else records.dropped++
    return persist()
  })(api, options)
  api.slots.register({ slots: { app: () => cover } })
  api.lifecycle.onDispose(async () => { off(); cover.destroyRecursively(); await writing })
} }
`)
await writeFile(path.join(project, "fixture.py"), 'from pathlib import Path\nimport time\nwith Path("executions").open("a") as f:\n    f.write(str(time.time_ns() // 1000000) + "\\n")\n')
const marker = path.join(project, "executions")
const desc = 'COVERED LIVE REPORT\n\n```python\n# UNDERLYING_HIGHLIGHT\nfruit = "apple"\nprint(fruit)\n```\n\nFinal production Markdown.'
const calls = [], errors = []
let review, toolSent = false
const server = createServer(async (req, res) => {
  try {
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    calls.push({ url: req.url, body })
    if (req.url === "/review/chat/completions") {
      assert.equal(review, undefined, "exactly one reviewer POST")
      assert.equal(body.stream, true)
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders()
      review = {
        content: content => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`),
        stop: () => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`),
        done: () => res.end('data: [DONE]\n\n'),
      }
      return
    }
    const doTool = !toolSent && body.tools?.some(tool => tool.function?.name === "bash")
    if (doTool) toolSent = true
    const message = doTool ? { role: "assistant", content: null, tool_calls: [{ index: 0, id: "history_probe", type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: "python3 fixture.py", description: "Isolated history render proof" }) } }] }
      : { role: "assistant", content: "History render fixture complete." }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      for (const [delta, finish_reason] of [[message, null], [{}, doTool ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      }
      res.end("data: [DONE]\n\n")
    } else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] })) }
  } catch (error) { errors.push(String(error)); res.destroy() }
})
const metrics = smokeMetrics(server, { pollIntervalMs: 80, hostVersion: "1.18.35" })
const runtime = await smokeRuntime(temp)
const capture = () => runtime.tmux("capture-pane", "-p", "-t", "render")
const send = (...keys) => runtime.tmux("send-keys", "-t", "render", ...keys)
const data = async () => JSON.parse(await readFile(observations, "utf8"))
const until = async (check, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check(capture())) return; await sleep(80) }
  throw Error(`Timed out: history render ${scenario}`)
}
const save = async stage => {
  await writeFile(path.join(artifacts, stage + ".txt"), capture())
  await writeFile(path.join(artifacts, stage + ".ansi"), runtime.tmux("capture-pane", "-p", "-e", "-t", "render"))
}
const unchanged = () => assert.rejects(access(marker))
const delay = scenario === "countdown" ? 6 : 3
const pending = async ms => {
  const end = Date.now() + ms
  do {
    assert.match(capture(), /Permission required/)
    await unchanged()
    const record = await data()
    assert.ok(!record.renders.some(event => event.eligible || event.auto === "countdown"))
    assert.ok(!record.diagnostics.some(event => event.phase === "approval-countdown" || event.phase === "approval-reply"))
    await sleep(80)
  } while (Date.now() < end)
}
let outcome = "failed"
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false, permission: { bash: "ask" },
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: base + "/main", apiKey: "synthetic-only" },
      models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[plugin, { notify: false, baseURL: base + "/review", model: "fixture", stream: true,
    autoApprove: true, autoApproveDelaySeconds: delay, timeoutMs: 120000 }]] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "render", "-x", "160", "-y", "40", "-c", project, "env", ...Object.entries(env).map(([k,v]) => `${k}=${v}`), host, project, "--prompt", "Run the isolated render fixture.")
  await until(s => !!review && s.includes("Permission required"), 90000)
  await until(async () => (await data()).renders.length > 0)
  review.content('{"safe":true,')
  await pending(500)
  review.content('"desc":' + JSON.stringify(desc) + '}')
  review.stop()
  await pending(delay * 1000 + 300)
  await save("complete-json-held-terminal")
  if (scenario !== "countdown") {
    assert.match(capture(), /Analysis history/)
    assert.doesNotMatch(capture(), /COVERED LIVE REPORT|UNDERLYING_HIGHLIGHT/)
    assert.ok(!(await data()).diagnostics.some(event => event.phase === "first-display"))
  }
  if (scenario === "dialog") { send("C-p"); await until(s => s.includes("Commands")) }
  if (scenario === "fullscreen") { send("C-f"); await until(s => s.includes("minimize") && !s.includes("Analysis history")) }
  const terminalAt = Date.now()
  review.done()
  if (["dialog", "fullscreen"].includes(scenario)) {
    await pending(delay * 1000 + 300)
    await save("native-cover-blocked")
    if (scenario === "dialog") send("Escape"); else send("C-f")
  }
  await until(async () => (await data()).renders.some(event => event.stage === "frame" && event.eligible && event.auto === "countdown"))
  const startedAt = Date.now()
  await save("countdown-started")
  let record = await data()
  const ready = record.renders.find(event => event.stage === "frame" && event.eligible)
  const painted = record.renders.find(event => event.stage === "render-after" && event.painted && event.panel === ready.panel)
  assert.ok(painted && painted.at <= ready.at, "matching renderAfter precedes readiness")
  for (const event of [painted, ready]) {
    assert.equal(event.final, true)
    assert.equal(event.streaming, false)
    assert.equal(event.contentMatches, true)
    assert.ok(event.children > 0 && event.codeBlocks > 0, "real fenced-code renderables exist")
    assert.equal(event.highlighting, false)
    assert.equal(event.painted, true)
  }
  const validated = record.diagnostics.find(event => event.phase === "final-validation")
  assert.ok(validated && validated.at <= painted.at)
  if (scenario !== "countdown") {
    assert.equal(ready.covered, true)
    assert.equal(ready.physical, false)
    if (scenario === "covered") assert.equal(painted.covered, true)
    assert.ok(!record.diagnostics.some(event => event.phase === "first-display" || event.phase === "final-render"))
  } else {
    assert.match(capture(), /UNDERLYING_HIGHLIGHT/)
    const ansi = runtime.tmux("capture-pane", "-p", "-e", "-t", "render")
    assert.match(ansi, /\x1b\[[0-9;]*3[;m][^\n]*UNDERLYING_HIGHLIGHT/, "actual code comment syntax emphasis")
    await until(s => s.includes(`Allowed in ${delay - 1}s`))
    send("F6")
    await until(s => s.includes("Analysis history") && !s.includes("COVERED LIVE REPORT"))
    await until(async () => (await data()).renders.some(event => event.covered && event.auto === "countdown" && event.seconds <= delay - 2))
    await save("ongoing-covered")
    send("F6")
    await until(s => s.includes("COVERED LIVE REPORT") && !s.includes("Analysis history"))
    await save("ongoing-uncovered")
  }
  await until(async () => access(marker).then(() => true, () => false), 15000)
  await until(s => !s.includes("Permission required"))
  await until(async () => (await data()).diagnostics.some(event => event.phase === "approval-reply"))
  record = await data()
  const executions = (await readFile(marker, "utf8")).trim().split("\n")
  assert.equal(executions.length, 1, "native harmless command executes exactly once")
  assert.ok(Number(executions[0]) - terminalAt >= delay * 1000)
  assert.ok(Number(executions[0]) - startedAt >= delay * 1000 - 300)
  const reply = record.diagnostics.find(event => event.phase === "approval-reply")
  assert.ok(reply.at - ready.at >= (delay + 1) * 1000 - 100, "positive countdown retains initial hold")
  if (scenario === "countdown") {
    assert.ok(reply.at - ready.at < (delay + 2.5) * 1000, "cover changes did not restart countdown")
    const frames = record.renders.filter(event => event.stage === "frame" && event.auto === "countdown")
    assert.equal(new Set(frames.map(event => event.panel)).size, 1)
    assert.equal(new Set(frames.map(event => event.markdown)).size, 1)
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].seconds <= frames[i - 1].seconds)
    assert.ok(frames.every(event => event.eligible), "no spurious presentation loss during toggles")
    assert.equal(record.toggles.length, 2)
  } else {
    assert.ok(!record.diagnostics.some(event => event.phase === "first-display" || event.phase === "final-render"), "covered rendering is never a physical-display claim")
  }
  assert.equal(record.diagnostics.filter(event => event.phase === "approval-countdown").length, 1)
  assert.equal(record.diagnostics.filter(event => event.phase === "approval-reply").length, 1)
  assert.deepEqual(record.replies.map(event => event.reply), ["once"])
  assert.ok(!record.renders.some(event => event.auto === "cancelled" || event.auto === "failed"))
  assert.equal(record.dropped, 0)
  assert.equal(calls.filter(call => call.url === "/review/chat/completions").length, 1)
  for (const call of calls.filter(call => call.url === "/main/chat/completions")) {
    assert.doesNotMatch(JSON.stringify(call.body.messages), /Opaque fixture report|COVERED LIVE REPORT|UNDERLYING_HIGHLIGHT/)
  }
  assert.deepEqual(errors, [])
  await save("resolved")
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ scenario, temp, packedFiles: [...files.keys()], executions: executions.length,
    terminalAt, startedAt, ...record }, null, 2))
  outcome = "passed"
  console.log(`PASS history-render ${scenario}: actual Markdown readiness, terminal-only countdown, one native execution. ${artifacts}`)
} catch (error) {
  await save("failed").catch(() => {})
  await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, temp, errors, observations: await data().catch(() => null) }, null, 2))
  throw error
} finally {
  await runtime.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await writeFile(path.join(artifacts, "metrics.json"), JSON.stringify(metrics.snapshot(outcome), null, 2))
}
