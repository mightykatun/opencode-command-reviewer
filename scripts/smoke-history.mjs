// Actual bundle and native host controls. Only resolved SQL events are seeded.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "node:http"
import { setTimeout as sleep } from "node:timers/promises"
import { DatabaseSync } from "node:sqlite"
import { tsImport } from "tsx/esm/api"
import { smokeRuntime } from "./smoke-runtime.mjs"
import { runtimeArguments } from "./runtime-inventory.mjs"
import { readObservation } from "./smoke-observations.mjs"
import { activatePalette } from "./smoke-ui.mjs"

const { scenario } = runtimeArguments("smoke-history.mjs")
const root = path.resolve(import.meta.dirname, ".."), host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8" }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-history-"))
const artifacts = path.join(root, ".runtime/history-" + scenario)
await mkdir(artifacts, { recursive: true })
const project = path.join(temp, "project")
await mkdir(project); await mkdir(path.join(temp, "config"))
execFileSync("git", ["init", "--quiet", project])
const bundle = path.join(temp, "bundle.mjs"), wrapper = path.join(temp, "wrapper.mjs"), info = path.join(temp, "session.json")
await copyFile(path.join(root, "dist/tui.js"), bundle)
// Public metadata observation, not an injected history UI or controller state.
await writeFile(wrapper, `import plugin from ${JSON.stringify(pathToFileURL(bundle).href)};
import { observationPublisher } from ${JSON.stringify(new URL("./smoke-observations.mjs", import.meta.url).href)};
export default { id: 'history-fixture', tui: async (api, options) => {
  const publisher = observationPublisher(${JSON.stringify(info)} + '.' + process.env.SMOKE_TARGET);
  let permissions = 0, replies = 0, historyCommands = 0;
  const save = () => { const route = api.route.current;
    publisher.publish({session:route.name === 'session' ? route.params.sessionID : null, permissions, replies, historyCommands});
  };
  // Observe execution of the public production command even when the sidebar is
  // intentionally hidden. The original callback and its synchronous result stay intact.
  const keymap = new Proxy(api.keymap, {get(target, key) {
    if (key !== 'registerLayer') return Reflect.get(target, key);
    return layer => target.registerLayer({...layer, ...(layer.commands ? {commands:layer.commands.map(command =>
      command.name !== 'opencode-reviewer.history' ? command : {...command, run:(...args) => {
        const result = command.run(...args); historyCommands++; save(); return result;
      }})} : {})});
  }});
  await plugin.tui(new Proxy(api, {get(target,key) { return key === 'keymap' ? keymap : Reflect.get(target,key); }}), options);
  api.event.on('permission.asked', () => permissions++);
  api.event.on('permission.replied', () => replies++);
  const off = api.keymap.registerLayer({ commands: [
    ...['Other root', 'Child session'].map((title) => ({ name: 'fixture.' + title.toLowerCase().replaceAll(' ', '-'), namespace: 'palette', title: 'Fixture: ' + title,
      run: async () => { const result = await api.client.session.create({ directory: api.state.path.directory,
        ...(title === 'Child session' ? { parentID: api.route.current.params.sessionID } : {}), title: 'History scope fixture' });
        if (!result.data) throw Error('Could not create fixture session');
        api.route.navigate('session', { sessionID: result.data.id }); } })),
    { name: 'fixture.delete', namespace: 'palette', title: 'Fixture: Delete root', run: async () => {
      await api.client.session.delete({ directory: api.state.path.directory, sessionID: api.route.current.params.sessionID }); } }
  ] });
  const timer = setInterval(save, 100);
  api.lifecycle.onDispose(async () => { clearInterval(timer); off(); save(); await publisher.close(); });
} };
`)
const { HistorySQL } = await tsImport("../src/history-schema.ts", import.meta.url)
const { encodeEvent } = await tsImport("../src/history-records.ts", import.meta.url)
const { privateDatabase } = await tsImport("../src/history-storage-worker.ts", import.meta.url)
const file = path.join(temp, "state/opencode/opencode-reviewer/history-v1.sqlite")
const runtime = await smokeRuntime(temp)
let calls = 0, session, sql, sequence = 0
const server = createServer(async (req, res) => {
  for await (const chunk of req) void chunk
  calls++
  res.writeHead(200, { "Content-Type": "text/event-stream" })
  const chunk = (delta, finish_reason) => ({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })
  res.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: "History fixture ready." }, null))}\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`)
})
let target = "history"
const send = (...keys) => runtime.tmux("send-keys", "-t", target, ...keys)
const capture = () => runtime.tmux("capture-pane", "-p", "-t", target)
const mouse = (button, x, y, release = false) => send("-l", `\x1b[<${button};${x};${y}${release ? "m" : "M"}`)
const click = (x, y) => { mouse(0, x, y); mouse(0, x, y, true) }
const until = async (check, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check(capture())) return; await sleep(100) }
  throw Error("History wait timed out")
}
const save = async name => writeFile(path.join(artifacts, name + ".txt"), capture())
const facts = () => readObservation(info + "." + target)
const palette = async title => {
  await until(async () => !!(await readObservation(info + "." + target, { optional: true }))?.session)
  const before = await facts()
  const hidden = !/Context|Analysis history/.test(capture())
  const postcondition = title === "Reviewer: Report history" ? async s => (await facts()).historyCommands > before.historyCommands
      && (hidden ? !s.includes("Analysis history") : s.includes("Analysis history"))
    : title === "Reviewer: Disable for conversation" ? s => s.includes("Reviewer disabled for this conversation.")
    : title === "New session" || title === "Fixture: Delete root" ? s => s.includes("Ask anything")
    : async () => (await facts()).session !== before.session
  await activatePalette({ send, capture: () => runtime.tmux("capture-pane", "-p", "-e", "-t", target) }, title, postcondition)
}
const open = async () => { await palette("Reviewer: Report history"); await until(s => s.includes("Analysis history")) }
const apply = event => sql.apply("history-fixture", ++sequence, encodeEvent(event))
const seed = (n, options = {}) => {
  const context = { scope: project, root: session, session: options.child ?? session, permission: "p" + n,
    review: options.review ?? "r" + n, category: "bash", configuredModel: "historical-model", provider: "https://history.invalid/v1" }
  apply({ type: "permissionResolved", context, at: 1000 + n, outcome: options.outcome ?? ["manual", "auto", "cancelled", "rejected"][(n - 1) % 4],
    payload: { completedAt: options.completed ?? n, safe: n % 2 === 1, desc: options.desc ?? "Historical report " + n,
      ...(options.timing ? { timing: options.timing } : {}),
      ...(n === 1 ? { usage: { input: 12, output: 3, cost: 0.0001 } } : {}) } })
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const config = { model: "fixture/fixture", small_model: "fixture/fixture", autoupdate: false, provider: { fixture: {
    npm: "@ai-sdk/openai-compatible", options: { baseURL: base, apiKey: "synthetic" }, models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [[wrapper, { notify: false, baseURL: base, model: "fixture", ...(scenario === "disabled-invalid" ? { maxOutputTokens: -1 } : {}) }]] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  const start = (...args) => runtime.start("-d", "-s", target, "-x", "160", "-y", "40", "-c", project, "env",
    ...Object.entries(env).map(([k, v]) => k + "=" + v), "SMOKE_TARGET=" + target, host, project, ...args)
  await start("--prompt", "Say ready.")
  await until(s => s.includes("History fixture ready.") && s.includes("tab agents"), 90000)
  await until(() => calls >= 2); await sleep(500)
  await until(async () => !!(await readObservation(info + "." + target, { optional: true }))?.session)
  session = (await facts()).session
  privateDatabase(file); sql = new HistorySQL(new DatabaseSync(file))
  const before = calls
  if (scenario === "empty-error") {
    await open(); await until(s => s.includes("No history entries")); await save("empty")
    seed(1); await until(s => s.includes("Historical report 1") && s.includes("1/1")); await save("first")
    const original = sql.db.prepare("SELECT body FROM payloads").get().body
    sql.db.exec("UPDATE payloads SET body='invalid'")
    await until(s => s.includes("! Unreadable entry") && s.includes("1/1")); assert.ok(!capture().includes("Manually approved")); await save("invalid")
    sql.db.prepare("UPDATE payloads SET body=?").run(original)
    await until(s => s.includes("Historical report 1")); await save("repaired")
    sql.db.exec("UPDATE history SET completed=-1")
    await until(s => s.includes("History could not be read")); await save("read-error")
    sql.db.exec("UPDATE history SET completed=1")
    await until(s => s.includes("Historical report 1")); await save("recovered")
  } else {
    for (let n = 1; n <= (scenario === "delete" ? 5 : 4); n++) seed(n, scenario === "delete" ? { child: "child-" + n }
      : scenario === "browse" && (n === 1 || n === 4) ? { timing: { ratingMs: 1250, fullReportMs: 3500 } } : {})
    if (scenario === "scroll") seed(4, { review: "long", completed: 5, desc: Array.from({ length: 100 }, (_, i) => `History line ${i + 1}\n`).join("\n") })
    if (scenario === "disabled-invalid") { await palette("Reviewer: Disable for conversation"); await until(s => s.includes("Reviewer disabled for this conversation.")) }
    await open(); await until(s => s.includes(scenario === "delete" ? "5/5" : "4/4")); await save("newest")
    if (scenario === "browse") {
      assert.match(capture(), /Time to first rating: 1\.25s/); assert.match(capture(), /Time to full report: 3\.50s/)
      send("Left"); await until(s => s.includes("3/4") && s.includes("Cancelled"));
      assert.doesNotMatch(capture(), /Time to first rating:|Time to full report:/)
      send("Left"); await until(s => s.includes("2/4") && s.includes("Auto approved"));
      send("Left"); await until(s => s.includes("1/4") && s.includes("Manually approved"));
      assert.match(capture(), /model: historical-model/); assert.match(capture(), /provider: https:\/\/history.invalid\/v1/)
      assert.match(capture(), /Time to first rating: 1\.25s/); assert.match(capture(), /Time to full report: 3\.50s/)
      assert.ok(!capture().includes("lifetime:")); await save("oldest")
      send("-l", "ABC"); send("Left", "Left"); send("-l", "Z")
      await until(s => s.includes("ABCZ") && s.includes("1/4")); send("C-u")
      await open(); await until(s => s.includes("4/4"));
      click(capture().split("\n")[38].lastIndexOf("<") + 1, 39); await until(s => s.includes("3/4"));
      click(capture().split("\n")[38].lastIndexOf(">") + 1, 39); await until(s => s.includes("4/4")); await save("mouse-arrows")
      send("-l", "/reviewer-"); await until(s => s.includes("/reviewer-history")); send("Down", "Up", "Escape")
      await sleep(300); assert.match(capture(), /Analysis history/); await save("autocomplete")
      send("C-u", "C-p"); await until(s => s.includes("Commands")); send("Down", "Up", "Escape")
      await until(s => s.includes("Analysis history")); send("Escape"); await until(s => !s.includes("Analysis history"))
      send("-l", "/reviewer-history"); await until(s => s.includes("Reviewer: Report history")); send("Enter")
      await until(s => s.includes("4/4")); await save("slash")
      click(155, 2); await until(s => !s.includes("Analysis history")); await save("mouse-close")
    } else if (scenario === "scroll") {
      send("PageDown"); await until(s => s.includes("History line 16") && !s.includes("History line 1\n")); await save("scrolled")
      mouse(65, 140, 20); await sleep(300)
      const scrolled = capture().match(/History line \d+/)?.[0]
      seed(5, { completed: 0 }); await until(s => s.includes("5/5"))
      assert.equal(capture().match(/History line \d+/)?.[0], scrolled)
      send("C-p"); await until(s => s.includes("Commands")); send("Escape")
      await until(s => s.includes("Analysis history") && s.match(/History line \d+/)?.[0] === scrolled)
      await save("dialog-scroll-restored")
      runtime.tmux("resize-window", "-t", target, "-x", "90", "-y", "40"); await until(s => !s.includes("Analysis history"))
      runtime.tmux("resize-window", "-t", target, "-x", "160", "-y", "40")
      await until(s => s.match(/History line \d+/)?.[0] === scrolled); await save("narrow-scroll-restored")
      send("C-x", "b"); await until(s => !s.includes("Analysis history")); send("C-x", "b")
      await until(s => s.match(/History line \d+/)?.[0] === scrolled); await save("hidden-scroll-restored")
      await open(); await until(s => s.includes("History line 1")); await save("reset")
      send("Left"); await until(s => s.includes("Historical report 3") && s.includes("4/5"))
      send("Right"); await until(s => s.includes("History line 1") && s.includes("5/5")); await save("selection-reset")
      send("PageDown"); await until(s => s.includes("History line 16"))
      seed(4, { review: "replacement", completed: 6, desc: "Replacement report" })
      await until(s => s.includes("Replacement report") && s.includes("model: historical-model") && s.includes("5/5")); await save("replacement-reset")
    } else if (scenario === "resume") {
      runtime.tmux("kill-session", "-t", target); await start("--session", session)
      await until(s => s.includes("tab agents"), 90000); await open(); await until(s => s.includes("Historical report 4") && s.includes("4/4")); await save("resumed")
    } else if (scenario === "shared") {
      target = "second"; await start("--session", session); await until(s => s.includes("tab agents"), 90000)
      await open(); await until(s => s.includes("4/4")); seed(5)
      await until(s => s.includes("4/5")); await save("second-shared")
      await palette("Fixture: Other root"); await until(s => !s.includes("Analysis history"))
      await open(); await until(s => s.includes("No history entries")); await save("independent-root")
      target = "history"; await until(s => s.includes("4/5")); await save("first-shared")
    } else if (scenario === "delete") {
      const totals = sql.query({ type: "totals" })
      send("Left"); await until(s => s.includes("4/5")); send("Left"); await until(s => s.includes("3/5"))
      apply({ type: "sessionDeleted", context: { scope: project, root: session, session: "child-3" }, at: 2000 })
      await until(s => s.includes("Historical report 4") && s.includes("3/4")); await save("next-newer")
      apply({ type: "sessionDeleted", context: { scope: project, root: session, session: "child-5" }, at: 2001 })
      await until(s => s.includes("3/3"))
      apply({ type: "sessionDeleted", context: { scope: project, root: session, session: "child-4" }, at: 2001 })
      await until(s => s.includes("Historical report 2") && s.includes("2/2")); await save("nearest-older")
      await palette("Fixture: Delete root")
      await until(s => !s.includes("Analysis history")); await save("root-closed")
      await until(() => sql.query({ type: "history", scope: project, root: session }).deleted === true)
      assert.deepEqual(sql.query({ type: "totals" }), totals, "detail deletion preserves lifetime totals")
    } else if (scenario === "visibility") {
      runtime.tmux("resize-window", "-t", target, "-x", "90", "-y", "40"); await until(s => !s.includes("Analysis history"))
      runtime.tmux("resize-window", "-t", target, "-x", "160", "-y", "40"); await until(s => s.includes("4/4")); await save("restored")
      send("C-x", "b"); await until(s => !s.includes("Analysis history"))
      await palette("Reviewer: Report history"); await sleep(300); assert.ok(!capture().includes("Historical report 4"))
      send("C-x", "b"); await until(s => s.includes("4/4"))
      await palette("New session"); await until(s => !s.includes("Analysis history")); await save("route-closed")
    } else if (scenario === "disabled-invalid") {
      await palette("Fixture: Child session"); await until(s => !s.includes("Analysis history"))
      await palette("Reviewer: Report history"); await sleep(300)
      assert.ok(!capture().includes("Analysis history"), "native child route has no sidebar; history must not force one")
      await save("disabled-child-armed")
      send("Up"); await until(s => s.includes("History fixture ready."))
      assert.ok(!capture().includes("Analysis history"), "route changes close logically armed child history")
      await open(); await until(s => s.includes("Historical report 4") && s.includes("4/4")); await save("disabled-root-restored")
    }
  }
  assert.equal(calls, before, "history interaction makes no model requests")
  const observed = await facts()
  assert.equal(observed.permissions, 0); assert.equal(observed.replies, 0, "history never submits an approval")
  await save("final")
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ scenario, calls, temp, session }, null, 2))
  console.log(`PASS history ${scenario}: production SQL and rendered host, ${calls} model calls unchanged`)
} catch (error) {
  await save("failed").catch(() => {})
  await writeFile(path.join(artifacts, "failure.txt"), `${error.stack}\n${temp}`)
  throw error
} finally {
  sql?.close(); await runtime.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
