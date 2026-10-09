import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as settle } from "node:timers/promises"
import { HistoryController } from "../src/history-controller.js"
import type { HistorySelection } from "../src/history-schema.js"
import type { HistoryQuery } from "../src/history-records.js"
import { historyLayout, historyMetadata } from "../src/history-layout.js"
import { uiText } from "../src/ui-text.js"
import { historyCommands } from "../src/history-commands.js"
import { SessionModes } from "../src/session-mode.js"

const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
const entry = "a".repeat(64)
const selection: HistorySelection = { revision: 1, total: 1, rank: 1, entry,
  order: { completed: 1, tie: "r", id: entry }, record: { outcome: "manual",
    context: { scope: "/project", root: "root", session: "root", permission: "p", review: "r", category: "bash", configuredModel: "m", provider: "https://example.com" },
    payload: { safe: true, completedAt: 1, desc: "report" } } }
function fixture(t: any, ancestry: (id: string, signal: AbortSignal) => Promise<string> = async () => "root") {
  const pending: { query: HistoryQuery; resolve: (s: HistorySelection) => void; reject: () => void }[] = []
  let commit = () => {}
  const controller = new HistoryController("/project", {
    query: query => new Promise((resolve, reject) => pending.push({ query, resolve, reject: () => reject(Error()) })),
    onCommit: cb => { commit = cb; return () => {} }, onWriteFailure: () => () => {},
  }, ancestry, () => {})
  t.after(() => controller.dispose())
  return { controller, pending, commit: () => commit() }
}
test("history has independent exact copy and extreme footer layouts", () => {
  assert.deepEqual(uiText.history.outcomes, { auto: "Auto approved", manual: "Manually approved", cancelled: "Cancelled", rejected: "Rejected" })
  assert.equal(uiText.commands.history, "Reviewer: Report history")
  assert.deepEqual([uiText.history.heading, uiText.history.close, uiText.history.older, uiText.history.newer,
    uiText.history.empty, uiText.history.loading, uiText.history.unavailable, uiText.history.unreadable],
  ["Analysis history", "Close", "<", ">", "No history entries", "Loading history", "History could not be read", "! Unreadable entry"])
  assert.equal(uiText.history.model("fixture"), "model: fixture")
  assert.equal(uiText.history.provider("https://example.com"), "provider: https://example.com")
  assert.equal(uiText.history.index(12, 300), "12/300")
  assert.deepEqual(historyLayout("Manually approved", "1/1"), { label: "Manually approved", rows: 1 })
  for (const [label, short] of [["Auto approved", "Aut..ved"], ["Manually approved", "Man..ved"], ["Cancelled", "Can..led"], ["Rejected", "Rej..ted"]]) {
    assert.deepEqual(historyLayout(label, "123456789/123456789"), { label: label === "Rejected" ? label : short, rows: 1 })
    assert.deepEqual(historyLayout(label, "123456789/1234567890"), { label, rows: 2 })
  }
  assert.deepEqual(historyLayout("Manually approved", "9007199254740991/9007199254740991"), { label: "Manually approved", rows: 3 })
  assert.equal(historyLayout("Manually approved", "12345678/123456789").label, "Manu..ved")
})
test("historical metadata order, fallback, usage independence and control sanitization", () => {
  assert.equal(historyMetadata(selection.record!), "model: m\nprovider: https://example.com")
  assert.equal(historyMetadata({ ...selection.record!, payload: { ...selection.record!.payload, reportedModel: "reported", usage: { input: 12, output: 3, cost: 0.0001 } } }),
    "token: 12 in 3 out\ncost: $0.0001\nmodel: reported\nprovider: https://example.com")
  const unsafe = historyMetadata({ ...selection.record!, payload: { ...selection.record!.payload, reportedModel: "x\x1b[31m\u202ey" } })
  assert.ok(!unsafe.includes("\x1b")); assert.ok(!unsafe.includes("\u202e")); assert.ok(!unsafe.includes("lifetime"))
})
test("public command contract and base-mode bindings leave normal typing to host", () => {
  const layers: any[] = []; let session: string | undefined = "child", interactive = true, dialog = false
  const actions: unknown[] = []
  const off = historyCommands({ route: { get current() { return session ? { name: "session", params: { sessionID: session } } : { name: "home" } } },
    ui: { dialog: { get open() { return dialog } } }, keymap: { registerLayer: (layer: unknown) => { layers.push(layer); return () => actions.push("off") } } } as any,
  { state: { open: true }, open: (id: string) => actions.push(id), close: () => actions.push("close"), navigate: (direction: string) => actions.push(direction) } as any,
  () => interactive, (amount, page) => actions.push([amount, page]))
  const command = layers[0].commands[0]
  assert.deepEqual([command.name, command.namespace, command.slashName, command.title, command.category],
    ["opencode-reviewer.history", "palette", "reviewer-history", "Reviewer: Report history", "Reviewer"])
  command.run(); assert.deepEqual(actions, ["child"])
  session = undefined; assert.equal(command.enabled(), false); command.run(); assert.equal(actions.length, 1)
  const keys = layers[1]; assert.equal(keys.mode, "base"); assert.equal(keys.priority, 100)
  assert.deepEqual(keys.bindings.map((b: any) => b.key), ["left", "right", "escape", "up", "down", "pageup", "pagedown"])
  assert.equal(keys.enabled(), true); dialog = true; assert.equal(keys.enabled(), false)
  dialog = false; interactive = false; assert.equal(keys.enabled(), false)
  off(); assert.deepEqual(actions.slice(-2), ["off", "off"])
})
test("real bounded ancestry is available without loading disabled or invalid mode records", async t => {
  let loads = 0
  const modes = new SessionModes({ load: async () => { loads++; throw Error("invalid saved mode") } } as any,
    async id => ({ id, ...(id === "child" ? { parentID: "root" } : {}) }) as any)
  const f = fixture(t, (id, signal) => modes.root(id, signal))
  f.controller.open("child"); await tick()
  assert.equal(loads, 0); assert.equal((f.pending[0]!.query as any).root, "root")
})
for (const kind of ["missing", "cycle", "depth"] as const) test(`history rejects actual ${kind} ancestry without mode loads or guessed queries`, async t => {
  const modes = new SessionModes({ load: async () => { throw Error("must not load") } } as any, async id => {
    if (kind === "missing") return undefined
    return { id, parentID: kind === "cycle" ? id : String(Number(id) + 1) } as any
  })
  const f = fixture(t, (id, signal) => modes.root(id, signal))
  f.controller.open("0"); await settle()
  assert.equal(f.controller.state.status, "error"); assert.equal(f.pending.length, 0)
})
test("unavailable ancestry retries after two seconds and close cancels further retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  let attempts = 0
  const f = fixture(t, async () => { if (++attempts === 1) throw Error("unavailable"); return "root" })
  f.controller.open("child"); await tick(); assert.equal(f.controller.state.status, "error")
  t.mock.timers.tick(1999); await tick(); assert.equal(attempts, 1)
  t.mock.timers.tick(1); await tick(); assert.equal(attempts, 2)
  f.pending.shift()!.resolve(selection); await tick(); assert.equal(f.controller.state.status, "ready")
  f.controller.close(); t.mock.timers.tick(4000); await tick(); assert.equal(attempts, 2)
})
test("open, insertion refresh, replacement and repeat preserve identity but reset appropriate scroll", async t => {
  const f = fixture(t), c = f.controller
  c.open("child"); await tick(); assert.deepEqual(f.pending[0]!.query, { type: "history", scope: "/project", root: "root" })
  f.pending.shift()!.resolve(selection); await tick(); c.scroll = 17
  f.commit(); f.pending.shift()!.resolve({ ...selection, total: 2 }); await tick()
  assert.equal(c.scroll, 17); assert.equal(c.state.selection?.entry, entry)
  f.commit(); f.pending.shift()!.resolve({ ...selection, record: { ...selection.record!, outcome: "auto" } }); await tick()
  assert.equal(c.scroll, 17)
  f.commit(); f.pending.shift()!.resolve({ ...selection, order: { ...selection.order!, tie: "new" } }); await tick()
  assert.equal(c.scroll, 0)
  c.scroll = 20; c.open("child"); await tick(); assert.equal(c.scroll, 0); assert.equal((f.pending[0]!.query as any).entry, undefined)
})
test("close, route change, deletion and disposal invalidate pending snapshots", async t => {
  for (const action of ["close", "route", "deleted", "dispose"] as const) {
    const f = fixture(t), c = f.controller
    c.open("root"); assert.equal(c.isCurrent("root"), true); assert.equal(c.isCurrent("child"), false); await tick()
    if (action === "route") c.route("child")
    else if (action === "deleted") c.deleted("root")
    else c[action]()
    f.pending[0]!.resolve(selection); await tick(); assert.equal(c.state.open, false)
    assert.equal(c.isCurrent("root"), false)
  }
})
test("late ancestry cannot reopen, invalid roots show error and never query a guessed scope", async t => {
  let resolve!: (root: string) => void
  const f = fixture(t, () => new Promise(r => { resolve = r }))
  f.controller.open("missing"); f.controller.close(); resolve("root"); await tick()
  assert.equal(f.pending.length, 0)
  const invalid = fixture(t, async () => { throw Error("cycle/depth/missing") })
  invalid.controller.open("invalid"); await tick()
  assert.equal(invalid.controller.state.status, "error"); assert.equal(invalid.pending.length, 0)
})
test("selection races discard old reads and navigation ends do not issue queries", async t => {
  const f = fixture(t), c = f.controller
  c.open("root"); await tick(); f.pending.shift()!.resolve(selection); await tick()
  c.navigate("older"); c.navigate("newer"); assert.equal(f.pending.length, 0)
  f.commit(); c.open("other"); await tick()
  f.pending[0]!.resolve({ ...selection, total: 99 }); await tick()
  assert.equal(c.state.selection, undefined)
  f.pending[1]!.resolve({ revision: 0, total: 0, rank: 0 }); await tick()
  assert.equal((c.state.selection as HistorySelection | undefined)?.total, 0)
})
test("live deletion suppresses precommit snapshots and durable root deletion closes", async t => {
  const f = fixture(t), c = f.controller
  c.open("root"); await tick()
  const child = { ...selection, record: { ...selection.record!, context: { ...selection.record!.context, session: "child" } } }
  f.pending.shift()!.resolve(child); await tick()
  c.deleted("child"); assert.equal(c.state.status, "loading")
  f.pending.shift()!.resolve(child); await tick(); assert.equal(c.state.status, "loading")
  f.commit(); f.pending.shift()!.resolve({ ...child, record: undefined, unreadable: true }); await tick()
  assert.equal(c.state.status, "loading", "a corrupt precommit payload cannot resurrect a deleted selection")
  f.commit(); f.pending.shift()!.resolve({ revision: 2, rank: 0, total: 0 }); await tick()
  assert.equal(c.state.status, "ready"); assert.equal(c.state.selection?.entry, undefined)
  f.commit(); f.pending.shift()!.resolve({ revision: 3, rank: 0, total: 0, deleted: true }); await tick()
  assert.equal(c.state.open, false)
})
