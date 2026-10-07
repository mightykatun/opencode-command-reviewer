import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { collectEvidence, collectEditEvidence, discover } from "../src/evidence.js"
import { diffDelta } from "../src/files.js"
import { parseConfig } from "../src/config.js"
import type { EditContext } from "../src/types.js"

const signal = () => new AbortController().signal
const diff = "--- before\n+++ after\n@@ -1,2 +1,3 @@\n-old-secret\n+new-secret\n+extra-secret\n retained\n"
const config = parseConfig({ baseURL: "http://localhost/v1", model: "fixture" })
const edit = (tool: EditContext["tool"], metadata: Record<string, unknown>): EditContext => ({
  kind: "edit", tool, userPrompt: "Update files", limitations: [],
  location: { instanceDirectory: "/project", instanceWorktree: "/project" },
  permission: { id: "edit", type: "edit", patterns: ["*"], always: ["*"], tool: null, metadata },
})

test("doubled byte default includes a formerly over-budget file; explicit old limits are retained", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-limit-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(`${dir}/data`, "x".repeat(70000))
  const input = { command: "cat data", cwd: dir, userPrompt: "Inspect data" }
  assert.equal((await collectEvidence(input, config, signal())).files[0]?.contents?.length, 70000)
  const explicit = parseConfig({ ...config, maxFiles: 4, maxEvidenceBytes: 65536 })
  assert.equal(explicit.maxFiles, 4)
  const omitted = (await collectEvidence(input, explicit, signal())).files[0]!
  assert.equal(omitted.contents, undefined)
  assert.equal(omitted.warning, `[!] File ${JSON.stringify(`${dir}/data`)} not included in context.`)
})

test("shell and patch share unique-file counting across aliases, missing files and duplicate changes", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-files-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(`${dir}/one`, "one")
  await writeFile(`${dir}/two`, "two")
  await symlink(`${dir}/one`, `${dir}/alias`)
  await symlink(dir, `${dir}/directory-alias`)
  const names = ["one", "alias", "./one", "missing", "directory-alias/missing", "two"]
  const limits = { ...config, maxFiles: 2 }
  const shell = await collectEvidence({ command: `cat ${names.join(" ")}`, cwd: dir, userPrompt: "Read" }, limits, signal())
  assert.equal(shell.files.length, 3)
  assert.equal(shell.files[0]?.contents, "one")
  assert.deepEqual(shell.files[0]?.aliases, [`${dir}/alias`, `${dir}/./one`])
  assert.match(shell.files[1]?.status ?? "", /ENOENT/)
  assert.match(shell.files[2]?.status ?? "", /file-count/)
  assert.ok(shell.files.slice(1).every((f) => f.warning && f.contents === undefined))
  const patch = await collectEditEvidence(edit("apply_patch", { files: names.map((name) => ({ filePath: `${dir}/${name}`, type: "update", patch: diff })) }), limits, signal())
  assert.deepEqual(patch.changes.map((c) => c.status), ["included", "included", "included", "included", "included", "omitted"])
  assert.match(patch.changes[5]?.reason ?? "", /file-count/)
  assert.equal(patch.changes[5]?.delta, `[Δ] ${JSON.stringify(`${dir}/two`)}: +2 −1 lines`)
})

test("six distinct candidates fit by default in shell and patch evidence, seventh has a compact warning", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-six-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = Array.from({ length: 7 }, (_, i) => `${dir}/${i}.txt`)
  await Promise.all(files.map((file) => writeFile(file, "text")))
  const shell = await collectEvidence({ command: `head -n 1 ${files.join(" ")}`, cwd: dir, userPrompt: "Inspect" }, config, signal())
  const patch = await collectEditEvidence(edit("apply_patch", { files: files.map((filePath) => ({ filePath, type: "update", patch: diff })) }), config, signal())
  assert.equal(shell.files.filter((f) => f.contents !== undefined).length, 6)
  assert.equal(patch.changes.filter((c) => c.status === "included").length, 6)
  assert.equal(shell.files[6]?.warning, patch.changes[6]?.warning)
  assert.equal(patch.changes[6]?.diff, undefined)
})

test("edit/write omissions report line counts without leaking diff text, including absent diffs with host counts", async () => {
  for (const tool of ["edit", "write"] as const) {
    for (const metadata of [{ diff }, { additions: 2, deletions: 1 }]) {
      const result = await collectEditEvidence(edit(tool, { filepath: '/project/a\n"b', ...metadata }), { ...config, maxEvidenceBytes: 1 }, signal())
      const change = result.changes[0]!
      assert.equal(change.warning, '[!] File "/project/a\\n\\\"b" not included in context.')
      assert.equal(change.delta, '[Δ] "/project/a\\n\\\"b": +2 −1 lines')
      assert.doesNotMatch(JSON.stringify(result), /secret/)
      assert.equal(change.diff, undefined)
    }
  }
  const unknown = await collectEditEvidence(edit("edit", { filepath: "/project/a", additions: -1, deletions: "2" }), config, signal())
  assert.equal(unknown.changes[0]?.delta, undefined)
  assert.ok(unknown.changes[0]?.warning)
})

test("unified diff counts distinguish headers, context, no-newline markers and multiple hunks", () => {
  assert.deepEqual(diffDelta(diff, signal()), { added: 2, removed: 1 })
  assert.deepEqual(diffDelta("--- a\n+++ b\n@@ -1 +1 @@\n--- text\n+++ text\n\\ No newline at end of file\n@@ -4,0 +5,1 @@\n+last", signal()), { added: 2, removed: 1 })
  assert.deepEqual(diffDelta("@@ -0,0 +1,2 @@\n+a\n+b\n", signal()), { added: 2, removed: 0 })
  assert.deepEqual(diffDelta("@@ -1,2 +0,0 @@\n-a\n-b\n", signal()), { added: 0, removed: 2 })
  for (const bad of [undefined, "", "+not-a-diff", "@@ -1 +1 @@\n-old\n", "@@ -1 +1 @@\n-old\n+new\n+extra", "@@ -1,999999999999999999 +0,0 @@\n-x"]) assert.equal(diffDelta(bad, signal()), undefined)
})

test("cat/head operands are literal and flags, stdin, expansions and unsupported options are not guessed", () => {
  for (const command of ["cat -n -- 'a file' b", "head -n 5 'a file' b", "head --bytes=10 'a file' b", "env -i cat 'a file' b", "/usr/bin/head -10 'a file' b"]) {
    assert.deepEqual(discover(command, "/p").references.map((r) => r.filename), ["a file", "b"], command)
  }
  assert.deepEqual(discover("cat -- -n", "/p").references.map((r) => r.filename), ["-n"])
  assert.deepEqual(discover("cat -", "/p").references, [])
  for (const command of ["head -n value decoy", "cat --unsupported decoy", "head -n $COUNT decoy", "cat $FILE", "cat *.txt", "cat $(touch sentinel)"]) {
    const result = discover(command, "/p")
    assert.deepEqual(result.references, [], command)
    assert.ok(result.limitations.length, command)
  }
})
