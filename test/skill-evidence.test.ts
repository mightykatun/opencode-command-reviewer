import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { mkdtemp, mkdir, writeFile, rm, open, realpath, symlink, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { collectSkillEvidence, skillReferences } from "../src/skill-evidence.js"
import { FileAccess } from "../src/file-access.js"
import { parseConfig } from "../src/config.js"
import { evaluateEvidence } from "../src/evaluate.js"
import { BUILTIN_PROMPTS } from "../src/prompts.js"
import type { SkillContext } from "../src/types.js"
import type { ContextReader } from "../src/context.js"
import type { AssistantMessage, Part, PermissionRequest } from "@opencode-ai/sdk/v2"

const signal = () => new AbortController().signal
const limits = { maxFiles: 6, maxEvidenceBytes: 131072 }
async function fixture(t: TestContext, content = "Read `scripts/check.py` and [context](docs/context.md#details).") {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-skill-")), base = path.join(directory, "skill")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(base, "scripts"), { recursive: true }); await mkdir(path.join(base, "docs"))
  await writeFile(path.join(base, "SKILL.md"), "DISK CONTENT CHANGED AFTER THE HOST LOADED THE SKILL")
  await writeFile(path.join(base, "scripts/check.py"), 'import hidden_dependency\nprint("REVIEW SOURCE ONLY")\n')
  await writeFile(path.join(base, "scripts/hidden_dependency.py"), "NOT DIRECTLY REFERENCED")
  await writeFile(path.join(base, "docs/context.md"), "Supporting context. See [nested](nested.md).")
  await writeFile(path.join(base, "docs/nested.md"), "DO NOT RECURSE")
  await writeFile(path.join(directory, "secret.txt"), "OUTSIDE CONTENT MUST NOT BE SENT")
  const context: SkillContext = { kind: "skill", tool: "skill", input: { name: "fixture" },
    skill: { name: "fixture", description: "Review fixture", location: path.join(base, "SKILL.md"), content },
    permission: { id: "permission", type: "skill", patterns: ["fixture"], always: ["fixture"], metadata: {}, tool: { messageID: "message", callID: "call" } },
    location: { instanceDirectory: directory, instanceWorktree: directory }, userPrompt: "Check the fixture", limitations: [] }
  return { directory, base, context }
}

test("skill evidence uses the exact host text and direct supporting files, never disk replacement or recursive imports", async t => {
  const f = await fixture(t), result = await collectSkillEvidence(f.context, limits, signal())
  assert.equal(result.skill.content, f.context.skill.content)
  assert.deepEqual(result.files.map(file => file.filename), ["scripts/check.py", "docs/context.md"])
  assert.ok(result.files.every(file => file.status === "captured"))
  assert.match(result.files[0]!.contents!, /REVIEW SOURCE ONLY/)
  assert.doesNotMatch(JSON.stringify(result), /DISK CONTENT CHANGED|DO NOT RECURSE|NOT DIRECTLY REFERENCED|OUTSIDE CONTENT/)
  assert.equal(result.partial, false)
})

test("literal discovery handles links, quoted command operands and paths with spaces without expanding URLs or shell expressions", () => {
  const result = skillReferences('Run `python "scripts/check tool.py"`. Then `./scripts/next.py --check`. Read "my notes.md" and `other notes.md` and [notes](<docs/my notes.md>#section). https://example.com/remote.py `$HOME/secret.txt` `scripts/*.py`', signal())
  assert.deepEqual(result.references, ["scripts/check tool.py", "./scripts/next.py", "my notes.md", "other notes.md", "docs/my notes.md"])
  assert.ok(result.limitations.some(line => line.includes("Dynamic")))
})

test("supporting files cannot escape by traversal, encoded links, absolute paths or symlinks", async t => {
  const f = await fixture(t)
  await symlink(path.join(f.directory, "secret.txt"), path.join(f.base, "leak.txt"))
  f.context.skill.content = `Read \`../secret.txt\`, [encoded](%2e%2e/secret.txt), \`${path.join(f.directory, "secret.txt")}\` and \`leak.txt\`.`
  let opened = 0
  const files = new FileAccess({ realpath, open: (async (...args: Parameters<typeof open>) => { opened++; return open(...args) }) as typeof open })
  const s = signal(), result = await collectSkillEvidence(f.context, limits, s, files.scope(s))
  assert.equal(opened, 0)
  assert.ok(result.files.length > 0 && result.files.every(file => file.contents === undefined))
  assert.equal(result.partial, true); assert.doesNotMatch(JSON.stringify(result), /OUTSIDE CONTENT/)
})

test("an ancestor symlink swapped after canonicalization cannot disclose an outside file through the opened descriptor", async t => {
  const f = await fixture(t, "Read `scripts/check.py`.")
  const outside = path.join(f.directory, "outside")
  await mkdir(outside); await writeFile(path.join(outside, "check.py"), "OUTSIDE SECRET")
  let reads = 0, closes = 0
  const files = new FileAccess({ realpath, open: (async (filename, flags) => {
    await rename(path.join(f.base, "scripts"), path.join(f.base, "original"))
    await symlink(outside, path.join(f.base, "scripts"))
    const handle = await open(filename, flags)
    return new Proxy(handle, { get(target, key) {
      if (key === "read") return (...args: any[]) => { reads++; return (target.read as any)(...args) }
      if (key === "close") return () => { closes++; return target.close() }
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value
    } })
  }) as typeof open })
  const s = signal(), result = await collectSkillEvidence(f.context, limits, s, files.scope(s))
  assert.equal(reads, 0); assert.equal(closes, 1)
  assert.match(result.files[0]!.status, /opened file is outside/)
  assert.equal(result.files[0]!.contents, undefined)
})

test("file and byte budgets include the main skill and omit whole optional files without truncating instructions", async t => {
  const f = await fixture(t)
  const noFiles = await collectSkillEvidence(f.context, { ...limits, maxFiles: 1 }, signal())
  assert.ok(noFiles.files.every(file => file.status === "file-count limit reached"))
  await writeFile(path.join(f.base, "scripts/check.py"), "x".repeat(5000))
  const small = await collectSkillEvidence(f.context, { ...limits, maxEvidenceBytes: 1500 }, signal())
  assert.equal(small.skill.content, f.context.skill.content)
  assert.equal(small.files[0]!.contents, undefined); assert.equal(small.files[1]!.status, "captured")
  await assert.rejects(collectSkillEvidence(f.context, { ...limits, maxEvidenceBytes: 10 }, signal()), /budget/)
})

test("builtin skills never substitute the working directory for a missing skill directory", async t => {
  const f = await fixture(t), s = signal()
  const files = new FileAccess({ open: async () => { throw Error("must not open") }, realpath: async () => { throw Error("must not probe") } })
  const result = await collectSkillEvidence({ ...f.context, skill: { ...f.context.skill, location: "<built-in>" } }, limits, s, files.scope(s))
  assert.equal(result.skill.content, f.context.skill.content)
  assert.ok(result.files.every(file => file.status === "local skill directory unavailable"))
})

test("parent cancellation closes an opened supporting file rather than becoming an optional omission", async t => {
  const f = await fixture(t), abort = new AbortController()
  let closed = false
  let finishClose!: () => void
  const cleanup = new Promise<void>(resolve => { finishClose = resolve })
  const files = new FileAccess({ realpath, open: (async (...args: Parameters<typeof open>) => {
    const handle = await open(...args), close = handle.close.bind(handle)
    handle.close = async () => { await close(); closed = true; finishClose() }
    abort.abort(new Error("stop skill review")); return handle
  }) as typeof open })
  await assert.rejects(collectSkillEvidence(f.context, limits, abort.signal, files.scope(abort.signal)), /stop skill review/)
  await cleanup; await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, true); assert.equal(files.outstanding, 0)
})

