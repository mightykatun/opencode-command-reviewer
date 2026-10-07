import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, writeFile, rm, symlink, stat } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { SessionModes, SessionModeStore, type ModeStore } from "../src/session-mode.js"
import { sessionModeCommands } from "../src/session-mode-commands.js"

const signal = () => new AbortController().signal
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const memory = (): ModeStore => ({ read: async () => true, write: async () => {}, flush: async () => {} })

test("atomic mode records survive restart, serialize toggles and isolate host/root identities", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-mode-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new SessionModeStore(directory, "/host")
  assert.equal(await store.read("root", signal()), true)
  await Promise.all([store.write("root", false), store.write("root", true), store.write("root", false), store.write("other", true)])
  await store.flush()
  const resumed = new SessionModeStore(directory, "/host")
  assert.equal(await resumed.read("root", signal()), false)
  assert.equal(await resumed.read("other", signal()), true)
  assert.equal(await new SessionModeStore(directory, "/other-host").read("root", signal()), true)
  const resumedModes = new SessionModes(resumed, async (id) => ({ id, ...(id === "child" ? { parentID: "root" } : {}) }))
  const inherited = await resumedModes.root("child", signal())
  await resumedModes.load(inherited, signal())
  assert.equal(resumedModes.enabled(inherited), false, "a resumed descendant inherits persisted root mode")
  const names = await readdir(directory)
  assert.equal(names.length, 2)
  for (const name of names) {
    assert.match(name, /^[a-f0-9]{64}\.json$/)
    assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o600)
    assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(directory, name), "utf8"))).sort(), ["enabled", "version"])
  }
})

test("mode reads reject corrupt, oversized, invalid UTF-8, nonregular and linked records", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-mode-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new SessionModeStore(directory, "host")
  await store.write("root", false)
  const file = path.join(directory, (await readdir(directory))[0]!)
  for (const value of ["{", "null", '{"version":2,"enabled":false}', '{"version":1,"enabled":"false"}',
    '{"version":1,"enabled":true,"extra":1}', " ".repeat(1025), Buffer.from([0xff])]) {
    await writeFile(file, value)
    await assert.rejects(store.read("root", signal()))
  }
  await rm(file)
  await symlink(directory, file)
  await assert.rejects(store.read("root", signal()))
  await rm(file)
  const { mkdir } = await import("node:fs/promises")
  await mkdir(file)
  await assert.rejects(store.read("root", signal()))
})

test("failed writes reject honestly and later serialized writes recover", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-mode-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = path.join(directory, "blocked")
  await writeFile(blocked, "not a directory")
  const store = new SessionModeStore(blocked, "host")
  await assert.rejects(store.write("root", false))
  await assert.rejects(store.flush())
  await rm(blocked)
  await store.write("root", false)
  assert.equal(await store.read("root", signal()), false)
})

test("bounded ancestry resolves all descendants using only session metadata", async () => {
  const calls: string[] = []
  const modes = new SessionModes(memory(), async (id) => {
    calls.push(id)
    return { id, ...(id === "root" ? {} : { parentID: id === "grandchild" ? "child" : "root" }) }
  })
  assert.equal(await modes.root("grandchild", signal()), "root")
  assert.deepEqual(calls, ["grandchild", "child", "root"])
  assert.equal(modes.enabled("root"), false)
  await modes.load("root", signal())
  assert.equal(modes.enabled("root"), true)
  await modes.set("root", false)
  assert.equal(await modes.root("child", signal()), "root")
  assert.equal(modes.enabled("root"), false)
  modes.deleted("root")
  await modes.root("child", signal())
  assert.equal(calls.length, 5)
})

for (const failure of ["missing", "mismatch", "cycle", "depth", "empty parent"] as const) {
  test(`ancestry ${failure} remains closed`, async () => {
    let calls = 0
    const modes = new SessionModes(memory(), async (id) => {
      calls++
      if (failure === "missing") return undefined
      if (failure === "mismatch") return { id: "wrong" }
      return { id, parentID: failure === "cycle" ? "root" : failure === "empty parent" ? "" : `${id}-next` }
    })
    await assert.rejects(modes.root("root", signal()))
    assert.ok(calls <= 17)
    assert.equal(modes.enabled("root"), false)
  })
}

test("late initial store read cannot overwrite a local disabled switch", async () => {
  const read = deferred<boolean>()
  const modes = new SessionModes({ ...memory(), read: () => read.promise }, async (id) => ({ id }))
  const loading = modes.load("root", signal())
  await modes.set("root", false)
  read.resolve(true)
  await loading
  assert.equal(modes.enabled("root"), false)
})

