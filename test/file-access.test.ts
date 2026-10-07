import { test } from "node:test"
import assert from "node:assert/strict"
import { setTimeout as sleep } from "node:timers/promises"
import { mkdtemp, symlink, rm } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import type { FileHandle } from "node:fs/promises"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2"
import { FileAccess, type FileIO } from "../src/file-access.js"
import { withDeadline, reviewStage } from "../src/deadline.js"
import { collectEvidence, collectEditEvidence, discover } from "../src/evidence.js"
import { loadConversationContext, type ContextReader } from "../src/context.js"
import { evaluateEvidence } from "../src/evaluate.js"
import { parseConfig } from "../src/config.js"
import type { EditContext } from "../src/types.js"

const timing = { totalMs: 80, pathMs: 15, captureMs: 25, concurrency: 2 }
const limits = { maxFiles: 6, maxEvidenceBytes: 131072 }
const input = { command: "cat source", cwd: "/virtual", userPrompt: "Inspect source" }
const signal = () => new AbortController().signal
const stat = { isFile: () => true, size: 8, mtimeMs: 1, ctimeMs: 1 }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function settled(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await sleep(5)
  assert.ok(check(), "underlying operation and owned cleanup must settle")
}

function fakeIO(stage?: string) {
  const held = deferred<any>()
  const calls: string[] = []
  let reads = 0
  const handle = {
    stat: async () => { calls.push("stat"); return stage === "stat" ? held.promise : stat },
    read: async (buffer: Buffer) => {
      calls.push("read")
      if (stage === "read") return held.promise
      buffer.write("fixture\n")
      return { bytesRead: reads++ ? 0 : 8 }
    },
    close: async () => { calls.push("close"); if (stage === "close") await held.promise },
  } as unknown as FileHandle
  const io: FileIO = {
    realpath: async (filename) => { calls.push("realpath"); return stage === "realpath" ? held.promise : filename },
    open: async () => { calls.push("open"); return stage === "open" ? held.promise : handle },
  }
  const release = () => held.resolve(stage === "realpath" ? "/virtual/source" : stage === "open" ? handle : stage === "stat" ? stat : { bytesRead: 0 })
  return { io, calls, release }
}

for (const stage of ["realpath", "open", "stat", "read", "close"]) {
  test(`stalled ${stage} becomes an omission before the overall deadline; late completion is owned`, async () => {
    const fixture = fakeIO(stage)
    const access = new FileAccess(fixture.io, timing)
    const start = performance.now()
    const result = await withDeadline(signal(), 1000, (s) => collectEvidence(input, limits, s, access.scope(s)))
    assert.ok(performance.now() - start < 800)
    assert.match(result.files[0]!.status, /timed out/)
    assert.equal(result.files[0]!.contents, undefined)
    assert.match(result.files[0]!.warning!, /not included/)
    assert.equal(access.outstanding, 1, "timeout must not release a still-running probe slot")
    const before = JSON.stringify(result)
    fixture.release()
    await settled(() => access.outstanding === 0)
    assert.equal(JSON.stringify(result), before, "late results must not mutate the published evidence")
    assert.equal(fixture.calls.filter((call) => call === "close").length, stage === "realpath" ? 0 : 1)
    if (stage === "open") assert.deepEqual(fixture.calls, ["realpath", "open", "close"])
  })
}

test("probe saturation bounds abandoned work across reviews and recovers after settlement", async () => {
  const fixture = fakeIO("realpath")
  const access = new FileAccess(fixture.io, timing)
  for (let i = 0; i < 2; i++) { const s = signal(); await collectEvidence(input, limits, s, access.scope(s)) }
  assert.equal(access.outstanding, 2)
  for (let i = 0; i < 10; i++) {
    const s = signal()
    const result = await collectEvidence(input, limits, s, access.scope(s))
    assert.match(result.files[0]!.status, /probes busy/)
  }
  assert.deepEqual(fixture.calls, ["realpath", "realpath"])
  fixture.release()
  await settled(() => access.outstanding === 0)
  const s = signal()
  const result = await collectEvidence(input, limits, s, access.scope(s))
  assert.equal(result.files[0]!.contents, "fixture\n")
})

