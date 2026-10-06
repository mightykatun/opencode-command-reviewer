import { constants, readFileSync } from "node:fs"
import { lstat, open, readdir } from "node:fs/promises"
import path from "node:path"

type PromptName = "PERMISSION-REVIEW-PROMPT" | "PERMISSION-REVIEW-CONTRACT" | "PERMISSION-REVIEW-CORRECTION" | "EDIT-REVIEW-PROMPT" | "EDIT-REVIEW-CORRECTION"

export type PromptSet = Readonly<Record<"shell" | "edit", Readonly<{ instructions: string; correction: string }>>>

// The build embeds these files; direct source tests read the same Markdown.
declare const __REVIEW_PROMPTS__: Record<PromptName, string> | undefined

function prompt(name: PromptName): string {
  if (typeof __REVIEW_PROMPTS__ !== "undefined") return __REVIEW_PROMPTS__[name]
  const directory = name === "PERMISSION-REVIEW-CONTRACT" ? "contracts" : "prompts"
  return readFileSync(new URL(`../${directory}/${name}.md`, import.meta.url), "utf8").trim()
}

export const BUILTIN_PROMPTS: PromptSet = Object.freeze({
  shell: Object.freeze({ instructions: prompt("PERMISSION-REVIEW-PROMPT"), correction: prompt("PERMISSION-REVIEW-CORRECTION") }),
  edit: Object.freeze({ instructions: prompt("EDIT-REVIEW-PROMPT"), correction: prompt("EDIT-REVIEW-CORRECTION") }),
})
export const CONTRACT = prompt("PERMISSION-REVIEW-CONTRACT")

export function correctionPrompt(validationError: string, template = BUILTIN_PROMPTS.shell.correction): string {
  return template.replaceAll("{{validationError}}", () => validationError)
}

/** One startup snapshot; absent named files inherit built-ins, invalid ones fail. */
export async function loadPrompts(directory: string | undefined, signal: AbortSignal): Promise<PromptSet> {
  signal.throwIfAborted()
  if (directory === undefined) return BUILTIN_PROMPTS
  if (!path.isAbsolute(directory) || directory.includes("\u0000")) throw new Error("instructions must be an absolute prompt-directory path")
  let entries: string[]
  try { entries = await readdir(directory) }
  catch { signal.throwIfAborted(); throw new Error("Prompt directory is unavailable or is not a directory") }
  if (entries.some((name) => name.endsWith("-CONTRACT.md"))) throw new Error("Contract prompt overrides are not allowed; contracts are fixed in the plugin")
  const result = { shell: { ...BUILTIN_PROMPTS.shell }, edit: { ...BUILTIN_PROMPTS.edit } }
  for (const [kind, prefix] of [["shell", "PERMISSION"], ["edit", "EDIT"]] as const) {
    for (const [field, suffix] of [["instructions", "PROMPT"], ["correction", "CORRECTION"]] as const) {
      signal.throwIfAborted()
      const name = `${prefix}-REVIEW-${suffix}.md`
      const filename = path.join(directory, name)
      // lstat distinguishes an absent override from a supplied dangling symlink.
      try { await lstat(filename) }
      catch (error) {
        signal.throwIfAborted()
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw new Error(`Cannot inspect prompt file ${name}`)
      }
      try {
        const handle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK)
        try {
          const before = await handle.stat()
          if (!before.isFile() || before.size > 65536) throw new Error("invalid prompt file")
          const bytes = Buffer.alloc(65537)
          let size = 0
          while (size < bytes.length) {
            signal.throwIfAborted()
            const read = await handle.read(bytes, size, bytes.length - size, size)
            if (!read.bytesRead) break
            size += read.bytesRead
          }
          if (size > 65536) throw new Error("prompt too large")
          const after = await handle.stat()
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("prompt changed during read")
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)).trim()
          if (!text || text.includes("\u0000")) throw new Error("empty or binary prompt")
          if (field === "correction" && !text.includes("{{validationError}}")) {
            throw new Error("missing correction placeholder")
          }
          result[kind][field] = text
        } finally { await handle.close() }
      } catch {
        signal.throwIfAborted()
        throw new Error(`Invalid prompt file ${name}: require readable, stable, nonempty regular UTF-8 text up to 64 KiB${field === "correction" ? " containing {{validationError}}" : ""}`)
      }
    }
  }
  signal.throwIfAborted()
  return Object.freeze({ shell: Object.freeze(result.shell), edit: Object.freeze(result.edit) })
}
