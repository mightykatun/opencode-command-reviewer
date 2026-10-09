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
import { DatabaseSync } from "node:sqlite"
import { tsImport } from "tsx/esm/api"

const scenario = process.argv[2] ?? "covered"
const production = process.argv.includes("--production-history")
assert.ok(["covered", "countdown", "navigation", "dialog", "fullscreen", "hide", "narrow", "manual", "mode", "error", "zero"].includes(scenario))
assert.ok(production || ["covered", "countdown", "dialog", "fullscreen"].includes(scenario))
const negative = production && ["dialog", "fullscreen", "hide", "narrow", "manual", "mode"].includes(scenario)
const root = path.resolve(import.meta.dirname, "..")
const host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8", timeout: 10000 }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-history-render-"))
const project = path.join(temp, "project")
const artifacts = path.join(root, ".runtime", `${production ? "history-auto" : "history-render"}-${scenario}`)
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
import { withHistoryRenderProbe, withHistoryObservations } from ${JSON.stringify(pathToFileURL(bundle).href)}
import { BoxRenderable, TextRenderable } from '@opentui/core'
import { writeFile, rename } from 'node:fs/promises'
import { createEffect } from 'solid-js'
const file = ${JSON.stringify(observations)}
export default { id: 'history-render-probe', tui: async (api, options) => {
  const records = { renders: [], diagnostics: [], toggles: [], replies: [], notifications: [], gates: [], dropped: 0 }
  let dirty = false, writing, last = new Map()
  function persist() {
    dirty = true
    if (!writing) writing = (async () => {
      while (dirty) { dirty = false; await writeFile(file + '.tmp', JSON.stringify(records)); await rename(file + '.tmp', file) }
    })().finally(() => { writing = undefined; if (dirty) void persist() })
    return writing
  }
  createEffect(() => { records.gates.push({ at: performance.now(), dialog: api.ui.dialog.open }); void persist() })
  ${production ? "let opened = false;" : `const cover = new BoxRenderable(api.renderer, { id: 'history-proof-cover', position: 'absolute', top: 0, right: 0, width: 42, height: '100%', zIndex: 2,
    padding: 2, backgroundColor: api.theme.current.backgroundPanel, visible: ${scenario !== "countdown"} })
  cover.add(new TextRenderable(api.renderer, { content: 'Analysis history\\n\\nOpaque fixture report\\n\\n1/1', fg: api.theme.current.text }))`}
  const off = api.keymap.registerLayer({ priority: 100, mode: 'base', bindings: [{ key: 'f6', cmd: () => {
    ${production ? `api.keymap.dispatchCommand('opencode-reviewer.history'); opened = true;
    records.toggles.push({ at: performance.now(), visible: opened })` : `cover.visible = !cover.visible
    records.toggles.push({ at: performance.now(), visible: cover.visible })`}
    void persist()
  } }, { key: 'f7', cmd: () => api.keymap.dispatchCommand('opencode-reviewer.disable') },
  { key: 'f8', cmd: () => api.keymap.dispatchCommand('opencode-reviewer.enable') }] })
  api.event.on('permission.replied', event => { records.replies.push({ at: performance.now(), reply: event.properties.reply }); void persist() })
  const observe = event => {
    records.session = api.route.current.params?.sessionID
    const { at, ...state } = event
    const signature = JSON.stringify(state)
    if (last.get(event.stage) === signature) return
    last.set(event.stage, signature)
    if (records.renders.length < 1024) records.renders.push(event); else records.dropped++
    return persist()
  }
  const diagnostic = event => {
    if (records.diagnostics.length < 512) records.diagnostics.push(event); else records.dropped++
    return persist()
  }
  await ${production ? `withHistoryObservations(observe, diagnostic, () => ({
    show: async event => { records.notifications.push({ ...event, at: performance.now() }); await persist(); return { close() {} } },
    dispose: async () => {}
  }))` : "withHistoryRenderProbe({ cover: () => cover, observe }, diagnostic)"}(api, options)
  ${production ? "" : "api.slots.register({ slots: { app: () => cover } })"}
  api.lifecycle.onDispose(async () => { off(); ${production ? "" : "cover.destroyRecursively();"} await writing })
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
      if (review && production && scenario === "mode") {
        res.writeHead(200, { "Content-Type": "text/event-stream" })
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify({ safe: true, desc }) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`)
        return
      }
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
const delay = scenario === "zero" ? 0 : scenario === "countdown" || negative ? 6 : 3
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
let sql, sequence = 0
const seed = async n => {
  if (!sql) {
    const { HistorySQL } = await tsImport("../src/history-schema.ts", import.meta.url)
    sql = new HistorySQL(new DatabaseSync(path.join(temp, "state/opencode/opencode-reviewer/history-v1.sqlite")))
  }
  const { encodeEvent } = await tsImport("../src/history-records.ts", import.meta.url)
  const session = (await data()).session
  sql.apply("history-auto-seed", ++sequence, encodeEvent({ type: "permissionResolved",
    context: { scope: project, root: session, session, permission: "seed-p" + n, review: "seed-r" + n,
      category: "bash", configuredModel: "fixture", provider: "https://history.invalid/v1" },
    at: n, outcome: "manual", payload: { completedAt: n, safe: true, desc: "Saved history " + n } }))
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false, permission: { bash: "ask" },
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: base + "/main", apiKey: "synthetic-only" },
      models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[plugin, { notify: production, baseURL: base + "/review", model: "fixture", stream: true,
    autoApprove: true, autoApproveDelaySeconds: delay, timeoutMs: 120000 }]] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "render", "-x", "160", "-y", "40", "-c", project, "env", ...Object.entries(env).map(([k,v]) => `${k}=${v}`), host, project, "--prompt", "Run the isolated render fixture.")
  await until(s => !!review && s.includes("Permission required"), 90000)
  await until(async () => !!(await data()).session)
  if (production && ["countdown", "navigation", "error"].includes(scenario)) { await seed(1); await seed(2) }
  if (production && scenario === "error") sql.db.exec("UPDATE history SET completed=-1")
  if (production && scenario !== "countdown") {
    send("F6")
    await until(s => s.includes("Analysis history") && s.includes(scenario === "error" ? "History could not be read" : scenario === "navigation" ? "2/2" : "No history entries"))
    if (scenario === "navigation") { send("Left"); await until(s => s.includes("1/2") && s.includes("Saved history 1")) }
    await save("actual-empty-history")
  }
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
  if (!production && scenario === "dialog") { send("C-p"); await until(s => s.includes("Commands")) }
  if (!production && scenario === "fullscreen") { send("C-f"); await until(s => s.includes("minimize") && !s.includes("Analysis history")) }
  const terminalAt = Date.now()
  review.done()
  if (!production && ["dialog", "fullscreen"].includes(scenario)) {
    await pending(delay * 1000 + 300)
    await save("native-cover-blocked")
    if (scenario === "dialog") send("Escape"); else send("C-f")
  }
  await until(async () => (await data()).renders.some(event => event.stage === "frame" && event.eligible && (event.auto === "countdown" || delay === 0)))
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
  if (negative) {
    const earlierAttention = record.notifications.filter(event => event.kind === "attention").length
    if (scenario === "dialog") {
      send("C-p"); await until(s => s.includes("Commands"))
      send("C-u"); send("-l", "Reviewer: Report history"); await until(s => s.includes("Reviewer: Report history"))
      send("Enter"); await until(s => !s.includes("Commands"))
    }
    if (scenario === "fullscreen") { send("C-f"); await until(s => s.includes("minimize") && !s.includes("Analysis history")); await sleep(500); send("C-f") }
    if (scenario === "hide") { send("C-x", "b"); await until(s => !s.includes("Analysis history")); send("C-x", "b") }
    if (scenario === "narrow") {
      runtime.tmux("resize-window", "-t", "render", "-x", "90", "-y", "40"); await until(s => !s.includes("Analysis history"))
      runtime.tmux("resize-window", "-t", "render", "-x", "160", "-y", "40")
    }
    if (scenario === "manual" || scenario === "mode") {
      send("Escape"); await until(s => s.includes("COVERED LIVE REPORT"))
      const lines = capture().split("\n"), y = lines.findIndex(line => line.includes("Cancel"))
      assert.ok(y >= 0)
      const x = lines[y].lastIndexOf("Cancel") + 2
      send("-l", `\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`)
      await until(s => s.includes("Auto-approval canceled"))
      send("F6")
    }
    if (scenario === "mode") {
      send("F7"); await until(s => s.includes("Reviewer disabled for this conversation."))
      send("F8"); await until(s => s.includes("Reviewer enabled for this conversation."))
      await until(() => calls.filter(call => call.url === "/review/chat/completions").length === 2)
    }
    await until(s => s.includes("Analysis history")); send("Escape")
    await until(s => s.includes("Auto-approval canceled")); await save("cancelled-after-native-gate")
    send("F6"); await until(s => s.includes("Analysis history")); send("Escape")
    await until(s => s.includes("Auto-approval canceled"))
    await sleep((delay + 2) * 1000); await unchanged()
    record = await data()
    assert.equal(record.replies.length, 0)
    assert.equal(record.notifications.filter(event => event.kind === "approved").length, 0)
    assert.equal(record.notifications.filter(event => event.kind === "attention").length, earlierAttention + 1, "one renewed manual-wait episode, no history replay births")
    assert.ok(record.renders.some(event => event.auto === "cancelled"))
    await save("manual-tombstone")
    await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ scenario, temp, ...record }, null, 2))
    outcome = "passed"
    console.log(`PASS history-auto ${scenario}: actual native gate cancels, history close/reopen cannot revive`)
  } else {
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
    if (production) { await until(s => s.includes("2/2")); send("Left"); await until(s => s.includes("1/2")); await save("ongoing-navigation") }
    await until(async () => (await data()).renders.some(event => event.covered && event.auto === "countdown" && event.seconds <= delay - 2))
    await save("ongoing-covered")
    send(production ? "Escape" : "F6")
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
  assert.ok(reply.at - ready.at >= (delay ? delay + 1 : 0) * 1000 - 100, "positive countdown retains initial hold")
  if (scenario === "countdown") {
    assert.ok(reply.at - ready.at < (delay + 2.5) * 1000, "cover changes did not restart countdown")
    const frames = record.renders.filter(event => event.stage === "frame" && event.auto === "countdown")
    assert.equal(new Set(frames.map(event => event.panel)).size, 1)
    assert.equal(new Set(frames.map(event => event.markdown)).size, 1)
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].seconds <= frames[i - 1].seconds)
    assert.ok(frames.every(event => event.eligible), "no spurious presentation loss during toggles")
    if (production) assert.ok(frames.some(event => event.covered && event.history === "loading"), "actual footerless loading frame preserves countdown")
    assert.equal(record.toggles.length, production ? 1 : 2)
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
  if (production) {
    if (scenario === "error") sql.db.exec("UPDATE history SET completed=1 WHERE completed=-1")
    if (scenario === "countdown") send("F6")
    const total = ["countdown", "navigation", "error"].includes(scenario) ? 3 : 1
    if (scenario === "navigation") {
      await until(s => s.includes("1/3") && s.includes("Saved history 1")); await save("committed-no-jump")
      send("Right"); await until(s => s.includes("2/3") && s.includes("Saved history 2"))
      send("Right")
    }
    if (scenario === "error") await until(s => s.includes("/3"))
    await until(s => s.includes("Auto approved") && s.includes(`${total}/${total}`) && s.includes("COVERED LIVE REPORT"))
    await until(async () => (await data()).notifications.some(event => event.kind === "approved"))
    await until(async () => (await data()).notifications.some(event => event.kind === "ended"))
    const before = (await data()).notifications
    const callsBeforeReplay = calls.length
    assert.equal(before.filter(event => event.kind === "approved" && event.sound).length, 1)
    const attention = before.filter(event => event.kind === "attention")
    assert.ok(attention.length <= 1)
    for (const event of attention) {
      assert.ok(event.at >= validated.at + 900 && event.at <= ready.at,
        "only the existing one-second final-render grace may notify before countdown; countdown stays silent")
    }
    send("Left")
    await until(s => s.includes(`${Math.max(1, total - 1)}/${total}`))
    send("Right"); await until(s => s.includes(`${total}/${total}`))
    send("Escape"); await until(s => !s.includes("Analysis history"))
    send("-l", "/reviewer-history"); await until(s => s.includes("Reviewer: Report history")); send("Enter")
    await until(s => s.includes(`${total}/${total}`))
    await sleep(2300)
    assert.deepEqual((await data()).notifications, before, "history replay creates no notification birth or sound")
    assert.equal(calls.length, callsBeforeReplay, "history keys, Close and slash create no model requests")
    assert.deepEqual((await data()).replies.map(event => event.reply), ["once"], "history controls never submit an approval")
    record = await data()
  }
  await save("resolved")
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ scenario, temp, packedFiles: [...files.keys()], executions: executions.length,
    terminalAt, startedAt, ...record }, null, 2))
  outcome = "passed"
  console.log(`PASS ${production ? "history-auto" : "history-render"} ${scenario}: actual Markdown readiness, terminal-only countdown, one native execution. ${artifacts}`)
  }
} catch (error) {
  await save("failed").catch(() => {})
  await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, temp, errors, observations: await data().catch(() => null) }, null, 2))
  throw error
} finally {
  sql?.close()
  await runtime.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await writeFile(path.join(artifacts, "metrics.json"), JSON.stringify(metrics.snapshot(outcome), null, 2))
}