test("shared budget limits long candidate lists and avoids repeated canonicalization", async () => {
  const calls: string[] = []
  const access = new FileAccess({ ...fakeIO().io, realpath: async (name) => { calls.push(name); await sleep(20); return name } }, { ...timing, totalMs: 35, pathMs: 30 })
  const s = signal()
  const result = await collectEvidence({ ...input, command: `cat source source ${Array.from({ length: 30 }, (_, i) => `file${i}`).join(" ")}` }, limits, s, access.scope(s))
  assert.ok(calls.length <= 2, `expired optional budget must not launch further I/O: ${JSON.stringify(calls)}`)
  assert.equal(calls.filter((name) => name === "/virtual/source").length, 1)
  assert.equal(result.files.length, 31)
  assert.ok(result.files.every((file) => file.contents === undefined))
  await settled(() => access.outstanding === 0)
})

test("complete edit diffs survive stalled canonicalization with conservative alias accounting", async () => {
  const fixture = fakeIO("realpath")
  const access = new FileAccess(fixture.io, timing)
  const diff = "@@ -1 +1 @@\n-before\n+after\n"
  const context: EditContext = { kind: "edit", tool: "apply_patch", userPrompt: "Update", limitations: [],
    location: { instanceDirectory: "/virtual", instanceWorktree: "/virtual" },
    permission: { id: "p", type: "edit", patterns: ["*"], always: ["*"], tool: null,
      metadata: { files: ["source", "source", "alias", "other"].map((name) => ({ filePath: `/virtual/${name}`, type: "update", patch: diff })) } } }
  const s = signal()
  const result = await collectEditEvidence(context, { ...limits, maxFiles: 2 }, s, access.scope(s))
  assert.deepEqual(result.changes.map((change) => change.status), ["included", "included", "included", "omitted"])
  assert.equal(result.changes[0]!.diff, diff)
  assert.match(result.limitations.join(" "), /timed out.*aliases count separately/)
  assert.ok(!fixture.calls.includes("open"))
  fixture.release()
  await settled(() => access.outstanding === 0)
})

test("parent cancellation rejects the review and a late open still closes its handle", async () => {
  const fixture = fakeIO("open")
  const access = new FileAccess(fixture.io, timing)
  const parent = new AbortController()
  const reason = new Error("native request resolved")
  const pending = collectEvidence(input, limits, parent.signal, access.scope(parent.signal))
  await settled(() => fixture.calls.includes("open"))
  parent.abort(reason)
  await assert.rejects(pending, (error) => error === reason)
  assert.equal(access.outstanding, 1)
  fixture.release()
  await settled(() => access.outstanding === 0)
  assert.deepEqual(fixture.calls, ["realpath", "open", "close"])
})

test("late I/O errors are consumed, exhausted probes never launch, and stage labels identify hard timeouts", async () => {
  const held = deferred<string>()
  const access = new FileAccess({ ...fakeIO().io, realpath: () => held.promise }, timing)
  const s = signal()
  await collectEvidence(input, limits, s, access.scope(s))
  held.reject(new Error("private late error"))
  await settled(() => access.outstanding === 0)
  let launched = false
  await assert.rejects(withDeadline(s, 0, async () => { launched = true }), /timed out/)
  assert.equal(launched, false)
  await assert.rejects(withDeadline(s, 10, async (child) => { reviewStage(child, "Permission context lookup"); return new Promise(() => {}) }), /Permission context lookup timed out/)
})

test("a busy event loop cannot turn an expired overall deadline into success or start a later phase", async () => {
  for (const nextPhase of [false, true]) {
    let advanced = false
    await assert.rejects(withDeadline(signal(), 20, async (s) => {
      reviewStage(s, "Evidence collection")
      const until = performance.now() + 40
      while (performance.now() < until) { /* Simulate synchronous evidence traversal. */ }
      if (nextPhase) { reviewStage(s, "Reviewer response"); advanced = true }
      return "late result"
    }), /Evidence collection timed out/)
    assert.equal(advanced, false)
  }
})

