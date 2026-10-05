import { test } from "node:test"
import assert from "node:assert/strict"
import type { AssistantMessage, Message, Part, PermissionRequest, Session } from "@opencode-ai/sdk/v2"
import { latestUserPrompt, loadContext, type ContextReader } from "../src/context.js"
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