test("strict skill origin and default switch gate catalog reads; custom tools cannot acquire native skill semantics", async t => {
  const f = await fixture(t), cfg = parseConfig({ baseURL: "http://fixture/v1", model: "m" })
  const request: PermissionRequest = { id: "permission", sessionID: "root", permission: "skill", patterns: ["fixture"], always: ["fixture"], metadata: {}, tool: { messageID: "message", callID: "call" } }
  let tool = "skill", reads = 0, identified = 0
  let catalog = [f.context.skill]
  const reader: ContextReader = {
    session: async id => ({ id, projectID: "p", directory: f.directory } as any), projects: async () => [], messages: async () => [],
    message: async () => ({ info: { id: "message", sessionID: "root", role: "assistant", path: { cwd: f.directory, root: f.directory } } as AssistantMessage,
      parts: [{ id: "part", sessionID: "root", messageID: "message", type: "tool", callID: "call", tool, state: { status: "running", input: { name: "fixture" }, time: { start: 1 } } } as Part] }),
    toolIDs: async () => ["skill", "local"], skills: async () => { reads++; return catalog },
  }
  const run = (req = request, config = cfg) => evaluateEvidence(req, reader, config, config, "", signal(), () => identified++, new FileAccess())
  const result = await run(); assert.equal(result?.kind, "skill"); assert.equal(reads, 1); assert.equal(identified, 1)
  assert.equal(await run(request, { ...cfg, reviewSkills: false }), null); assert.equal(reads, 1)
  tool = "local"; assert.equal(await run(), null); assert.equal(reads, 1)
  assert.equal((await run(request, { ...cfg, reviewCustomTools: true }))?.kind, "custom"); assert.equal(reads, 1)
  tool = "skill"
  assert.equal(await run({ ...request, patterns: ["other"] }), null)
  assert.equal(await run({ ...request, always: ["*"] }), null)
  assert.equal(await run({ ...request, metadata: { arbitrary: true } }), null)
  catalog = []; await assert.rejects(run(), /unavailable or ambiguous/)
  catalog = [f.context.skill, f.context.skill]; await assert.rejects(run(), /unavailable or ambiguous/)
  assert.match(BUILTIN_PROMPTS.skill.instructions, /BOTH routine, bounded risk AND clear relevance/)
  assert.match(BUILTIN_PROMPTS.skill.instructions, /irrelevant skill is safe=false/)
})