test("store errors remain closed, and bounded metadata reads honor parent cancellation", async () => {
  const modes = new SessionModes({ ...memory(), read: async () => { throw new Error("broken") } }, async () => new Promise(() => {}))
  await assert.rejects(modes.load("root", signal()))
  assert.equal(modes.enabled("root"), false)
  const abort = new AbortController()
  const lookup = modes.root("root", abort.signal)
  abort.abort()
  await assert.rejects(lookup)
})

test("noncooperative ancestry and mode reads expire within their five-second budgets", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const modes = new SessionModes({ ...memory(), read: () => new Promise(() => {}) }, async () => new Promise(() => {}))
  const lookup = assert.rejects(modes.root("root", signal()), /Session mode ancestry timed out/)
  const loading = assert.rejects(modes.load("root", signal()), /Session mode loading timed out/)
  await Promise.resolve()
  t.mock.timers.tick(5000)
  await Promise.all([lookup, loading])
  assert.equal(modes.enabled("root"), false)
})

test("local palette/slash commands capture session, persist, report failures and do nothing on home", async () => {
  const toasts: { message: string }[] = [], changes: string[] = [], writes: boolean[] = []
  let route: TuiPluginApi["route"]["current"] = { name: "home" }
  let fail = false
  const modes = new SessionModes({ ...memory(), write: async (_, enabled) => { writes.push(enabled); if (fail) throw new Error("private") } },
    async (id) => ({ id, ...(id === "child" ? { parentID: "root" } : {}) }))
  type Command = { namespace: string; slashName: string; enabled: () => boolean; run: () => Promise<void> }
  let commands!: Command[]
  const unregister = () => {}
  const api = { route: { get current() { return route } }, lifecycle: { signal: signal() },
    ui: { toast: (value: { message: string }) => toasts.push(value) },
    keymap: { registerLayer: (layer: { commands: Command[] }) => { commands = layer.commands; return unregister } } } as unknown as TuiPluginApi
  assert.equal(sessionModeCommands(api, modes, (root) => changes.push(root)), unregister)
  assert.deepEqual(commands.map((c) => [c.namespace, c.slashName]), [["palette", "reviewer-enable"], ["palette", "reviewer-disable"]])
  await commands[0]!.run()
  assert.equal(commands[0]!.enabled(), false)
  assert.deepEqual(writes, [])
  route = { name: "session", params: { sessionID: "child" } }
  await commands[1]!.run()
  assert.equal(modes.enabled("root"), false)
  assert.match(toasts.at(-1)!.message, /Saved for resume/)
  fail = true
  await commands[0]!.run()
  assert.equal(modes.enabled("root"), true)
  assert.deepEqual(changes, ["root", "root"])
  assert.match(toasts.at(-1)!.message, /enabled locally, but saving failed/)
  assert.doesNotMatch(JSON.stringify(toasts), /private/)
})

test("enable cannot bypass corrupt persisted mode", async () => {
  let writes = 0, changes = 0
  const modes = new SessionModes({ ...memory(), read: async () => { throw new Error("private record") }, write: async () => { writes++ } }, async (id) => ({ id }))
  const toasts: { message: string }[] = []
  let commands!: { run: () => Promise<void> }[]
  const api = { route: { current: { name: "session", params: { sessionID: "root" } } }, lifecycle: { signal: signal() },
    ui: { toast: (value: { message: string }) => toasts.push(value) },
    keymap: { registerLayer: (layer: { commands: typeof commands }) => { commands = layer.commands; return () => {} } } } as unknown as TuiPluginApi
  sessionModeCommands(api, modes, () => { changes++ })
  await commands[0]!.run()
  assert.equal(modes.enabled("root"), false)
  assert.equal(writes, 0)
  assert.equal(changes, 0)
  assert.match(toasts[0]!.message, /saved mode could not be read/)
})

test("newer root command defeats an older descendant lookup and pending persistence does not delay the local switch", async () => {
  const lookup = deferred<{ id: string; parentID: string }>()
  const persistence = deferred<void>()
  const writes: boolean[] = [], changes: string[] = []
  const modes = new SessionModes({ ...memory(), write: async (_, enabled) => { writes.push(enabled); await persistence.promise } },
    async (id) => id === "child" ? lookup.promise : { id })
  let sessionID = "child"
  let commands!: { run: () => Promise<void> }[]
  const api = { route: { get current() { return { name: "session", params: { sessionID } } } }, lifecycle: { signal: signal() },
    ui: { toast: () => {} }, keymap: { registerLayer: (layer: { commands: typeof commands }) => { commands = layer.commands; return () => {} } } } as unknown as TuiPluginApi
  sessionModeCommands(api, modes, (root) => changes.push(root))
  const oldEnable = commands[0]!.run()
  sessionID = "root"
  const disable = commands[1]!.run()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(modes.enabled("root"), false)
  assert.deepEqual(changes, ["root"])
  lookup.resolve({ id: "child", parentID: "root" })
  await oldEnable
  assert.deepEqual(writes, [false])
  persistence.resolve()
  await disable
})
