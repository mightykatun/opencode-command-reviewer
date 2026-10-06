import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, open, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { BUILTIN_PROMPTS, CONTRACT, correctionPrompt, loadPrompts } from "../src/prompts.js"
import { parseConfig } from "../src/config.js"

test("shell and edit prompts use their named files and share the separate fixed contract", async () => {
  for (const [kind, prefix] of [["shell", "PERMISSION"], ["edit", "EDIT"]] as const) {
    const assessment = (await readFile(new URL(`../prompts/${prefix}-REVIEW-PROMPT.md`, import.meta.url), "utf8")).trim()
    const correction = (await readFile(new URL(`../prompts/${prefix}-REVIEW-CORRECTION.md`, import.meta.url), "utf8")).trim()
    assert.equal(BUILTIN_PROMPTS[kind].instructions, assessment)
    assert.equal(BUILTIN_PROMPTS[kind].correction, correction)
    assert.match(correction, /\{\{validationError\}\}/)
    assert.ok(correctionPrompt("feedback $&", correction).includes("feedback $&"))
  }
  assert.equal(CONTRACT, (await readFile(new URL("../contracts/PERMISSION-REVIEW-CONTRACT.md", import.meta.url), "utf8")).trim())
  assert.match(CONTRACT, /proposed diffs/)
  assert.match(CONTRACT, /exactly two fields/)
  assert.match(BUILTIN_PROMPTS.edit.instructions, /partial=true/)
  assert.match(BUILTIN_PROMPTS.edit.instructions, /writing executable code.*running it now/)
})

test("instructions accepts only absolute directory paths, not former inline guidance", () => {
  const options = { baseURL: "http://localhost/v1", model: "m" }
  assert.equal(parseConfig(options).instructions, undefined)
  assert.equal(parseConfig({ ...options, instructions: " /custom/prompts " }).instructions, "/custom/prompts")
  for (const instructions of ["Custom risk guidance", "relative/path", "~/prompts", "/bad\u0000path", "", null, 42]) {
    assert.throws(() => parseConfig({ ...options, instructions }), /instructions/)
  }
})

test("prompt files override independently with immutable startup snapshots and per-file fallback", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const signal = new AbortController().signal
  assert.equal(await loadPrompts(undefined, signal), BUILTIN_PROMPTS)
  assert.deepEqual(await loadPrompts(dir, signal), BUILTIN_PROMPTS)
  await writeFile(path.join(dir, "EDIT-REVIEW-PROMPT.md"), " custom edit guidance \n")
  await writeFile(path.join(dir, "PERMISSION-REVIEW-CORRECTION.md"), "shell correction: {{validationError}}")
  await writeFile(path.join(dir, "README.md"), "unrelated files are not prompts")
  const first = await loadPrompts(dir, signal)
  assert.equal(first.edit.instructions, "custom edit guidance")
  assert.equal(first.edit.correction, BUILTIN_PROMPTS.edit.correction)
  assert.equal(first.shell.instructions, BUILTIN_PROMPTS.shell.instructions)
  assert.equal(correctionPrompt("feedback $&", first.shell.correction), "shell correction: feedback $&")
  await writeFile(path.join(dir, "EDIT-REVIEW-PROMPT.md"), "changed on disk")
  assert.equal(first.edit.instructions, "custom edit guidance")
  assert.equal((await loadPrompts(dir, signal)).edit.instructions, "changed on disk")
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.edit))
  assert.notEqual(BUILTIN_PROMPTS.edit.instructions, first.edit.instructions)
})

test("all four named files load and correction substitutions preserve literal feedback", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const prefix of ["PERMISSION", "EDIT"]) {
    await writeFile(path.join(dir, `${prefix}-REVIEW-PROMPT.md`), `${prefix} custom guidance`)
    await writeFile(path.join(dir, `${prefix}-REVIEW-CORRECTION.md`), `${prefix} {{validationError}} / {{validationError}}`)
  }
  const prompts = await loadPrompts(dir, new AbortController().signal)
  assert.equal(prompts.shell.instructions, "PERMISSION custom guidance")
  assert.equal(prompts.edit.instructions, "EDIT custom guidance")
  assert.equal(correctionPrompt("$&", prompts.edit.correction), "EDIT $& / $&")
})

test("supplied invalid prompt files fail rather than falling back or leaking file contents", async (t) => {
  for (const scenario of ["blank", "binary", "utf8", "oversized", "directory", "dangling", "fifo", "placeholder", "contract"]) {
    await t.test(scenario, async (t) => {
      const dir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
      t.after(() => rm(dir, { recursive: true, force: true }))
      const name = scenario === "placeholder" ? "EDIT-REVIEW-CORRECTION.md" : scenario === "contract" ? "PERMISSION-REVIEW-CONTRACT.md" : "EDIT-REVIEW-PROMPT.md"
      const file = path.join(dir, name)
      if (scenario === "directory") await mkdir(file)
      else if (scenario === "dangling") await symlink(path.join(dir, "missing"), file)
      else if (scenario === "fifo") execFileSync("mkfifo", [file])
      else await writeFile(file, scenario === "blank" ? " \n" : scenario === "binary" ? "\u0000secret" : scenario === "utf8" ? Buffer.from([0xff]) : scenario === "oversized" ? "x".repeat(65537) : "secret-invalid-template")
      await assert.rejects(loadPrompts(dir, new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, scenario === "contract" ? /Contract prompt overrides/ : /Invalid prompt file/)
        assert.ok(!error.message.includes("secret-invalid-template"))
        return true
      })
    })
  }
})

test("invalid directories and cancelled prompt loads fail explicitly", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, "plain")
  await writeFile(file, "not a directory")
  for (const value of [file, path.join(dir, "missing")]) await assert.rejects(loadPrompts(value, new AbortController().signal), /Prompt directory is unavailable/)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(loadPrompts(dir, abort.signal), { name: "AbortError" })
})

test("prompt reads close handles on read failure and mid-read cancellation", async (t) => {
  for (const cancel of [false, true]) await t.test(cancel ? "abort" : "read error", async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const file = path.join(dir, "EDIT-REVIEW-PROMPT.md")
    await writeFile(file, "custom prompt")
    const probe = await open(file, "r")
    const prototype = Object.getPrototypeOf(probe)
    await probe.close()
    const abort = new AbortController()
    let handle: FileHandle | undefined
    t.mock.method(prototype, "read", function(this: FileHandle) {
      handle = this
      if (cancel) abort.abort()
      throw new Error("private filesystem diagnostic")
    })
    await assert.rejects(loadPrompts(dir, abort.signal), cancel ? { name: "AbortError" } : /Invalid prompt file/)
    assert.equal(handle?.fd, -1)
  })
})
