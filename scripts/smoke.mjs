// Real, isolated OpenCode TUI + deterministic local HTTP fixtures. No paid model.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as sleep } from "node:timers/promises"

const root = path.resolve(import.meta.dirname, "..")
const scenario = process.argv[2] ?? "correction"
assert.ok(["correction", "cancel", "error", "external"].includes(scenario))
const temp = await mkdtemp(path.join(tmpdir(), "opencode-command-reviewer-"))
const project = path.join(temp, "project")
await mkdir(project)
execFileSync("git", ["init", "--quiet", project])
const commandDirectory = scenario === "external" ? path.join(temp, "outside") : project
if (commandDirectory !== project) await mkdir(commandDirectory)
await mkdir(path.join(temp, "config"))
const source = 'from pathlib import Path\nfruits = ["apple", "pear"]\nprint(len(fruits))\nPath("executed-marker").write_text(str(len(fruits)))\n'
await writeFile(path.join(commandDirectory, "fruits.py"), source)
const calls = []
let toolSent = false
let reviewerCalls = 0
let reviewerAborted = false
const delayed = new Set()
const server = createServer(async (req, res) => {
  try {
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    calls.push({ url: req.url, body })
    if (req.url === "/review/chat/completions") {
      reviewerCalls++
      if (scenario === "error") { res.writeHead(503); res.end("fixture outage"); return }
      const reply = () => {
        res.writeHead(200, { "Content-Type": "application/json" })
        const content = scenario === "correction" && reviewerCalls === 1
          ? '{"safe":"yes","desc":"Incorrect boolean type."}'
          : JSON.stringify({ safe: scenario !== "external", desc: "Counts two fruit names, prints the count, and writes it to executed-marker." })
        res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }
      if (scenario === "cancel") {
        res.on("close", () => { if (!res.writableEnded) reviewerAborted = true })
        const timer = setTimeout(() => { delayed.delete(timer); reply() }, 3000)
        delayed.add(timer)
      } else reply()
      return
    }
    const tools = body.tools ?? []
    const tool = tools.find((item) => item.function?.name === "bash")
    const doTool = !!tool && !toolSent
    if (doTool) toolSent = true
    const message = doTool
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_fruits", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "python3 fruits.py", description: "Count fruit names", ...(scenario === "external" ? { workdir: "../outside" } : {}) }) } }] }
      : { role: "assistant", content: "Fixture complete." }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      const chunk = (delta, finish_reason) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })
      const delta = doTool
        ? { role: "assistant", tool_calls: message.tool_calls.map((t, index) => ({ index, ...t })) }
        : message
      res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`)
      res.write(`data: ${JSON.stringify(chunk({}, doTool ? "tool_calls" : "stop"))}\n\n`)
      res.end("data: [DONE]\n\n")
    } else {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message, finish_reason: doTool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    }
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port
const config = {
  $schema: "https://opencode.ai/config.json",
  model: "fixture/fixture",
  small_model: "fixture/fixture",
  autoupdate: false,
  permission: { bash: "ask", external_directory: "ask" },
  provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: `http://127.0.0.1:${port}/main`, apiKey: "fixture-only" }, models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } },
}
const tuiFile = path.join(temp, "tui.json")
await writeFile(tuiFile, JSON.stringify({
  $schema: "https://opencode.ai/tui.json",
  plugin: [[path.join(root, "dist/tui.js"), { baseURL: `http://127.0.0.1:${port}/review`, model: "review-fixture" }]],
}))
const socket = `command-reviewer-${process.pid}`
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8" })
let screen = ""
try {
  const env = {
    HOME: temp,
    XDG_CONFIG_HOME: path.join(temp, "config"),
    XDG_DATA_HOME: path.join(temp, "data"),
    XDG_STATE_HOME: path.join(temp, "state"),
    XDG_CACHE_HOME: path.join(temp, "cache"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG: "",
    OPENCODE_CONFIG_DIR: path.join(temp, "config"),
    OPENCODE_TUI_CONFIG: tuiFile,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  }
  tmux("new-session", "-d", "-s", "smoke", "-x", scenario === "cancel" ? "80" : "120", "-y", scenario === "cancel" ? "24" : "40", "-c", project,
    "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    process.env.OPENCODE_BIN ?? "opencode", project,
    "--prompt", "Count the fruit names in fruits.py using python3 fruits.py.")
  const capture = () => tmux("capture-pane", "-p", "-t", "smoke")
  const until = async (condition, timeout = 90000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await sleep(100)
      screen = capture()
      if (condition(screen)) return
    }
    throw new Error("Timed out waiting for expected terminal state")
  }
  const expected = scenario === "cancel" ? "… Analyzing…" : scenario === "error" ? "! Analysis unavailable" : `${scenario === "external" ? "!" : "✓"} Counts two fruit names`
  await until((screen) => screen.includes("Permission required") && screen.includes(expected) && reviewerCalls > 0)
  assert.match(screen, /Permission required/, "real native approval should be visible")
  assert.match(screen, /python3 fruits\.py/)
  assert.ok(screen.includes(expected), "compact icon and description should render alongside approval")
  assert.ok(!screen.includes("opencode-command-reviewer:"), "the plugin should not display a title header")
  const firstReview = calls.find((call) => call.url === "/review/chat/completions")
  assert.ok(firstReview)
  const sent = JSON.parse(firstReview.body.messages[1].content)
  assert.equal(sent.command, "python3 fruits.py")
  assert.equal(sent.cwd, commandDirectory)
  assert.equal(sent.userPrompt, "Count the fruit names in fruits.py using python3 fruits.py.")
  assert.equal(sent.files[0].contents, source)
  assert.equal(sent.session.root.directory, project)
  assert.equal(sent.session.root.projectID, sent.session.rootProject.id)
  assert.equal(sent.session.rootProject.worktree, project)
  assert.equal(sent.session.rootProject.vcs, "git")
  assert.equal(sent.execution.instanceDirectory, project)
  assert.equal(sent.execution.instanceWorktree, project)
  assert.equal(sent.execution.canonicalCwd, commandDirectory)
  assert.equal(sent.execution.requestedWorkdir, scenario === "external" ? "../outside" : null)
  assert.equal(sent.permission.type, scenario === "external" ? "external_directory" : "bash")
  await assert.rejects(access(path.join(commandDirectory, "executed-marker")), "plugin must not execute/approve the command")
  if (scenario === "correction") {
    assert.equal(reviewerCalls, 2)
    assert.match(calls.filter((call) => call.url === "/review/chat/completions")[1].body.messages[3].content, /Format validation failed/)
    assert.match(screen, /Counts two fruit names/)
    await sleep(400)
    assert.match(capture(), /Permission required/, "SAFE must remain advisory")
  } else assert.equal(reviewerCalls, 1)
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, `.runtime/${scenario}-pending.txt`), screen)
  if (scenario === "external") {
    assert.match(screen, /! Counts two fruit names/)
    assert.deepEqual(sent.permission.metadata.directories, [commandDirectory])
    assert.deepEqual(sent.permission.patterns, [`${commandDirectory}/*`])
    assert.deepEqual(sent.permission.always, [`${commandDirectory}/*`])
    // Authorize only the directory boundary. OpenCode must still ask for bash.
    tmux("send-keys", "-t", "smoke", "Enter")
    await until((s) => s.includes("Permission required") && s.includes("Shell command") && s.includes("! Counts two fruit names") && reviewerCalls === 2, 10000)
    const next = JSON.parse(calls.filter((call) => call.url === "/review/chat/completions")[1].body.messages[1].content)
    assert.equal(next.permission.type, "bash")
    assert.notEqual(next.permission.id, sent.permission.id)
    assert.equal(next.permission.tool.callID, sent.permission.tool.callID)
    assert.deepEqual(next.permission.patterns, ["python3 fruits.py"])
    assert.equal(next.cwd, commandDirectory)
    assert.equal(next.session.root.directory, project)
    assert.equal(next.files[0].contents, source)
    await assert.rejects(access(path.join(commandDirectory, "executed-marker")))
    await writeFile(path.join(root, ".runtime/external-bash-pending.txt"), screen)
  }
  // A real human-style keystroke, not a plugin/API permission write.
  tmux("send-keys", "-t", "smoke", scenario === "correction" ? "Enter" : "Escape")
  const hasPanel = (s) => /Counts two fruit names|Analyzing…|Analysis unavailable/.test(s)
  await until((s) => !s.includes("Permission required") && !hasPanel(s), 10000)
  if (scenario === "correction") {
    await until((s) => s.includes("Fixture complete."), 10000)
    await access(path.join(commandDirectory, "executed-marker"))
  } else {
    await sleep(scenario === "cancel" ? 3300 : 300)
    if (scenario === "cancel") assert.ok(reviewerAborted, "pending HTTP review should be aborted on user rejection")
    await assert.rejects(access(path.join(commandDirectory, "executed-marker")))
    assert.ok(!hasPanel(capture()), "late response must not resurrect panel")
  }
  await writeFile(path.join(root, `.runtime/${scenario}-resolved.txt`), capture())
  await writeFile(path.join(root, `.runtime/${scenario}-requests.json`), JSON.stringify(calls, null, 2))
  console.log(`PASS ${scenario}: native approval, exact evidence, advisory behavior, panel cleanup${scenario === "cancel" ? ", HTTP cancellation and late-result suppression at 80x24" : ""}. Isolated files: ${temp}`)
} catch (error) {
  console.error(screen)
  console.error(`Isolated diagnostic files: ${temp}`)
  console.error(`Requests received: ${calls.length}`)
  throw error
} finally {
  try { tmux("kill-server") } catch {}
  for (const timer of delayed) clearTimeout(timer)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
