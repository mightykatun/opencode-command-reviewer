// Real OpenCode TUI, native MCP/custom tools and deterministic local model responses.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeRuntime } from "./smoke-runtime.mjs"

const root = path.resolve(import.meta.dirname, "..")
const scenario = process.argv[2] ?? "mcp"
assert.ok(["mcp", "mcp-resource", "custom", "custom-bash", "external-read", "external-search", "external-edit", "external-patch"].includes(scenario))
const flag = (name) => process.argv.includes(`--${name}`)
const auto = flag("auto"), disabled = flag("disabled"), correction = flag("correction")
const mcp = scenario.startsWith("mcp"), custom = scenario.startsWith("custom"), directory = scenario.startsWith("external-")
const patch = scenario === "external-patch"
const fixtureModel = patch ? "gpt-fixture" : "fixture"
const mcpName = flag("resource-whitespace") ? " fixture " : "fixture"
const resourceURI = flag("resource-whitespace") ? " fixture://remote/item " : "fixture://remote/item"
const tag = [scenario, ...process.argv.slice(3).map((arg) => arg.replace(/^--/, ""))].join("-")
const temp = await mkdtemp(path.join(tmpdir(), "review-permissions-"))
const project = path.join(temp, "project"), outside = path.join(temp, "outside")
await mkdir(project); await mkdir(outside); await mkdir(path.join(temp, "config/tools"), { recursive: true })
execFileSync("git", ["init", "--quiet", project])
const target = path.join(outside, "note.txt")
await writeFile(target, "before fixture\n")
const plugin = path.join(temp, "reviewer.mjs")
await copyFile(path.join(root, "dist/tui.js"), plugin)
const tool = scenario === "mcp" ? "fixture_inspect" : scenario === "mcp-resource" ? "read_mcp_resource"
  : custom ? "local_demo" : patch ? "apply_patch" : scenario === "external-search" ? "grep" : scenario === "external-edit" ? "edit" : "read"
const input = scenario === "mcp" ? { target: "fixture://remote/item" } : scenario === "mcp-resource" ? { server: mcpName, uri: resourceURI }
  : custom ? { target: "isolated fixture" } : patch ? { patchText: `*** Begin Patch\n*** Delete File: ${target}\n*** End Patch` }
  : scenario === "external-search" ? { path: outside, pattern: "fixture" }
  : scenario === "external-edit" ? { filePath: target, oldString: "before fixture", newString: "after fixture" } : { filePath: target }
const customPermission = scenario === "custom-bash" ? "bash" : "fixture_allowance"
if (custom) await writeFile(path.join(temp, "config/tools/local_demo.ts"), `
import { appendFile } from "node:fs/promises"
export default {
  description: "Append one line to the isolated fixture log after requesting permission.",
  args: { target: { type: "string", description: "Fixture target" } },
  async execute(args, context) {
    await appendFile(${JSON.stringify(path.join(project, "before-permission"))}, "entered\\n")
    await context.ask({ permission: ${JSON.stringify(customPermission)}, patterns: ["fixture-target"], always: ["*"], metadata: { operation: "append fixture log", target: args.target } })
    await appendFile(${JSON.stringify(path.join(project, "executions"))}, "executed\\n")
    return "Fixture custom operation completed."
  }
}
`)

const ledger = path.join(temp, "state/opencode/opencode-reviewer/usage-v1")
await mkdir(ledger, { recursive: true })
await writeFile(path.join(ledger, "00000000-0000-0000-0000-000000000001.json"), flag("storage-error") ? "{" : JSON.stringify({ version: 1,
  requests: 1, input: 100, output: 20, priced: 1, cost: 0.01, since: 1 }))

