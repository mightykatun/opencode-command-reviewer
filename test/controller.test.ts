import { test } from "node:test"
import assert from "node:assert/strict"
import { setTimeout as sleep } from "node:timers/promises"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Controller as CoreController, displayText, visibleReview, type View } from "../src/controller.js"
import { loadContext, type ContextReader } from "../src/context.js"
import { withDeadline } from "../src/reviewer.js"
import type { Assessment } from "../src/types.js"

// Existing directory lifecycle cases opt into the newly independent category.
class Controller extends CoreController {
  constructor(...args: ConstructorParameters<typeof CoreController>) {
    super(args[0], args[1], { reviewBash: true, reviewEdits: true, reviewExternalDirectories: true, ...args[2] }, args[3], args[4])
  }
}

const request = (id: string, sessionID = "root", permission = "bash"): PermissionRequest => ({ id, sessionID, permission, patterns: [id], metadata: {}, always: [], tool: { callID: id, messageID: id } })
const result: Assessment = { safe: true, desc: "Counts fruit." }
const tick = () => sleep(0)
const getSession = (id: string) => ({ id })

const contextReader = (message: ContextReader["message"]): ContextReader => ({
  message,
  session: async () => undefined,
  messages: async () => [],
  projects: async () => [],
})

const shellMessage: ContextReader["message"] = async (sessionID, messageID) => ({
  info: {
    id: messageID, sessionID, role: "assistant", parentID: "user", time: { created: 2 },
    providerID: "fixture", modelID: "fixture", mode: "build", agent: "build", path: { cwd: "/", root: "/" },
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [{
    id: "tool-part", messageID, sessionID, type: "tool", callID: messageID, tool: "bash",
    state: { status: "running", input: { command: "python x.py" }, time: { start: 1 } },
  }],
})

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

test("unknown-session deletion invalidates an in-flight startup snapshot", async () => {
  const evaluated: string[] = []
  const controller = new Controller(async (req) => { evaluated.push(req.id); return result }, () => {})
  const revision = controller.revision
  controller.deleted("deleted")
  assert.ok(controller.revision > revision)
  controller.reconcile([request("stale", "deleted")], revision)
  await tick()
  assert.equal(controller.views.length, 0)
  assert.deepEqual(evaluated, [])
  controller.reconcile([request("fresh")], controller.revision)
  await tick()
  assert.deepEqual(evaluated, ["fresh"])
  assert.equal(controller.views[0]?.assessment, result)
  controller.dispose()
})

test("deletion cancels every matching request and ignores late callbacks without disturbing another session", async () => {
  const pending = new Map<string, { signal: AbortSignal; onIdentified: () => void; resolve: (value: Assessment) => void; reject: (error: Error) => void }>()
  let publications = 0
  const controller = new Controller((req, signal, onIdentified) => new Promise((resolve, reject) => {
    pending.set(req.id, { signal, onIdentified, resolve, reject })
  }), () => { publications++ })
  const directory = request("directory", "deleted", "external_directory")
  const execution = { ...request("execute", "deleted"), tool: directory.tool }
  controller.asked(directory); controller.asked(execution); controller.asked(request("survivor"))
  await tick()
  const revision = controller.revision
  controller.deleted("deleted")
  assert.ok(controller.revision > revision)
  assert.ok(pending.get("directory")!.signal.aborted)
  assert.ok(pending.get("execute")!.signal.aborted)
  assert.equal(pending.get("survivor")!.signal.aborted, false)
  const before = publications
  controller.reconcile([directory, execution, request("survivor")], revision)
  pending.get("directory")!.onIdentified()
  pending.get("execute")!.onIdentified()
  pending.get("directory")!.resolve(result)
  pending.get("execute")!.reject(new Error("Late failure"))
  await tick()
  assert.equal(publications, before)
  assert.deepEqual(controller.views.map((view) => view.request.id), ["survivor"])
  pending.get("survivor")!.resolve(result)
  await tick()
  assert.equal(visibleReview(controller.views, "root", getSession)?.assessment, result)
  controller.dispose()
})

for (const removal of ["reply", "dispose"] as const) {
  test(`${removal} suppresses late identification, result and error callbacks`, async () => {
    const pending: { signal: AbortSignal; onIdentified: () => void; resolve: (value: Assessment) => void; reject: (error: Error) => void }[] = []
    let publications = 0
    const controller = new Controller((_, signal, onIdentified) => new Promise((resolve, reject) => {
      pending.push({ signal, onIdentified, resolve, reject })
    }), () => { publications++ })
    controller.asked(request("a", "root", "external_directory")); controller.asked(request("b"))
    await tick()
    if (removal === "reply") { controller.replied("a"); controller.replied("b") }
    else controller.dispose()
    const before = publications
    for (const entry of pending) {
      assert.ok(entry.signal.aborted)
      entry.onIdentified()
    }
    pending[0]!.resolve(result)
    pending[1]!.reject(new Error("Late failure"))
    await tick()
    assert.equal(publications, before)
    assert.deepEqual(controller.views, [])
    controller.dispose()
  })
}

for (const failure of ["missing message", "reader error", "timeout"] as const) {
  test(`pre-identification ${failure} stays hidden for every unverified origin and blocks later reviews`, { timeout: 2000 }, async (t) => {
    const reader = contextReader(async () => {
      if (failure === "missing message") return undefined
      if (failure === "reader error") throw new Error("Context unavailable")
      return new Promise(() => {})
    })
    const callbacks: (() => void)[] = []
    let finished!: () => void
    const failed = new Promise<void>((resolve) => { finished = resolve })
    let publications = 0
    const controller = new Controller((req, parent, onIdentified) => {
      if (req.id === "c-later") return Promise.resolve(result)
      callbacks.push(onIdentified)
      return withDeadline(parent, 10, async (signal) => {
        const context = await loadContext(req, reader, signal)
        if (!context) return null
        onIdentified()
        return result
      })
    }, (views) => {
      publications++
      if (views.filter((view) => view.error).length === 2) finished()
    })
    t.after(() => controller.dispose())
    controller.asked({ ...request("a-directory", "root", "external_directory"), metadata: { command: "unverified metadata command" } })
    controller.asked(request("b-bash"))
    controller.asked(request("c-later"))
    await failed
    const expected = failure === "missing message" ? "Pending native shell message unavailable"
      : failure === "reader error" ? "Context unavailable" : "Review timed out"
    assert.equal(controller.views[0]?.error, expected)
    assert.equal(controller.views[0]?.assessment, undefined)
    assert.equal(controller.views[2]?.status, "complete")
    assert.equal(visibleReview(controller.views, "root", getSession), undefined)
    const before = publications
    for (const onIdentified of callbacks) onIdentified()
    assert.equal(publications, before)
    assert.equal(visibleReview(controller.views, "root", getSession), undefined)
    controller.replied("a-directory")
    const visible = visibleReview(controller.views, "root", getSession)
    assert.equal(visible, undefined)
    assert.equal(controller.views[0]?.status, "unidentified")
    assert.equal(controller.views[0]?.error, expected)
    controller.replied("b-bash")
    assert.equal(visibleReview(controller.views, "root", getSession)?.request.id, "c-later")
  })
}

test("context-identified directory review failures remain visible without a rating", { timeout: 2000 }, async (t) => {
  let finished!: () => void
  const failed = new Promise<void>((resolve) => { finished = resolve })
  const controller = new Controller(async (req, signal, onIdentified) => {
    const context = await loadContext(req, contextReader(shellMessage), signal)
    assert.ok(context)
    onIdentified()
    throw new Error("Reviewer HTTP 503")
  }, (views) => { if (views[0]?.error) finished() })
  t.after(() => controller.dispose())
  controller.asked(request("directory", "root", "external_directory"))
  await failed
  const visible = visibleReview(controller.views, "root", getSession)
  assert.equal(visible?.request.permission, "external_directory")
  assert.equal(visible?.status, "unavailable")
  assert.equal(visible?.error, "Reviewer HTTP 503")
  assert.equal(visible?.assessment, undefined)
})

test("errors are visible without a rating; unrelated requests are never evaluated", async () => {
  let calls = 0
  const controller = new Controller(async (_, __, identified) => { calls++; identified(); throw new Error("Reviewer HTTP 503") }, () => {})
  controller.asked(request("a", "root", "read"))
  controller.asked(request("b"))
  controller.asked(request("c", "root", "edit"))
  await tick()
  assert.equal(calls, 2)
  assert.equal(controller.views[1]?.status, "unavailable")
  assert.equal(controller.views[1]?.assessment, undefined)
  assert.equal(controller.views[2]?.status, "unavailable")
  assert.equal(controller.views[2]?.assessment, undefined)
  controller.dispose()
})

test("display follows root/direct-child approval order and hides unrelated sessions", async () => {
  const controller = new Controller(async () => result, () => {})
  const sessions = new Map([ ["root", { id: "root" }], ["sub", { id: "sub", parentID: "root" }], ["other", { id: "other" }] ])
  const get = (id: string) => sessions.get(id)
  controller.asked(request("sub-request", "sub"))
  controller.asked(request("other-request", "other"))
  await tick()
  assert.equal(visibleReview(controller.views, "root", get)?.request.id, "sub-request")
  assert.equal(visibleReview(controller.views, "sub", get), undefined)
  assert.equal(visibleReview(controller.views, undefined, get), undefined)
  controller.asked(request("root-request", "root", "read"))
  assert.equal(visibleReview(controller.views, "root", get), undefined)
  controller.dispose()
})

for (const scope of ["root", "child"] as const) {
  test(`mixed-case request IDs use native code-unit order in the ${scope} session`, () => {
    const get = (id: string) => ({ id, parentID: id === "child" ? "root" : undefined })
    const views: View[] = ["per_a", "per_B", "per_A"].map((id) => ({ request: request(id, scope), status: "complete", assessment: result }))
    for (const order of [views, views.toReversed(), [views[1]!, views[0]!, views[2]!]]) {
      let pending = [...order]
      for (const expected of ["per_A", "per_B", "per_a"]) {
        const before = [...pending]
        const visible = visibleReview(pending, "root", get)
        assert.equal(visible?.request.id, expected)
        assert.deepEqual(pending, before, "selection must not reorder the supplied views")
        pending = pending.filter((view) => view !== visible)
      }
      assert.equal(visibleReview(pending, "root", get), undefined)
    }
  })
}

test("mixed-case session IDs take precedence over request IDs within root/direct-child scope", () => {
  const sessions = new Map([
    ["ses_a", { id: "ses_a" }],
    ["ses_A", { id: "ses_A", parentID: "ses_a" }],
    ["ses_B", { id: "ses_B", parentID: "ses_a" }],
    ["ses_0", { id: "ses_0" }],
    ["ses_1", { id: "ses_1", parentID: "ses_A" }],
  ])
  const get = (id: string) => sessions.get(id)
  const views: View[] = [
    request("per_A", "ses_a"), request("per_B", "ses_B"), request("per_z", "ses_A"),
    request("per_0", "ses_0", "read"), request("per_1", "ses_1", "read"), request("per_2", "ses_2", "read"),
  ].map((req) => ({ request: req, status: req.permission === "read" ? "unrelated" : "complete", assessment: req.permission === "bash" ? result : undefined }))
  for (const order of [views, views.toReversed()]) {
    let pending = [...order]
    for (const expected of ["per_z", "per_B", "per_A"]) {
      const visible = visibleReview(pending, "ses_a", get)
      assert.equal(visible?.request.id, expected)
      pending = pending.filter((view) => view !== visible)
    }
    assert.equal(visibleReview(pending, "ses_a", get), undefined)
  }
  for (const route of ["ses_A", "ses_B", "ses_1", "missing", undefined]) {
    assert.equal(visibleReview(views, route, get), undefined)
  }
})

for (const scope of ["root request", "child request", "root session", "child session"] as const) {
  test(`native-first mixed-case ${scope} blockers suppress later assessments`, () => {
    const root = scope === "child session" ? "ses_a" : "ses_A"
    const child = scope === "child session" ? "ses_A" : "ses_a"
    const sessions = new Map([[root, { id: root }], [child, { id: child, parentID: root }]])
    const get = (id: string) => sessions.get(id)
    const bySession = scope.endsWith("session")
    const firstSession = scope.startsWith("root") ? root : child
    const laterSession = bySession ? scope.startsWith("root") ? child : root : firstSession
    const later: View = { request: request(bySession ? "per_A" : "per_a", laterSession), status: "complete", assessment: result }
    for (const status of ["unrelated", "identifying", "unidentified"] as const) {
      const blocker: View = {
        request: request(bySession ? "per_z" : "per_A", firstSession, status === "unrelated" ? "read" : "external_directory"),
        status,
      }
      for (const order of [[later, blocker], [blocker, later]]) {
        assert.equal(visibleReview(order, root, get), undefined, `${status} must block the later assessment`)
      }
      assert.equal(visibleReview([later], root, get), later, "removing the blocker reveals the later assessment")
      assert.equal(visibleReview([{ ...blocker, status: "analyzing" }, later], root, get)?.request.id, blocker.request.id)
    }
  })
}

test("equal session/request keys preserve the first input view", () => {
  const first: View = { request: request("per_A"), status: "complete", assessment: result }
  const second: View = { ...first, status: "unrelated", assessment: undefined }
  assert.equal(visibleReview([first, second], "root", getSession), first)
  assert.equal(visibleReview([second, first], "root", getSession), undefined)
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

test("directory identification reveals analysis before completion and late identification cannot reopen it", async (t) => {
  let identify!: () => void
  let complete!: (value: Assessment) => void
  let publications = 0
  const controller = new Controller((_req, _signal, onIdentified) => {
    identify = onIdentified
    return new Promise((resolve) => { complete = resolve })
  }, () => { publications++ })
  t.after(() => controller.dispose())
  controller.asked(request("directory", "root", "external_directory"))
  assert.equal(controller.views[0]?.status, "identifying")
  assert.equal(visibleReview(controller.views, "root", getSession), undefined)
  await tick()
  identify()
  const analyzing = visibleReview(controller.views, "root", getSession)
  assert.equal(analyzing?.request.id, "directory")
  assert.equal(analyzing?.request.permission, "external_directory")
  assert.equal(analyzing?.status, "analyzing")
  assert.equal(analyzing?.assessment, undefined)
  complete(result)
  await tick()
  const completed = visibleReview(controller.views, "root", getSession)
  assert.equal(completed?.status, "complete")
  assert.equal(completed?.assessment, result)
  const before = publications
  identify()
  assert.equal(publications, before)
  assert.equal(visibleReview(controller.views, "root", getSession), completed)
})

test("unrelated external-directory requests remain hidden and each permission stage is reviewed separately", async () => {
  const evaluated: string[] = []
  const controller = new Controller(async (req) => { evaluated.push(req.id); return req.id === "file-read" ? null : result }, () => {})
  controller.asked(request("file-read", "root", "external_directory"))
  await tick()
  assert.equal(controller.views[0]?.status, "unrelated")
  controller.replied("file-read")
  const directory = request("directory", "root", "external_directory")
  const execution = { ...request("execute", "root", "bash"), tool: directory.tool }
  controller.asked(directory)
  await tick()
  controller.replied("directory")
  controller.asked(execution)
  controller.asked(execution)
  await tick()
  assert.deepEqual(evaluated, ["file-read", "directory", "execute"])
  assert.equal(controller.views[0]?.request.permission, "bash")
  controller.dispose()
})

test("edit reviews deduplicate and share native ordering with shell and unrelated permissions", async (t) => {
  const evaluated: string[] = []
  const controller = new Controller(async (req) => { evaluated.push(req.id); return { safe: true, desc: req.permission } }, () => {})
  t.after(() => controller.dispose())
  const edit = request("a-edit", "root", "edit")
  controller.asked(edit); controller.asked(edit); controller.asked(request("b-shell"))
  await tick()
  assert.deepEqual(evaluated, ["a-edit", "b-shell"])
  assert.equal(visibleReview(controller.views, "root", getSession)?.assessment?.desc, "edit")
  controller.asked(request("0-read", "root", "read"))
  assert.equal(visibleReview(controller.views, "root", getSession), undefined)
  controller.replied("0-read"); controller.replied(edit.id)
  assert.equal(visibleReview(controller.views, "root", getSession)?.assessment?.desc, "bash")
})

for (const removal of ["reply", "delete", "dispose"] as const) {
  test(`edit ${removal} aborts and suppresses late analysis/identification`, async () => {
    let finish!: (assessment: Assessment) => void
    let identify!: () => void
    let signal!: AbortSignal
    const controller = new Controller((_, s, onIdentified) => {
      signal = s; identify = onIdentified
      return new Promise((resolve) => { finish = resolve })
    }, () => {})
    controller.asked(request("edit-request", "root", "edit"))
    await tick()
    if (removal === "reply") controller.replied("edit-request")
    else if (removal === "delete") controller.deleted("root")
    else controller.dispose()
    assert.ok(signal.aborted)
    identify(); finish(result)
    await tick()
    assert.deepEqual(controller.views, [])
    controller.dispose()
  })
}

test("disabled review types never evaluate but still block later native permissions", async (t) => {
  for (const reviewBash of [true, false]) for (const reviewEdits of [true, false]) for (const reviewExternalDirectories of [true, false]) {
    const evaluated: string[] = []
    const controller = new Controller(async (req, _, identified) => {
      evaluated.push(req.id); identified(); return result
    }, () => {}, { reviewBash, reviewEdits, reviewExternalDirectories })
    t.after(() => controller.dispose())
    const requests = [request("0-read", "root", "read"), request("1-directory", "root", "external_directory"), request("2-edit", "root", "edit"), request("3-bash")]
    controller.reconcile(requests, controller.revision)
    await tick()
    assert.deepEqual(evaluated, [ ...(reviewExternalDirectories ? ["1-directory"] : []), ...(reviewEdits ? ["2-edit"] : []), ...(reviewBash ? ["3-bash"] : []) ])
    assert.equal(visibleReview(controller.views, "root", getSession), undefined)
    controller.replied("0-read")
    assert.equal(visibleReview(controller.views, "root", getSession)?.request.id, reviewExternalDirectories ? "1-directory" : undefined)
    controller.replied("1-directory")
    assert.equal(visibleReview(controller.views, "root", getSession)?.request.id, reviewEdits ? "2-edit" : undefined)
    controller.replied("2-edit")
    assert.equal(visibleReview(controller.views, "root", getSession)?.request.id, reviewBash ? "3-bash" : undefined)
    const count = evaluated.length
    controller.reconcile([requests[3]!], controller.revision)
    await tick()
    assert.equal(evaluated.length, count)
  }
})

test("new review categories are opt-in in the production controller defaults", async () => {
  let calls = 0
  const controller = new CoreController(async () => { calls++; return result }, () => {})
  for (const permission of ["external_directory", "fixture_mcp", "custom-allowance", "read"]) controller.asked(request(permission, "root", permission))
  await tick()
  assert.equal(calls, 0)
  assert.ok(controller.views.every((view) => view.status === "unrelated"))
  controller.dispose()
})

test("native-like permission names remain hidden until origin and enablement are identified", async () => {
  let finish!: (value: Assessment | null) => void
  const controller = new CoreController(async () => new Promise((resolve) => { finish = resolve }), () => {})
  controller.asked(request("custom-bash", "root", "bash"))
  assert.equal(controller.views[0]?.status, "identifying")
  assert.equal(visibleReview(controller.views, "root", getSession), undefined)
  await tick()
  finish(null) // Classification discovers a disabled custom-tool permission.
  await tick()
  assert.equal(controller.views[0]?.status, "unrelated")
  assert.equal(visibleReview(controller.views, "root", getSession), undefined)
  controller.dispose()
})
