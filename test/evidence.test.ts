import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, symlink, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discover, collectEvidence } from "../src/evidence.js"

const limits = { maxFiles: 4, maxEvidenceBytes: 65536 }
const signal = () => new AbortController().signal

test("literal discovery: quoted paths, flags, wrappers, compounds and nested shell strings", () => {
  for (const command of [
    'python3 "fruit script.py"',
    'python3 -I -W ignore -X utf8 -- "fruit script.py"',
    'env -i LANG=C python3 "fruit script.py"',
    'command -- python3 "fruit script.py"',
    `bash -lc 'python3 "fruit script.py"'`,
  ]) {
    assert.deepEqual(discover(command, "/project").references.map((r) => r.filename), ["fruit script.py"], command)
  }
  const result = discover("cd scripts && python main.py; bash check.sh", "/project")
  assert.deepEqual(result.references.map((r) => [r.filename, r.cwd]), [["main.py", "/project/scripts"], ["check.sh", "/project/scripts"]])
  assert.equal(discover("python -c 'print(1)'", "/p").references.length, 0)
  assert.deepEqual(discover("bash -eu task.sh | python3 summarize.py", "/p").references.map((r) => r.filename), ["task.sh", "summarize.py"])
})

test("unresolved constructs are explicit and never resolve from the plugin environment", () => {
  for (const command of [
    "python $SECRET_SCRIPT", 'python "${SCRIPT:-fallback.py}"', "python *.py", "python ~/main.py",
    "python $(touch sentinel)", "python `touch sentinel`", "if true; then python a.py; fi",
    "python -m application", "uv run python main.py", "python script.py > out.txt",
    "python main.py\nbash other.sh", "python3 -Q main.py",
    "python 'unterminated.py", "env -C elsewhere python x.py", "exec -a newname python x.py",
  ]) assert.ok(discover(command, "/p").limitations.length, command)
  assert.equal(discover("cd sub; python main.py", "/p").references[0]?.cwd, null)
  assert.equal(discover("cd sub || python main.py", "/p").references[0]?.cwd, null)
  assert.equal(discover('python "$HOME/main.py"', "/p").references.length, 0)
  assert.equal(discover("python '$HOME/main.py'", "/p").references[0]?.filename, "$HOME/main.py")
})

test("captures real source snapshots including external files and symlinks", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "checker-evidence-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, "project"))
  await writeFile(path.join(dir, "external.py"), "print('pear')\n")
  await symlink(path.join(dir, "external.py"), path.join(dir, "project/link.py"))
  const result = await collectEvidence({ command: "python link.py; python ../external.py", cwd: path.join(dir, "project"), userPrompt: "Count fruit" }, limits, signal())
  assert.equal(result.files.length, 2)
  assert.ok(result.files.every((f) => f.contents === "print('pear')\n"))
  assert.equal(result.userPrompt, "Count fruit")
})

test("missing, oversized, binary, invalid UTF-8 and special files have factual placeholders", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "checker-evidence-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, "big.py"), "x".repeat(200))
  await writeFile(path.join(dir, "binary.py"), Buffer.from([0, 1, 2]))
  await writeFile(path.join(dir, "invalid.py"), Buffer.from([255, 254]))
  for (const [filename, expected] of [
    ["missing.py", /ENOENT/], ["big.py", /too large/], ["binary.py", /binary/], ["invalid.py", /UTF-8/], [".", /regular file/],
  ] as const) {
    const result = await collectEvidence({ command: `python ${filename}`, cwd: dir, userPrompt: null }, { ...limits, maxEvidenceBytes: 100 }, signal())
    assert.match(result.files[0]!.status, expected)
    assert.equal(result.files[0]!.contents, undefined)
    assert.ok(result.limitations.includes("User prompt unavailable."))
  }
})

test("total UTF-8 budget, file-count limit, deduplication and command-size failure", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "checker-evidence-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, "a.py"), "é".repeat(15))
  await writeFile(path.join(dir, "b.py"), "x".repeat(30))
  const input = { command: "python a.py; python b.py; python a.py", cwd: dir, userPrompt: "Read" }
  const result = await collectEvidence(input, { maxFiles: 1, maxEvidenceBytes: 70 }, signal())
  assert.equal(result.files.length, 2)
  assert.equal(Buffer.byteLength(result.files[0]!.contents!), 30)
  assert.match(result.files[1]!.status, /file-count/)
  const second = await collectEvidence(input, { maxFiles: 4, maxEvidenceBytes: 70 }, signal())
  assert.match(second.files[1]!.status, /too large/)
  await assert.rejects(collectEvidence(input, { ...limits, maxEvidenceBytes: 3 }, signal()), /Command exceeds/)
})

test("direct extensionless Python/shell shebangs and extensionless interpreter operands", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "checker-evidence-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, "run"), "#!/usr/bin/env python3\nprint('apple')")
  await writeFile(path.join(dir, "other"), "print('apple')")
  const result = await collectEvidence({ command: "./run; python other", cwd: dir, userPrompt: null }, limits, signal())
  assert.ok(result.files.every((f) => f.contents?.includes("apple")))
  await writeFile(path.join(dir, "task.sh"), "#!/bin/sh\nprintf pear\n")
  const shell = await collectEvidence({ command: "bash task.sh; ./task.sh", cwd: dir, userPrompt: null }, limits, signal())
  assert.ok(shell.files.every((f) => f.contents === "#!/bin/sh\nprintf pear\n"))
})

test("does not execute discovery payloads and respects pre-aborted work", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "checker-evidence-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const marker = path.join(dir, "executed")
  await collectEvidence({ command: `python $(touch ${marker})`, cwd: dir, userPrompt: null }, limits, signal())
  await assert.rejects(access(marker))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(collectEvidence({ command: "python x.py", cwd: dir, userPrompt: null }, limits, controller.signal), { name: "AbortError" })
})