const requests = [], rpc = [], perRequest = new Map()
let sent = false, completed = false, executions = 0, release
const prompt = `Perform the isolated ${scenario} fixture operation once.`
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/mcp" && req.method !== "POST") { res.writeHead(405); res.end(); return }
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    if (req.url === "/mcp") {
      rpc.push(body)
      if (body.id === undefined) { res.writeHead(202); res.end(); return }
      let result
      if (body.method === "initialize") result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "1" } }
      else if (body.method === "tools/list") result = { tools: [{ name: "inspect", description: "Read an isolated fixture item", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } }] }
      else if (body.method === "resources/list") result = { resources: [{ name: "Fixture item", uri: resourceURI, mimeType: "text/plain" }] }
      else if (body.method === "resources/templates/list") result = { resourceTemplates: [] }
      else if (body.method === "tools/call" || body.method === "resources/read") {
        executions++
        result = body.method === "tools/call" ? { content: [{ type: "text", text: "Remote fixture result" }] }
          : { contents: [{ uri: body.params.uri, text: "Remote fixture result", mimeType: "text/plain" }] }
      } else throw new Error(`Unexpected MCP method ${body.method}`)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result })); return
    }
    requests.push({ url: req.url, body })
    if (req.url === "/review/chat/completions") {
      const evidence = JSON.parse(body.messages[1].content)
      const attempt = (perRequest.get(evidence.permission.id) ?? 0) + 1
      perRequest.set(evidence.permission.id, attempt)
      if (flag("held") && requests.filter((entry) => entry.url.startsWith("/review")).length === 1) await new Promise((resolve) => { release = resolve })
      if (flag("error")) { res.writeHead(503); res.end("PRIVATE fixture error"); return }
      const content = correction && attempt === 1 ? "bad JSON" : JSON.stringify({ safe: !flag("unsafe"), desc: "Bounded isolated fixture operation. Only the current allowance is assessed." })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ model: "review", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        ...(!flag("no-usage") && !(flag("missing-usage") && attempt === 1) ? { usage: { prompt_tokens: 100, completion_tokens: 20 } } : {}),
      })); return
    }
    if (body.messages.some((message) => message.role === "tool" && message.tool_call_id === "call_fixture")) completed = true
    const use = !sent && body.tools?.some((entry) => entry.function?.name === tool)
    if (use) sent = true
    const delta = use ? { role: "assistant", tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: tool, arguments: JSON.stringify(input) } }] }
      : { role: "assistant", content: "Fixture complete." }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      for (const [chunk, finish_reason] of [[delta, null], [{}, use ? "tool_calls" : "stop"]]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: chunk, finish_reason }] })}\n\n`)
      res.end("data: [DONE]\n\n")
    } else {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message: delta, finish_reason: use ? "tool_calls" : "stop" }] }))
    }
  } catch (error) { res.writeHead(500); res.end(String(error)) }
})
const runtime = await smokeRuntime(temp)
const tmux = runtime.tmux
let screen = "", started = false
let lastCountdown
const capture = () => tmux("capture-pane", "-p", "-t", "smoke")
const until = async (check, ms = 90000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { await sleep(80); screen = capture(); if (await check(screen)) return }
  throw new Error(`Timed out waiting for ${tag}`)
}
const reviews = () => requests.filter((entry) => entry.url === "/review/chat/completions")
const save = async (name) => {
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, `.runtime/permission-${tag}-${name}.txt`), capture())
  await writeFile(path.join(root, `.runtime/permission-${tag}-${name}.ansi`), tmux("capture-pane", "-p", "-e", "-t", "smoke"))
}
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const config = { model: `fixture/${fixtureModel}`, small_model: `fixture/${fixtureModel}`, autoupdate: false,
    permission: { bash: "ask", edit: patch ? "allow" : "ask", read: "allow", grep: "allow", external_directory: "ask", fixture_inspect: "ask", fixture_allowance: "ask" },
    ...(mcp ? { mcp: { [mcpName]: { type: "remote", url: `http://127.0.0.1:${port}/mcp`, oauth: false } } } : {}),
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${port}/main`, apiKey: "fixture" }, models: { [fixtureModel]: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } },
  }
  if (scenario === "mcp-resource") config.permission.read = "ask"
  if (!flag("unpriced")) config.provider.review = { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${port}/review` },
    models: { review: { name: "Review", limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2, cache_read: 0, cache_write: 0 } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ theme: "opencode", plugin: [[plugin, { baseURL: `http://127.0.0.1:${port}/review`, model: "review",
    reviewBash: flag("native-bash-enabled"), reviewEdits: true, reviewMcp: mcp && !disabled, reviewCustomTools: custom && !disabled,
    reviewExternalDirectories: directory && !disabled, autoApprove: auto, autoApproveDelaySeconds: 2 }]] }))
  const env = { HOME: temp, XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"), XDG_STATE_HOME: path.join(temp, "state"), XDG_CACHE_HOME: path.join(temp, "cache"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "smoke", "-x", "160", "-y", "40", "-c", project, "env", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), process.env.OPENCODE_BIN ?? "opencode", project, "--prompt", prompt)
  started = true
  await until((s) => s.includes("Permission required") && (disabled || reviews().length > 0))
  assert.equal(executions, 0)
  if (custom) {
    assert.match(await readFile(path.join(project, "before-permission"), "utf8"), /entered/)
    await assert.rejects(readFile(path.join(project, "executions")))
  }
  if (directory) assert.equal(await readFile(target, "utf8"), "before fixture\n")
  if (flag("held")) {
    await until((s) => !!release && s.includes("Permission analysis") && /[■⬝]{8}|\[⋯\]/.test(s))
    if (flag("stats")) assert.doesNotMatch(screen, /tokens in\/out:|lifetime:/, "loading must not show historical lifetime by itself")
    await save("loading")
    release()
  }
  const expected = flag("error") ? "Analysis unavailable" : flag("unsafe") ? "✗ Unsafe" : "✓ Safe"
  if (disabled) {
    await sleep(2500)
    assert.equal(reviews().length, 0)
    assert.doesNotMatch(capture(), /Permission analysis/)
  } else {
    await until((s) => s.includes(expected))
    const evidence = JSON.parse(reviews()[0].body.messages[1].content)
    assert.equal(evidence.kind, mcp ? "mcp" : custom ? "custom" : "external-directory")
    assert.equal(evidence.tool, tool)
    assert.equal(evidence.userPrompt, prompt)
    assert.equal(evidence.location.instanceDirectory, project)
    assert.equal(evidence.permission.tool.callID, "call_fixture")
    if (!directory) assert.deepEqual(evidence.input, input)
    else assert.deepEqual(evidence.permission.patterns, [`${outside}/*`])
    if (patch) {
      assert.deepEqual(evidence.operation.patchOperations, [{ operation: "delete", path: target }])
      assert.deepEqual(evidence.operation.input, {})
      assert.equal(evidence.partial, true)
      assert.doesNotMatch(JSON.stringify(evidence), /before fixture|patchText/)
    }
    if (mcp) {
      assert.equal(evidence.origin.server, mcpName)
      assert.equal(evidence.definition.status, "unavailable")
      assert.equal(rpc.filter((entry) => ["tools/call", "resources/read"].includes(entry.method)).length, 0)
      if (scenario === "mcp-resource") {
        assert.deepEqual(evidence.permission.metadata, { server: mcpName, uri: resourceURI })
        assert.deepEqual(evidence.permission.patterns, [`mcp:${mcpName}:${resourceURI}`])
        assert.deepEqual(evidence.permission.always, [`mcp:${mcpName}:*`])
      }
    }
    if (custom) assert.equal(evidence.definition.status, "included")
    assert.doesNotMatch(JSON.stringify(evidence), /autoApprove|countdown/)
    if (correction && !flag("error")) {
      assert.equal(reviews().length, 2)
      assert.match(reviews()[1].body.messages[3].content, /Format validation failed/)
    }
  }
  if (flag("stats") && !disabled) {
    const missing = flag("no-usage") || flag("error") || flag("missing-usage")
    if (missing) {
      assert.doesNotMatch(capture(), /tokens in\/out:|lifetime:/, "invalid/missing request usage must hide the entire stats block")
    } else {
      const attempts = correction ? 2 : 1
      await until((s) => s.includes(`tokens in/out: ${100 * attempts}/${20 * attempts}`) && s.includes("lifetime:"), 5000)
      const rows = screen.split("\n").map((line) => line.slice(118).trim())
      const first = rows.findIndex((line) => line.startsWith("tokens in/out:"))
      assert.ok(first >= 0)
      if (flag("unpriced")) {
        assert.match(rows[first + 1], /^lifetime:/)
        assert.doesNotMatch(rows.join("\n"), /^cost:/m)
        assert.match(rows.join("\n"), /partial pricing/)
      } else {
        assert.match(rows[first + 1], /^cost: \$/)
        assert.match(rows[first + 2], flag("storage-error") ? /^lifetime: usage unavailable$/ : /^lifetime: \$/)
      }
    }
  }
  await save("pending")
  if (auto && !disabled && !flag("unsafe") && !flag("error")) {
    await until((s) => s.includes("Allowed in 2s"))
    lastCountdown = Date.now()
    if (flag("cancel")) {
      const lines = screen.split("\n"), row = lines.findIndex((line) => line.includes("Allowed in")), x = lines[row].indexOf("Cancel") + 2
      for (const suffix of ["M", "m"]) tmux("send-keys", "-t", "smoke", "-l", `\x1b[<0;${x};${row + 1}${suffix}`)
      await until((s) => s.includes("Auto-approval canceled"), 3000)
      await sleep(2500)
      assert.match(capture(), /Permission required/)
      assert.equal(executions, 0)
      tmux("send-keys", "-t", "smoke", "Enter")
    } else if (scenario === "external-edit") {
      await until((s) => reviews().some((entry) => JSON.parse(entry.body.messages[1].content).kind === "edit") && s.includes("Allowed in 2s") && s.includes("✓ Safe"), 10000)
      assert.ok(Date.now() - lastCountdown >= 1750, "directory stage needs its own visible countdown")
      assert.equal(await readFile(target, "utf8"), "before fixture\n")
      lastCountdown = Date.now()
    }
  } else {
    await sleep(2500)
    assert.match(capture(), /Permission required/)
    assert.doesNotMatch(capture(), /Allowed in/)
    tmux("send-keys", "-t", "smoke", "Enter")
  }
  if (scenario === "external-edit") {
    if (!auto || flag("cancel") || flag("unsafe") || flag("error")) {
      await until((s) => s.includes("Permission required") && reviews().some((entry) => JSON.parse(entry.body.messages[1].content).kind === "edit"))
      await until((s) => s.includes(expected))
      tmux("send-keys", "-t", "smoke", "Enter")
    }
  }
  await until(() => completed, 15000)
  if (lastCountdown && !flag("cancel")) assert.ok(Date.now() - lastCountdown >= 1750, "each request needs a full visible countdown")
  await until((s) => !s.includes("Permission required") && !s.includes("Permission analysis"), 5000)
  if (mcp) assert.equal(executions, 1)
  if (scenario === "mcp-resource") assert.equal(rpc.find(entry => entry.method === "resources/read").params.uri, resourceURI)
  if (custom) assert.equal(await readFile(path.join(project, "executions"), "utf8"), "executed\n")
  if (patch) {
    await assert.rejects(readFile(target), { code: "ENOENT" })
    if (!disabled) {
      assert.equal(perRequest.size, 1, "directory approval alone resumes the already-allowed patch")
      assert.ok(reviews().every(entry => JSON.parse(entry.body.messages[1].content).kind === "external-directory"))
    }
  }
  if (scenario === "external-edit") {
    assert.equal(await readFile(target, "utf8"), "after fixture\n")
    const stages = new Map(reviews().map((entry) => { const e = JSON.parse(entry.body.messages[1].content); return [e.permission.id, e.kind] }))
    assert.deepEqual([...stages.values()], ["external-directory", "edit"])
  }
  if (scenario === "external-read" || scenario === "external-search") {
    const outputs = requests.filter((entry) => entry.url.startsWith("/main")).flatMap((entry) => entry.body.messages)
      .filter((message) => message.role === "tool" && message.tool_call_id === "call_fixture")
    assert.match(JSON.stringify(outputs), /before fixture/, "native access actually returned the fixture contents")
  }
  for (const entry of requests.filter((entry) => entry.url.startsWith("/main"))) assert.doesNotMatch(JSON.stringify(entry.body.messages), /Take extra care|Permission analysis|Allowed in|countdown/)
  if (flag("stats")) {
    const recorded = flag("no-usage") || flag("error") ? 0 : [...perRequest.values()].reduce((sum, attempts) => sum + attempts - (flag("missing-usage") ? 1 : 0), 0)
    tmux("send-keys", "-t", "smoke", "C-p")
    await until((s) => s.includes("Commands"), 5000)
    tmux("send-keys", "-t", "smoke", "-l", "Reviewer: Lifetime usage")
    await until((s) => (s.match(/Reviewer: Lifetime usage/g) ?? []).length >= 2, 5000)
    tmux("send-keys", "-t", "smoke", "Enter")
    await until((s) => s.includes("Reviewer lifetime usage") && s.includes(flag("storage-error") ? "Lifetime usage unavailable" : `${1 + recorded} completed requests with usage`), 5000)
    assert.doesNotMatch(screen, /Permission analysis/)
    await save("lifetime-dialog")
    tmux("send-keys", "-t", "smoke", "Escape")
  }
  await save("resolved")
  await writeFile(path.join(root, `.runtime/permission-${tag}-requests.json`), JSON.stringify({ requests, rpc }, null, 2))
  console.log(`PASS ${tag}: real native ${tool}, correct evidence/prompt routing, ${reviews().length} reviewer attempts, once-only fixture completion and panel cleanup. ${temp}`)
} catch (error) {
  if (started) { try { await save("failed") } catch {} }
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  await writeFile(path.join(root, `.runtime/permission-${tag}-failed.json`), JSON.stringify({ requests, rpc, temp, error: String(error) }, null, 2))
  console.error(screen, temp)
  throw error
} finally {
  release?.()
  await runtime.dispose()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