test("ordinary filesystem failures and special files remain factual omissions", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-special-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await symlink("absent", path.join(directory, "dangling"))
  execFileSync("mkfifo", [path.join(directory, "pipe")])
  for (const [name, expected] of [["missing", /ENOENT/], ["dangling", /ENOENT/], ["pipe", /not a regular file/]] as const) {
    const result = await collectEvidence({ ...input, cwd: directory, command: `cat ${name}` }, limits, signal())
    assert.match(result.files[0]!.status, expected)
  }
  const access = new FileAccess({ ...fakeIO().io, realpath: async () => { throw Object.assign(new Error("private error"), { code: "EACCES" }) } }, timing)
  const s = signal()
  const result = await collectEvidence(input, limits, s, access.scope(s))
  assert.match(result.files[0]!.status, /EACCES/)
  assert.doesNotMatch(JSON.stringify(result), /private error/)
  for (const command of ["ssh fixture 'cat /srv/remote.py'", "docker exec fixture python /srv/remote.py"]) {
    const discovered = discover(command, directory)
    assert.deepEqual(discovered.references, [])
    assert.match(discovered.limitations.join(" "), /Indirect execution/)
  }
})

test("stalled optional context leaves partial provenance and time for the reviewer", async () => {
  const late = deferred<Awaited<ReturnType<ContextReader["messages"]>>>()
  let aborted = false
  const reader: ContextReader = {
    message: async () => undefined, projects: async () => [],
    session: async (id) => ({ id, directory: "/virtual", projectID: "p" } as Session),
    messages: async (_, signal) => { signal.addEventListener("abort", () => { aborted = true }); return late.promise },
  }
  await withDeadline(signal(), 600, async (s) => {
    const result = await loadConversationContext({ id: "p", sessionID: "root", permission: "bash", patterns: [], always: [], metadata: {} }, reader, s)
    assert.equal(s.aborted, false)
    assert.equal(result.session.current?.directory, "/virtual")
    assert.equal(result.userPrompt, null)
    assert.match(result.limitations.join(" "), /Conversation context lookup timed out/)
    assert.equal(aborted, true)
    const before = JSON.stringify(result)
    late.resolve([])
    await sleep(0)
    assert.equal(JSON.stringify(result), before)
  })
})

for (const outcome of ["slow", "timeout", "cancel"] as const) {
  test(`${outcome} conversation lookup does not consume or start shell filesystem work`, async () => {
    const io = fakeIO()
    const access = new FileAccess(io.io, timing)
    const parent = new AbortController()
    const entered = deferred<void>()
    const history = deferred<Awaited<ReturnType<ContextReader["messages"]>>>()
    const request: PermissionRequest = { id: "p", sessionID: "root", permission: "bash", patterns: ["cat source"],
      always: [], metadata: {}, tool: { messageID: "m", callID: "c" } }
    const reader: ContextReader = {
      message: async () => ({ info: { id: "m", sessionID: "root", role: "assistant", parentID: "user", time: { created: 2 },
        providerID: "fixture", modelID: "fixture", mode: "build", agent: "build", path: { cwd: "/virtual", root: "/virtual" },
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        parts: [{ id: "part", type: "tool", tool: "bash", messageID: "m", sessionID: "root", callID: "c",
          state: { status: "running", input: { command: "cat source" }, time: { start: 1 } } }] }),
      toolIDs: async () => ["bash"],
      session: async id => ({ id, directory: "/origin", projectID: "p" } as Session),
      messages: async () => { entered.resolve(); return history.promise },
      projects: async () => [],
    }
    const config = parseConfig({ baseURL: "http://fixture.invalid/v1", model: "fixture" })
    const pending = withDeadline(parent.signal, 1500, s => evaluateEvidence(request, reader, config, config, "", s, () => {}, access))
    try {
      await entered.promise
      assert.deepEqual(io.calls, [], "conversation context precedes the first filesystem probe")
      if (outcome === "cancel") {
        parent.abort(new Error("native resolution"))
        await assert.rejects(pending, /native resolution/)
        assert.deepEqual(io.calls, [])
        return
      }
      if (outcome === "slow") {
        await sleep(timing.totalMs + 30)
        history.resolve([])
      }
      const evidence = await pending
      assert.ok(evidence?.kind === "shell")
      assert.equal(evidence.files[0]!.contents, "fixture\n")
      assert.equal(evidence.execution?.canonicalCwd, "/virtual")
      assert.equal(io.calls.filter(call => call === "open").length, 1)
      if (outcome === "timeout") assert.match(evidence.limitations.join(" "), /Conversation context lookup timed out/)
      const snapshot = JSON.stringify(evidence)
      history.resolve([])
      await sleep(0)
      assert.equal(JSON.stringify(evidence), snapshot)
    } finally {
      parent.abort()
      history.resolve([])
      await pending.catch(() => {})
    }
    assert.equal(access.outstanding, 0)
  })
}
