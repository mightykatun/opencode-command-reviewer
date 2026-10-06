import { test } from "node:test"
import assert from "node:assert/strict"
import type { AssistantMessage, Message, Part, PermissionRequest, Session } from "@opencode-ai/sdk/v2"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { latestUserPrompt, loadContext, loadRootMessages, type ContextReader } from "../src/context.js"
import { collectEvidence } from "../src/evidence.js"

function user(id: string, text: string, created: number, flags = {}): { info: Message; parts: Part[] } {
  return {
    info: { id, sessionID: "root", role: "user", time: { created }, agent: "build", model: { providerID: "test", modelID: "test" } },
    parts: [{ id: `p-${id}`, messageID: id, sessionID: "root", type: "text", text, ...flags }],
  }
}
const request: PermissionRequest = { id: "request", sessionID: "child", permission: "bash", patterns: ["python x.py"], always: [], metadata: {}, tool: { messageID: "tool-message", callID: "tool-call" } }
const session = (id: string, parentID?: string): Session => ({ id, parentID, directory: "/project", slug: id, projectID: "project", title: id, version: "1", time: { created: 1, updated: 1 } })
const tool: Part = { id: "tool-part", messageID: "tool-message", sessionID: "child", type: "tool", callID: "tool-call", tool: "bash", state: { status: "running", input: { command: "python x.py", workdir: "scripts" }, time: { start: 1 } } }
const assistant: AssistantMessage = {
  id: "tool-message", sessionID: "child", role: "assistant", parentID: "user", time: { created: 2 },
  providerID: "fixture", modelID: "fixture", mode: "build", agent: "build", path: { cwd: "/execution", root: "/execution" },
  cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const reader = (overrides: Partial<ContextReader> = {}): ContextReader => ({
  session: async (id) => session(id, id === "child" ? "root" : undefined),
  messages: async (id) => [user("u1", id === "root" ? "Actual user intent" : "Agent delegation", 1)],
  message: async () => ({ info: assistant, parts: [tool] }),
  projects: async () => [{ id: "project", worktree: "/project", name: "Initial repository", vcs: "git", sandboxes: [], time: { created: 1, updated: 1 } }],
  ...overrides,
})

test("SDK history adapter forwards opaque response cursors and preserves prompt barriers", async () => {
  const cursor = Buffer.from(JSON.stringify({ id: "opaque-message", time: 123 })).toString("base64url")
  for (const barrier of [false, true]) {
    const requests: URL[] = []
    const client = createOpencodeClient({ baseUrl: "http://fixture.invalid", fetch: async (request) => {
      const url = new URL(request instanceof Request ? request.url : request)
      requests.push(url)
      assert.equal(url.pathname, "/session/root/message")
      assert.equal(url.searchParams.get("directory"), "/project")
      assert.equal(url.searchParams.get("limit"), "100")
      if (requests.length === 1) {
        assert.equal(url.searchParams.get("before"), null)
        return Response.json(Array.from({ length: 100 }, (_, i) => user(`synthetic-${i}`, "skip", 100 + i, { synthetic: true })), { headers: { "X-Next-Cursor": cursor } })
      }
      assert.equal(url.searchParams.get("before"), cursor)
      const messages = [user("real", "older genuine ask", 1)]
      if (barrier) {
        const attachment = user("attachment", "", 2)
        attachment.parts = [{ id: "file", messageID: "attachment", sessionID: "root", type: "file", mime: "text/plain", url: "file:///fixture" }]
        messages.push(attachment)
      }
      return Response.json(messages, { headers: { "X-Next-Cursor": "must-not-follow" } })
    } })
    assert.equal(latestUserPrompt(await loadRootMessages(client, "root", "/project", new AbortController().signal)), barrier ? null : "older genuine ask")
    assert.equal(requests.length, 2)
  }
})

test("SDK history exhaustion, repeated cursors and page cap are bounded and distinguishable", async () => {
  for (const mode of ["exhausted", "repeated", "capped"] as const) {
    let calls = 0
    const client = createOpencodeClient({ baseUrl: "http://fixture.invalid", fetch: async () => {
      calls++
      return Response.json([user(`synthetic-${calls}`, "skip", calls, { synthetic: true })], {
        headers: mode === "exhausted" ? {} : { "X-Next-Cursor": mode === "repeated" ? "same" : `opaque-${calls}` },
      })
    } })
    const context = await loadContext(request, reader({ messages: (id, signal) => loadRootMessages(client, id, "/project", signal) }), new AbortController().signal)
    assert.equal(context?.userPrompt, null)
    assert.equal(calls, mode === "exhausted" ? 1 : mode === "repeated" ? 2 : 20)
    const diagnostic = context?.limitations.join(" ") ?? ""
    if (mode === "exhausted") assert.doesNotMatch(diagnostic, /history traversal incomplete/)
    else assert.match(diagnostic, mode === "repeated" ? /repeated pagination cursor/ : /20-page limit/)
  }
})

test("SDK history pagination stops on cancellation", async () => {
  const abort = new AbortController()
  let calls = 0
  const client = createOpencodeClient({ baseUrl: "http://fixture.invalid", fetch: async () => {
    calls++
    abort.abort(new Error("history cancelled"))
    return Response.json([], { headers: { "X-Next-Cursor": "never-follow" } })
  } })
  await assert.rejects(loadRootMessages(client, "root", "/project", abort.signal), /history cancelled/)
  assert.equal(calls, 1)
})

test("foreign message and part identities neither provide a root prompt nor stop pagination", async () => {
  const foreign = user("foreign", "foreign prompt", 3)
  foreign.info.sessionID = "other"
  foreign.parts[0]!.sessionID = "other"
  const wrongSession = user("wrong-session", "foreign part", 2)
  wrongSession.parts[0]!.sessionID = "other"
  const wrongMessage = user("wrong-message", "foreign part", 1)
  wrongMessage.parts[0]!.messageID = "other"
  const wrongFile = user("wrong-file", "", 4)
  wrongFile.parts = [{ id: "file", messageID: "other", sessionID: "root", type: "file", mime: "text/plain", url: "file:///fixture" }]
  const invalid = [foreign, wrongSession, wrongMessage, wrongFile]
  assert.equal(latestUserPrompt(invalid, "root"), null)
  const context = await loadContext(request, reader({ messages: async () => invalid }), new AbortController().signal)
  assert.equal(context?.userPrompt, null)
  let calls = 0
  const client = createOpencodeClient({ baseUrl: "http://fixture.invalid", fetch: async () => {
    calls++
    return calls === 1 ? Response.json(invalid, { headers: { "X-Next-Cursor": "older" } }) : Response.json([user("valid", "genuine root", 0)])
  } })
  assert.equal(latestUserPrompt(await loadRootMessages(client, "root", "/project", new AbortController().signal), "root"), "genuine root")
  assert.equal(calls, 2)
})

test("absent and malformed invocation paths remain partial context without session substitution", async () => {
  for (const invocation of [undefined, null, {}, { cwd: 123, root: false }, { cwd: "/execution", root: 123 }, { cwd: null, root: "/tree" }]) {
    const info = { ...assistant, path: invocation } as unknown as AssistantMessage
    const result = await loadContext(request, reader({ message: async () => ({ info, parts: [tool] }) }), new AbortController().signal)
    assert.ok(result)
    assert.equal(result.cwd, invocation?.cwd === "/execution" ? "/execution/scripts" : null)
    assert.equal(result.execution?.instanceWorktree, invocation?.root === "/tree" ? "/tree" : null)
    assert.equal(result.userPrompt, "Actual user intent")
    assert.notEqual(result.cwd, "/project")
  }
})

test("supplied non-string workdir stays unknown despite a valid invocation directory", async () => {
  for (const workdir of [null, false, 1, {}, []]) {
    const running: Part = { ...tool, state: { status: "running", input: { command: "pwd", workdir }, time: { start: 1 } } }
    const result = await loadContext(request, reader({ message: async () => ({ info: assistant, parts: [running] }) }), new AbortController().signal)
    assert.equal(result?.cwd, null)
    assert.equal(result?.execution?.canonicalCwd, null)
    assert.equal(result?.execution?.cwdSource, "unavailable")
    assert.equal(result?.execution?.instanceDirectory, "/execution")
    assert.ok(result?.limitations.some((text) => text.includes("tool.workdir is not a string")))
  }
})

test("latest genuine prompt excludes synthetic, ignored and attributed text", () => {
  assert.equal(latestUserPrompt([
    user("old", "old request", 1), user("latest", "current request", 2),
    user("synthetic", "Continue", 3, { synthetic: true }),
    user("ignored", "Ignore", 4, { ignored: true }),
    user("attributed", "Imported context", 5, { metadata: { source: "tool" } }),
  ]), "current request")
  assert.equal(latestUserPrompt([user("synthetic", "Continue", 1, { synthetic: true })]), null)
  assert.equal(latestUserPrompt([user("old", "outdated", 1), user("empty", "", 2)]), null)
  const attachment = user("file", "", 3)
  attachment.parts = [{ id: "file-part", messageID: "file", sessionID: "root", type: "file", mime: "text/plain", url: "file:///project/note.txt" }]
  assert.equal(latestUserPrompt([user("old", "outdated", 1), attachment]), null)
})

test("subagent command uses root user's prompt and child working directory", async () => {
  const result = await loadContext(request, reader(), new AbortController().signal)
  assert.ok(result)
  assert.equal(result.command, "python x.py")
  assert.equal(result.cwd, "/execution/scripts")
  assert.equal(result.execution?.requestedWorkdir, "scripts")
  assert.equal(result.execution?.instanceDirectory, "/execution")
  assert.equal(result.execution?.cwdSource, "tool.workdir relative to assistant.path.cwd")
  assert.equal(result.session?.current?.directory, "/project")
  assert.equal(result.session?.root?.id, "root")
  assert.equal(result.session?.rootProject?.worktree, "/project")
  assert.equal(result.userPrompt, "Actual user intent")
})

test("unavailable or cyclic parent context is explicit, never replaced by delegation", async () => {
  for (const r of [
    reader({ session: async (id) => id === "child" ? session(id, "missing") : undefined }),
    reader({ session: async (id) => session(id, id === "child" ? "root" : "child") }),
    reader({ messages: async () => { throw new Error("unavailable") } }),
  ]) assert.equal((await loadContext(request, r, new AbortController().signal))?.userPrompt, null)
})

test("does not associate unrelated tool calls or non-shell requests", async () => {
  await assert.rejects(loadContext({ ...request, tool: { messageID: "x", callID: "different" } }, reader(), new AbortController().signal), /message unavailable/)
  assert.equal(await loadContext({ ...request, permission: "edit" }, reader(), new AbortController().signal), null)
})

test("forwards exact directory permission scope, metadata and proposed always patterns", async () => {
  const external: PermissionRequest = { ...request, permission: "external_directory", patterns: ["/execution/*"], always: ["/execution/*"], metadata: { command: "python x.py", directories: ["/execution"], patterns: ["/execution/*"] } }
  const result = await loadContext(external, reader(), new AbortController().signal)
  assert.ok(result)
  assert.deepEqual(result.permission, { id: external.id, type: external.permission, patterns: external.patterns, always: external.always, metadata: external.metadata, tool: external.tool })
  assert.notEqual(result.permission!.metadata, external.metadata)
  const evidence = await collectEvidence(result, { maxFiles: 4, maxEvidenceBytes: 65536 }, new AbortController().signal)
  assert.deepEqual(evidence.permission, result.permission)
  assert.deepEqual(evidence.session, result.session)
  assert.deepEqual(evidence.execution, result.execution)
  assert.ok(evidence.limitations.includes(result.limitations[0]!))
})

test("external-directory requests from reads are not sent for shell review", async () => {
  const readPart: Part = { ...tool, tool: "read" }
  assert.equal(await loadContext({ ...request, permission: "external_directory" }, reader({ message: async () => ({ info: assistant, parts: [readPart] }) }), new AbortController().signal), null)
  assert.equal(await loadContext({ ...request, permission: "external_directory", tool: undefined }, reader(), new AbortController().signal), null)
})

test("distinguishes root repo, subagent directory, linked worktree and absolute command cwd", async () => {
  const running: Part = { ...tool, state: { status: "running", input: { command: "pwd", workdir: "/tmp" }, time: { start: 1 } } }
  const result = await loadContext(request, reader({
    session: async (id) => ({ ...session(id, id === "child" ? "root" : undefined), directory: id === "root" ? "/project/start" : "/linked/child", workspaceID: id === "child" ? "workspace-child" : undefined }),
    message: async () => ({ info: { ...assistant, path: { cwd: "/linked/child", root: "/linked" } }, parts: [running] }),
  }), new AbortController().signal)
  assert.ok(result)
  assert.equal(result.session?.root?.directory, "/project/start")
  assert.equal(result.session?.rootProject?.worktree, "/project")
  assert.equal(result.session?.current?.workspaceID, "workspace-child")
  assert.equal(result.execution?.instanceWorktree, "/linked")
  assert.equal(result.cwd, "/tmp")
  assert.equal(result.execution?.canonicalCwd, "/tmp")
  assert.equal(result.execution?.cwdSource, "absolute tool.workdir")
})

test("missing invocation path never masquerades as the session's starting directory", async () => {
  const result = await loadContext(request, reader({
    message: async () => ({ info: { ...assistant, path: { cwd: "relative-unknown", root: "relative-unknown" } }, parts: [tool] }),
    projects: async () => { throw new Error("offline") },
  }), new AbortController().signal)
  assert.ok(result)
  assert.equal(result.cwd, null)
  assert.equal(result.execution?.cwdSource, "unavailable")
  assert.equal(result.session?.root?.directory, "/project")
  assert.equal(result.session?.rootProject, null)
  assert.ok(result.limitations.some((text) => text.includes("not substituted")))
})

test("project metadata is matched by session project ID, never by the active project alone", async () => {
  const result = await loadContext(request, reader({ projects: async () => [{ id: "different", worktree: "/wrong", vcs: "git", sandboxes: [], time: { created: 1, updated: 1 } }] }), new AbortController().signal)
  assert.equal(result?.session?.rootProject, null)
  assert.ok(result?.limitations.some((text) => text.includes("Project metadata unavailable")))
})

test("non-repository projects retain absent VCS rather than claiming '/' is a Git root", async () => {
  const result = await loadContext(request, reader({
    session: async (id) => ({ ...session(id, id === "child" ? "root" : undefined), projectID: "global" }),
    projects: async () => [{ id: "global", worktree: "/", sandboxes: [], time: { created: 1, updated: 1 } }],
  }), new AbortController().signal)
  assert.deepEqual(result?.session?.rootProject, { id: "global", worktree: "/", vcs: null, name: null })
})

test("root and child project records are independently associated with their project IDs", async () => {
  const result = await loadContext(request, reader({
    session: async (id) => ({ ...session(id, id === "child" ? "root" : undefined), projectID: id === "root" ? "origin" : "execution" }),
    projects: async () => ["origin", "execution"].map((id) => ({ id, worktree: `/${id}`, vcs: "git", sandboxes: [], time: { created: 1, updated: 1 } })),
  }), new AbortController().signal)
  assert.equal(result?.session?.rootProject?.worktree, "/origin")
  assert.equal(result?.session?.currentProject?.worktree, "/execution")
})
