import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeRuntime } from "./smoke-runtime.mjs"
import { notificationRecorder, assertNotificationAudio } from "./smoke-notification-recorder.mjs"

const scenario = process.argv[2] ?? "question"
assert.ok(["question", "error", "ended", "cancel", "click"].includes(scenario))
const root = path.resolve(import.meta.dirname, "..")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-notification-events-"))
const project = path.join(temp, "project")
await mkdir(project); await mkdir(path.join(temp, "config"))
execFileSync("git", ["init", "--quiet", project])
const plugin = path.join(temp, "reviewer.mjs")
await copyFile(path.join(root, "dist/tui.js"), plugin)
const records = await notificationRecorder(plugin, temp)
if (scenario === "click") await writeFile(plugin, `
import plugin, { withNotifications } from ${JSON.stringify(pathToFileURL(path.join(temp, "notification-reviewer-base.mjs")).href)}
import { appendFile } from "node:fs/promises"
let click, target
const record = value => appendFile(${JSON.stringify(path.join(temp, "notifications.jsonl"))}, JSON.stringify(value) + "\\n")
export default { id: plugin.id, tui: async (api, options) => {
  const tui = withNotifications(callback => ({
    async show(message) { click = callback; target = message.sessionID; await record({ event: "notification", title: message.title }); return { close() {} } },
    dispose() {},
  }))
  const stop = api.keymap.registerLayer({ commands: [{ name: "fixture.notification-click", namespace: "palette",
    title: "Fixture: Check notification click", run: async () => {
      try {
        if (!click || !target) throw new Error("Missing live notification callback")
        const other = await api.client.session.create({ directory: api.state.path.directory, title: "Other notification fixture root" }, { throwOnError: true })
        if (!other.data || other.data.id === target) throw new Error("Missing distinct fixture root")
        api.route.navigate("session", { sessionID: other.data.id })
        api.ui.dialog.replace(() => api.ui.DialogAlert({ title: "Notification dialog fixture", message: "This must remain open." }))
        click(target)
        if (!api.ui.dialog.open || api.route.current.params?.sessionID !== other.data.id) throw new Error("Click altered an open native dialog or conversation")
        await record({ event: "click-dialog-preserved", distinctRoot: true })
        api.ui.dialog.clear()
        click(target)
        if (api.route.current.params?.sessionID !== target) throw new Error("Click failed to return to notification root")
        await record({ event: "click-root-selected" })
      } catch (error) { await record({ event: "click-failure", error: String(error) }) }
    } }] })
  api.lifecycle.onDispose(stop)
  return tui(api, { ...options, notifySound: false })
} }
`)
let sent = false, held = false, screen = "", principal = 0
const server = createServer(async (req, res) => {
  let text = ""
  for await (const part of req) text += part
  const body = JSON.parse(text)
  assert.equal(req.url, "/main/chat/completions", "notification events must not make reviewer/model follow-up calls")
  const main = body.tools?.some(tool => tool.function?.name === "question" || tool.function?.name === "bash")
  if (main) principal++
  if (main && scenario === "error") {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "Synthetic unrecoverable fixture error" } }))
    return
  }
  const question = main && scenario === "question" && !sent
  if (question) sent = true
  const delta = question ? { role: "assistant", tool_calls: [{ index: 0, id: "fixture_question", type: "function", function: {
    name: "question", arguments: JSON.stringify({ questions: [{ header: "Fixture choice", question: "Choose a fixture option",
      options: [{ label: "First", description: "Fixture first option" }, { label: "Second", description: "Fixture second option" }] }] }),
  } }] } : { role: "assistant", content: main ? "Synthetic response complete." : "Notification fixture title" }
  if (main && scenario === "cancel") {
    held = true
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta: { role: "assistant", content: "Fixture waiting for cancellation." }, finish_reason: null }] })}\n\n`)
    return
  }
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    for (const [value, reason] of [[delta, null], [{}, question ? "tool_calls" : "stop"]]) res.write(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: reason }],
    })}\n\n`)
    res.end("data: [DONE]\n\n")
  } else {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, message: delta, finish_reason: question ? "tool_calls" : "stop" }] }))
  }
})
const runtime = await smokeRuntime(temp)
const until = async (check, ms = 90000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    await sleep(100); screen = runtime.tmux("capture-pane", "-p", "-t", "smoke")
    if (await check(screen)) return
  }
  throw new Error(`Timed out in ${scenario}: ${screen}`)
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${port}/main`, apiKey: "fixture" },
      models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[plugin, { baseURL: `http://127.0.0.1:${port}/review`, model: "fixture",
    notify: true, reviewBash: false, reviewEdits: false }]] }))
  const env = { HOME: temp, XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"),
    XDG_STATE_HOME: path.join(temp, "state"), XDG_CACHE_HOME: path.join(temp, "cache"), OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG: "", OPENCODE_TUI_CONFIG: tui, OPENCODE_CONFIG_DIR: path.join(temp, "config"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "smoke", "-x", "160", "-y", "40", "-c", project,
    "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), process.env.OPENCODE_BIN ?? "opencode", project,
    "--prompt", "Perform the notification fixture.")
  if (scenario === "question") {
    await until(async s => s.includes("Choose a fixture option") && (await records()).some(r => r.event === "sound" && r.kind === "attention"))
    assert.equal((await records()).filter(r => r.event === "notification").length, 1)
    runtime.tmux("send-keys", "-t", "smoke", "Enter")
    await until(async () => (await records()).some(r => r.event === "question.replied"), 10000)
    await until(async () => (await records()).some(r => r.event === "sound" && r.kind === "ended"), 10000)
  } else if (scenario === "cancel") {
    await until(s => held && s.includes("Fixture waiting for cancellation."))
    runtime.tmux("send-keys", "-t", "smoke", "Escape"); await sleep(150)
    runtime.tmux("send-keys", "-t", "smoke", "Escape")
    await until(async () => (await records()).some(r => r.event === "session.error" && r.error === "MessageAbortedError"), 10000)
    await sleep(500)
  } else if (scenario === "click") {
    await until(async () => (await records()).some(r => r.event === "notification"))
    runtime.tmux("send-keys", "-t", "smoke", "C-p")
    await until(s => s.includes("Commands"))
    runtime.tmux("send-keys", "-t", "smoke", "-l", "Fixture: Check notification click")
    await until(s => (s.match(/Fixture: Check notification click/g) ?? []).length >= 2)
    runtime.tmux("send-keys", "-t", "smoke", "Enter")
    await until(async () => (await records()).some(r => r.event === "click-root-selected" || r.event === "click-failure"))
    assert.ok((await records()).some(r => r.event === "click-dialog-preserved"))
    assert.equal((await records()).filter(r => r.event === "click-failure").length, 0)
  } else await until(async () => (await records()).some(r => r.event === "sound" && r.kind === scenario))
  const observed = await records()
  const titles = observed.filter(r => r.event === "notification").map(r => r.title)
  assert.deepEqual(titles, scenario === "question" ? ["Session needs attention", "Session ended"]
    : scenario === "error" ? ["Session error"] : ["ended", "click"].includes(scenario) ? ["Session ended"] : [])
  assertNotificationAudio(assert, observed)
  if (scenario === "cancel") assert.equal(observed.filter(r => r.event === "sound").length, 0)
  assert.ok(principal >= 1)
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, `.runtime/notification-${scenario}.json`), JSON.stringify(observed, null, 2))
  console.log(`PASS notification ${scenario}: real host events, exact ${JSON.stringify(titles)}, ${scenario === "cancel" ? "silent interruption" : scenario === "click" ? "native dialog preserved and correct root selected" : "bundled normalized audio"}; ${temp}`)
} finally {
  await runtime.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
