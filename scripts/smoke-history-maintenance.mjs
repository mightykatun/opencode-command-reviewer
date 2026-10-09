// Packed production plugin, real public sessions, and offline deletion. No host
// database edits. Fault injection is confined to this fixture's public get adapter.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "node:http"
import { setTimeout as sleep } from "node:timers/promises"
import { DatabaseSync } from "node:sqlite"
import { tsImport } from "tsx/esm/api"
import { smokeRuntime } from "./smoke-runtime.mjs"

const root = path.resolve(import.meta.dirname, ".."), host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8" }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "history-maintenance-")), project = path.join(temp, "project")
const artifacts = path.join(root, ".runtime/history-maintenance")
await mkdir(project); await mkdir(path.join(temp, "config")); await mkdir(artifacts, { recursive: true })
execFileSync("git", ["init", "--quiet", project])
const packResult = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], { cwd: root, encoding: "utf8" }))
const packed = Array.isArray(packResult) ? packResult[0] : packResult["opencode-reviewer"]
const bundle = path.join(temp, "bundle.mjs"), wrapper = path.join(temp, "wrapper.mjs"), fault = path.join(temp, "fault.json"), observed = path.join(temp, "observed.json")
await writeFile(bundle, execFileSync("tar", ["-xOf", path.join(temp, packed.filename), "package/dist/tui.js"]))
await writeFile(fault, "{}")
await writeFile(wrapper, `import plugin from ${JSON.stringify(pathToFileURL(bundle).href)};
import { readFile, writeFile } from 'node:fs/promises';
export default { id: 'maintenance-fixture', tui: async (api, options) => {
  const original = api.client.session.get.bind(api.client.session);
  let blocked = 0, replies = 0, missing;
  const session = new Proxy(api.client.session, { get(target, key) {
    if (key !== 'get') return Reflect.get(target, key);
    return async (params, opts) => {
      const control = JSON.parse(await readFile(${JSON.stringify(fault)}, 'utf8'));
      if (control.id === params.sessionID) {
        blocked++;
        return { response: new Response('', { status: 403 }), error: { name: 'Forbidden', data: { message: 'fixture transient' } } };
      }
      const result = await original(params, opts);
      if (result.response?.status === 404) missing = { status: result.response.status, error: result.error };
      return result;
    };
  } });
  const client = new Proxy(api.client, { get(target, key) { return key === 'session' ? session : Reflect.get(target, key); } });
  const adapted = new Proxy(api, { get(target, key) { return key === 'client' ? client : Reflect.get(target, key); } });
  api.event.on('permission.replied', () => replies++);
  await plugin.tui(adapted, options);
  const timer = setInterval(() => { void writeFile(${JSON.stringify(observed)}, JSON.stringify({ blocked, replies, missing })); }, 100);
  api.lifecycle.onDispose(() => clearInterval(timer));
} };
`)
const { HistorySQL } = await tsImport("../src/history-schema.ts", import.meta.url)
const { encodeEvent } = await tsImport("../src/history-records.ts", import.meta.url)
const { privateDatabase } = await tsImport("../src/history-storage-worker.ts", import.meta.url)
const runtime = await smokeRuntime(temp)
let calls = 0, sql, sequence = 0
const model = createServer(async (req, res) => {
  for await (const chunk of req) void chunk
  calls++; res.writeHead(200, { "Content-Type": "text/event-stream" })
  const chunk = (delta, finish_reason) => ({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })
  res.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: "Maintenance fixture ready." }, null))}\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`)
})
const capture = () => runtime.tmux("capture-pane", "-p", "-t", "history")
const send = (...keys) => runtime.tmux("send-keys", "-t", "history", ...keys)
const until = async (check, timeout = 60000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { try { if (await check()) return } catch {} await sleep(100) }
  throw Error("Maintenance fixture wait timed out")
}
const open = async () => {
  send("C-p"); await until(() => capture().includes("Commands")); send("C-u"); send("-l", "Reviewer: Report history")
  await sleep(300); send("Enter"); await until(() => capture().includes("Analysis history"))
}
const apply = event => sql.apply("maintenance-fixture", ++sequence, encodeEvent(event))
const seed = (rootID, session, n, scope = project) => {
  const context = { scope, root: rootID, session, permission: "p" + n, review: "r" + n,
    category: "bash", configuredModel: "historical-model", provider: "https://history.invalid/v1" }
  apply({ type: "reviewAccepted", context, at: n, accepted: { safe: true, completedAt: n } })
  apply({ type: "attemptFinalized", context, at: n, attempt: "a", usage: { input: 10, output: 2, cost: 0.01 } })
  apply({ type: "permissionResolved", context, at: n, outcome: "manual", payload: { safe: true, completedAt: n, desc: "Stored maintenance report " + n } })
}
try {
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve))
  const baseURL = `http://127.0.0.1:${model.address().port}`
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false, provider: { fixture: {
    npm: "@ai-sdk/openai-compatible", options: { baseURL, apiKey: "synthetic" }, models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[wrapper, { notify: false, baseURL, model: "fixture" }]] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  const start = (target, ...args) => runtime.start("-d", "-s", target, "-x", "160", "-y", "40", "-c", project, "env",
    ...Object.entries(env).map(([k, v]) => k + "=" + v), host, ...args)
  // Reserve an ephemeral loopback port, then give it to the isolated public host.
  const portServer = createServer(); await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve))
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve))
  await start("api", "serve", "--hostname", "127.0.0.1", "--port", String(port))
  const endpoint = `http://127.0.0.1:${port}`
  const request = async (method, route, body) => {
    const response = await fetch(endpoint + route + "?directory=" + encodeURIComponent(project), { method, signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await response.json(); return { status: response.status, data }
  }
  await until(async () => (await request("GET", "/session")).status === 200)
  console.log("maintenance: public API ready")
  const create = async parentID => {
    const r = await request("POST", "/session", { title: "Maintenance scope fixture", ...(parentID ? { parentID } : {}) })
    assert.equal(r.status, 200); return r.data.id
  }
  const alive = await create(), child = await create(alive), sibling = await create(alive)
  const removedRoot = await create(), descendant = await create(removedRoot)
  await start("history", project, "--session", alive)
  await until(() => capture().includes("tab agents"), 90000)
  console.log("maintenance: initial TUI ready")
  const file = path.join(temp, "state/opencode/opencode-reviewer/history-v1.sqlite")
  privateDatabase(file); sql = new HistorySQL(new DatabaseSync(file))
  seed(alive, alive, 1); seed(alive, child, 2); seed(alive, sibling, 3)
  // Deliberately omit a root ownership row: scanning the descendant must check root first.
  seed(removedRoot, descendant, 4); seed(removedRoot, descendant, 5, project + "-other-scope")
  const totals = sql.query({ type: "totals" }), before = calls
  await open(); await until(() => capture().includes("3/3"))
  await writeFile(path.join(artifacts, "before.txt"), capture())
  runtime.tmux("kill-session", "-t", "history")
  // Only the public API server remains. No plugin is running during deletions.
  assert.equal((await request("DELETE", "/session/" + child)).status, 200)
  assert.equal((await request("DELETE", "/session/" + removedRoot)).status, 200)
  const absence = await request("GET", "/session/" + removedRoot)
  assert.equal(absence.status, 404); assert.equal(absence.data.name, "NotFoundError")
  assert.equal(typeof absence.data.data.message, "string")
  assert.equal((await request("GET", "/session/" + descendant)).status, 404, "native root deletion cascades")
  runtime.tmux("kill-session", "-t", "api")
  await writeFile(fault, JSON.stringify({ id: removedRoot }))
  await start("history", project, "--session", alive)
  await until(() => capture().includes("tab agents"), 90000)
  await until(async () => JSON.parse(await readFile(observed, "utf8")).blocked >= 2)
  assert.equal(sql.query({ type: "history", scope: project, root: removedRoot }).total, 1, "403 never deletes")
  assert.deepEqual(sql.query({ type: "totals" }), totals)
  await writeFile(path.join(artifacts, "transient.txt"), capture())
  await writeFile(fault, "{}")
  await until(() => sql.query({ type: "history", scope: project, root: removedRoot }).deleted
    && sql.query({ type: "history", scope: project, root: alive }).total === 2)
  await open(); await until(() => capture().includes("2/2") && capture().includes("Stored maintenance report 3"))
  assert.deepEqual(sql.query({ type: "totals" }), totals)
  assert.equal(sql.query({ type: "history", scope: project + "-other-scope", root: removedRoot }).total, 1)
  assert.equal(sql.db.prepare("SELECT count(*) n FROM attempts").get().n, 3)
  assert.equal(sql.db.prepare("SELECT count(*) n FROM payloads").get().n, 3)
  assert.equal(calls, before, "maintenance and history make no model requests")
  const facts = JSON.parse(await readFile(observed, "utf8"))
  assert.equal(facts.replies, 0); assert.equal(facts.missing.status, 404); assert.equal(facts.missing.error.name, "NotFoundError")
  await writeFile(path.join(artifacts, "after.txt"), capture())
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ temp, packed: packed.filename, calls, totals, absence, facts }, null, 2))
  console.log("PASS packed history maintenance: offline root/child deletion, 403 recovery, real NotFound envelope, unchanged totals and other scope")
} catch (error) {
  try { await writeFile(path.join(artifacts, "api-failed.txt"), runtime.tmux("capture-pane", "-p", "-t", "api")) } catch {}
  try { await writeFile(path.join(artifacts, "failed.txt"), capture()) } catch {}
  await writeFile(path.join(artifacts, "failure.txt"), `${error.stack}\n${temp}`)
  throw error
} finally {
  sql?.close(); await runtime.dispose(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve))
}
