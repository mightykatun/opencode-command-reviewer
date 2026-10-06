import { test } from "node:test"
import assert from "node:assert/strict"
import { setTimeout as sleep } from "node:timers/promises"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Controller, displayText, visibleReview, type View } from "../src/controller.js"
import type { Assessment } from "../src/types.js"

const request = (id: string, sessionID = "root", permission = "bash"): PermissionRequest => ({ id, sessionID, permission, patterns: [id], metadata: {}, always: [], tool: { callID: id, messageID: id } })
const result: Assessment = { safe: true, desc: "Counts fruit." }
const tick = () => sleep(0)

test("deduplicates events and keeps concurrent assessments bound to their request", async () => {
  const pending = new Map<string, (value: Assessment) => void>()
  const controller = new Controller((req) => new Promise((resolve) => pending.set(req.id, resolve)), () => {})
  controller.asked(request("a")); controller.asked(request("b")); controller.asked(request("a"))
  await tick()
  assert.equal(pending.size, 2)
  pending.get("b")!({ safe: false, desc: "Deletes data." })
  pending.get("a")!(result)
  await tick()
  assert.deepEqual(controller.views.map((v) => [v.request.id, v.assessment?.safe]), [["a", true], ["b", false]])
  controller.dispose()
})

test("resolution aborts work, removes panel and suppresses a late noncooperative result", async () => {
  let resolve!: (value: Assessment) => void
  let signal!: AbortSignal
  let published: View[] = []
  const controller = new Controller((_, s) => { signal = s; return new Promise((r) => { resolve = r }) }, (views) => { published = views })
  controller.asked(request("a"))
  await tick()
  controller.replied("a")
  assert.ok(signal.aborted)
  assert.deepEqual(published, [])
  resolve(result)
  await tick()
  assert.deepEqual(published, [])
  controller.dispose()
})

test("stale startup snapshot cannot resurrect a resolved permission", () => {
  const controller = new Controller(async () => result, () => {})
  const revision = controller.revision
  controller.replied("a")
  controller.reconcile([request("a")], revision)
  assert.equal(controller.views.length, 0)
  controller.reconcile([request("b")], controller.revision)
  assert.equal(controller.views[0]?.request.id, "b")
  controller.reconcile([], controller.revision)
  assert.deepEqual(controller.views, [])
  controller.dispose()
})

test("errors are visible without a rating; non-shell requests are never evaluated", async () => {
  let calls = 0
  const controller = new Controller(async () => { calls++; throw new Error("Reviewer HTTP 503") }, () => {})
  controller.asked(request("a", "root", "edit"))
  controller.asked(request("b"))
  await tick()
  assert.equal(calls, 1)
  assert.equal(controller.views[1]?.status, "unavailable")
  assert.equal(controller.views[1]?.assessment, undefined)
  controller.dispose()
})

test("display follows root/direct-child approval order and hides unrelated sessions", () => {
  const controller = new Controller(async () => result, () => {})
  const sessions = new Map([ ["root", { id: "root" }], ["sub", { id: "sub", parentID: "root" }], ["other", { id: "other" }] ])
  const get = (id: string) => sessions.get(id)
  controller.asked(request("sub-request", "sub"))
  controller.asked(request("other-request", "other"))
  assert.equal(visibleReview(controller.views, "root", get)?.request.id, "sub-request")
  assert.equal(visibleReview(controller.views, "sub", get), undefined)
  assert.equal(visibleReview(controller.views, undefined, get), undefined)
  controller.asked(request("root-request", "root", "edit"))
  assert.equal(visibleReview(controller.views, "root", get), undefined)
  controller.dispose()
})

test("session deletion and disposal cancel and release pending reviews", async () => {
  const signals: AbortSignal[] = []
  let publications = 0
  const controller = new Controller((_, signal) => { signals.push(signal); return new Promise(() => {}) }, () => { publications++ })
  controller.asked(request("a")); controller.asked(request("b", "child"))
  await tick()
  controller.deleted("child")
  assert.ok(signals[1]!.aborted)
  controller.dispose()
  assert.ok(signals[0]!.aborted)
  const before = publications
  controller.asked(request("c"))
  assert.equal(publications, before)
  assert.deepEqual(controller.views, [])
})

test("terminal control sequences and bidi text cannot manipulate displayed ratings", () => {
  assert.equal(displayText("x\x1b[2J\r\u202ey"), "x\\u001b[2J\\u000d\\u202ey")
  assert.equal(displayText("first\nsecond\tthird"), "first\nsecond\tthird")
  assert.equal(displayText("**Effects**\n- `\x1b[2J`\n- *\u202eRisk*"), "**Effects**\n- `\\u001b[2J`\n- *\\u202eRisk*")
})

test("directory requests stay hidden until their native shell association is verified", async () => {
  let identify!: () => void
  const controller = new Controller(async (_req, _signal, command) => {
    await new Promise<void>((resolve) => { identify = resolve })
    command("python x.py")
    return result
  }, () => {})
  const getSession = (id: string) => ({ id })
  controller.asked(request("directory", "root", "external_directory"))
  assert.equal(visibleReview(controller.views, "root", getSession), undefined)
  await tick()
  identify()
  await tick()
  assert.equal(visibleReview(controller.views, "root", getSession)?.command, "python x.py")
  assert.equal(controller.views[0]?.request.permission, "external_directory")
  controller.dispose()
})

test("unrelated external-directory requests remain hidden and each permission stage is reviewed separately", async () => {
  const evaluated: string[] = []
  const controller = new Controller(async (req) => { evaluated.push(req.id); return req.id === "file-read" ? null : result }, () => {})
  controller.asked(request("file-read", "root", "external_directory"))
  await tick()
  assert.equal(controller.views[0]?.status, "unrelated")
  controller.replied("file-read")
  controller.asked(request("directory", "root", "external_directory"))
  await tick()
  controller.replied("directory")
  controller.asked(request("execute", "root", "bash"))
  await tick()
  assert.deepEqual(evaluated, ["file-read", "directory", "execute"])
  assert.equal(controller.views[0]?.request.permission, "bash")
  controller.dispose()
})
