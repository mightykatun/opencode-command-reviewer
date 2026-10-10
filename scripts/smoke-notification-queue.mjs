// Real native parallel tool calls, final reviews and queued automatic approvals.
// Desktop effects are isolated process I/O; no live model or desktop delivery.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeRuntime } from "./smoke-runtime.mjs"
import { notificationRecorder } from "./smoke-notification-recorder.mjs"
import { runtimeArguments } from "./runtime-inventory.mjs"

const { scenario } = runtimeArguments("smoke-notification-queue.mjs")
const streaming = process.argv.includes("--stream")
const label = `${scenario}${streaming ? "-stream" : ""}`
// Exceed the bounded two-second cold audio preparation so a reminder cannot
// replace the initial banner before this fixture observes its exact event text.
const reminderSeconds = 3
const root = path.resolve(import.meta.dirname, "..")
const host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8", timeout: 10000 }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-notification-queue-"))
const project = path.join(temp, "project"), plugin = path.join(temp, "reviewer.mjs")
await mkdir(project); await mkdir(path.join(temp, "config"))
execFileSync("git", ["init", "--quiet", project])
await copyFile(path.join(root, "dist/tui.js"), plugin)
const records = await notificationRecorder(plugin, temp)
const count = ["children", "advisory", "disabled"].includes(scenario) ? 2 : 3
const sent = new Set(), reviews = [], errors = [], captures = []
let screen = ""
const server = createServer(async (req, res) => {
  try {
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    if (req.url === "/review/chat/completions") {
      assert.notEqual(scenario, "disabled")
      assert.equal(body.stream, streaming)
      const evidence = JSON.parse(body.messages[1].content)
      const entry = { id: evidence.permission.id, at: Date.now(), start: () => {
        if (scenario === "mixed" && entry.ordinal === 2) {
          entry.completedAt = Date.now()
          res.writeHead(401, { "Content-Type": "application/json" }); res.end("{}")
        } else if (streaming) {
          res.writeHead(200, { "Content-Type": "text/event-stream" })
          entry.content(`{"safe":${entry.safe},`)
        }
      }, content: content => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`),
      release: () => {
        if (entry.completedAt) return
        entry.completedAt = Date.now()
        if (streaming) {
          entry.content('"desc":"Harmless notification queue fixture output."}')
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
          res.end("data: [DONE]\n\n")
        } else {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({
            safe: entry.safe, desc: "Harmless notification queue fixture output.",
          }) }, finish_reason: "stop" }] }))
        }
      } }
      reviews.push(entry)
      // Both/all reports complete while native requests still overlap. The
      // queue, not a slow model, keeps later Safe requests from starting auto.
      if (reviews.length === count) {
        const ordered = reviews.toSorted((a, b) => a.id < b.id ? -1 : 1)
        for (const [ordinal, review] of ordered.entries()) {
          review.ordinal = ordinal; review.safe = !(scenario === "mixed" && ordinal === 1); review.start()
          if (!streaming) review.release()
        }
      }
      return
    }
    assert.equal(req.url, "/main/chat/completions")
    const main = body.tools?.some(tool => tool.function?.name === "bash")
    const user = JSON.stringify(body.messages?.findLast(message => message.role === "user")?.content)
    const child = /NOTIFICATION_CHILD_([12])/.exec(user)?.[1]
    const actor = child ? `child-${child}` : "root"
    const call = main && !sent.has(actor)
    let delta
    if (call) {
      sent.add(actor)
      const tasks = scenario === "children" && !child
      const tools = Array.from({ length: tasks ? 2 : child ? 1 : count }, (_, index) => ({
        index, id: `fixture_${actor}_${index}`, type: "function", function: tasks ? {
          name: "task", arguments: JSON.stringify({ subagent_type: "general", description: `Notification child ${index + 1}`,
            prompt: `NOTIFICATION_CHILD_${index + 1}: perform the isolated notification fixture.` }),
        } : { name: "bash", arguments: JSON.stringify({ command: `printf 'notification-queue-${child ?? index + 1}\\n'`,
          description: `Notification queue command ${child ?? index + 1}` }) },
      }))
      delta = { role: "assistant", tool_calls: tools }
    } else delta = { role: "assistant", content: main ? "Notification queue fixture complete." : "Notification queue fixture" }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      for (const [value, finish_reason] of [[delta, null], [{}, call ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: `fixture-${actor}`, object: "chat.completion.chunk", model: "fixture",
          choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`)
      }
      res.end("data: [DONE]\n\n")
    } else {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: delta, finish_reason: call ? "tool_calls" : "stop" }] }))
    }
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.writeHead(500); res.end() }
})
const runtime = await smokeRuntime(temp)
const until = async (check, timeout = 90000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    assert.deepEqual(errors, [])
    screen = runtime.tmux("capture-pane", "-p", "-t", "smoke")
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`Timed out: ${screen}`)
}
const save = async outcome => {
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, `.runtime/notification-queue-${label}.json`), JSON.stringify({
    outcome, temp, reviews, records: await records(), captures, screen, errors,
  }, null, 2))
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false,
    permission: { "*": "allow", bash: "ask", task: "allow" },
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${port}/main`, apiKey: "fixture" },
      models: { fixture: { name: "Fixture", limit: { context: 32000, output: 2000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[plugin, { baseURL: `http://127.0.0.1:${port}/review`, model: "fixture",
    notify: true, staleReminderSeconds: reminderSeconds, autoApprove: scenario !== "advisory", reviewBash: scenario !== "disabled",
    stream: streaming, autoApproveDelaySeconds: 3, timeoutMs: 60000 }]] }))
  const env = { HOME: temp, XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"),
    XDG_STATE_HOME: path.join(temp, "state"), XDG_CACHE_HOME: path.join(temp, "cache"), OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG: "", OPENCODE_TUI_CONFIG: tui, OPENCODE_CONFIG_DIR: path.join(temp, "config"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "smoke", "-x", "160", "-y", "40", "-c", project,
    "env", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), host, project, "--prompt", "Perform the notification queue fixture.")
  if (streaming && scenario !== "disabled") {
    await until(() => reviews.length === count && reviews.every(review => typeof review.safe === "boolean"))
    await until(() => screen.includes("✓ Safe") && !screen.includes("Allowed in"))
    captures.push({ at: Date.now(), phase: "provisional", screen })
    await sleep(2000)
    assert.equal((await records()).filter(r => r.event === "notification").length, 0, "provisional reports and queued failures cannot notify")
    for (const review of reviews) review.release()
  }
  const automatic = ["main", "children"].includes(scenario) ? count : scenario === "mixed" ? 1 : 0
  const expectedReviews = scenario === "disabled" ? 0 : count
  await until(() => reviews.length === expectedReviews && screen.includes(automatic ? "Allowed in" : "Permission required"))
  captures.push({ at: Date.now(), phase: "overlap", screen })
  if (automatic < count) {
    if (automatic) await until(async () => (await records()).some(r => r.event === "permission.replied"))
    for (let index = automatic; index < count; index++) {
      const title = scenario === "mixed" && index === 1 ? "Unsafe permission needs human approval" : "Session needs attention"
      const rating = scenario === "disabled" ? "Permission required" : scenario === "mixed" ? index === 1 ? "✗ Unsafe" : "Analysis unavailable" : "✓ Safe"
      await until(async () => screen.includes(rating) && (await records()).filter(r => r.event === "notification"
        && /^(Session needs attention|Unsafe permission needs human approval)$/.test(r.title)).length >= index - automatic + 1)
      const before = (await records()).filter(r => r.event === "notification" && /Session needs attention|Unsafe permission/.test(r.title))
      const initials = before.filter(r => !r.title.endsWith(" (Reminder)"))
      assert.equal(initials.length, index - automatic + 1, "later manual permissions must not notify ahead of their native queue position")
      const current = initials.at(-1)
      await until(async () => (await records()).some(r => r.event === "notification" && r.title === `${title} (Reminder)` && r.at > current.at))
      captures.push({ at: Date.now(), phase: `manual-${index}`, screen })
      // Only harmless isolated printf commands are allowed by the native UI.
      runtime.tmux("send-keys", "-t", "smoke", "Enter")
      await until(async () => (await records()).filter(r => r.event === "permission.replied").length === index + 1)
    }
  }
  await until(async () => (await records()).filter(r => r.event === "permission.replied").length === count)
  await until(async () => (await records()).filter(r => r.event === "notification" && r.title === "Reviewer approved a permission").length === automatic)
  const attentionCount = (await records()).filter(r => r.event === "notification" && /Session needs attention|Unsafe permission/.test(r.title)).length
  await sleep((reminderSeconds + 0.5) * 1000)
  const observed = await records()
  const asked = observed.filter(r => r.event === "permission.asked"), replied = observed.filter(r => r.event === "permission.replied")
  assert.equal(asked.length, count); assert.equal(reviews.length, expectedReviews)
  assert.ok(replied.every(r => r.reply === "once"))
  assert.equal(new Set(asked.map(r => r.session)).size, scenario === "children" ? 2 : 1)
  assert.ok(Math.max(...asked.map(r => r.at)) < replied[0].at, "all native permissions must overlap")
  if (expectedReviews) assert.ok(Math.max(...reviews.map(r => r.completedAt)) < replied[0].at, "later reports finish before the first permission reply")
  const unwanted = observed.filter(r => r.event === "notification" && /Session needs attention|Unsafe permission/.test(r.title))
  assert.equal(unwanted.length, attentionCount, "resolution must stop reminders")
  if (automatic === count) {
    assert.deepEqual(unwanted, [], `all ${count} permissions auto-approved but attention was emitted; see .runtime/notification-queue-${label}.json`)
    assert.ok(!observed.some(r => r.event === "sound" && ["attention", "unsafe"].includes(r.kind)))
  } else {
    assert.equal(unwanted.filter(r => !r.title.endsWith(" (Reminder)")).length, count - automatic)
    if (automatic) assert.ok(unwanted.every(r => r.at >= replied[0].at), "queued manual outcomes wait until the preceding automatic permission resolves")
  }
  await save("passed")
  console.log(`PASS notification queue ${label}: ${count} overlapping permissions, ${automatic} auto-approved, ${count - automatic} manual, current-outcome notifications and resolution cleanup; ${temp}`)
} catch (error) { await save(String(error)); throw error }
finally {
  await runtime.dispose(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
