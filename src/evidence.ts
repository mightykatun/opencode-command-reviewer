import path from "node:path"
import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { parse } from "shell-quote"
import type { EditChange, EditContext, EditEvidence, Evidence, FileEvidence, Limits } from "./types.js"

const VARIABLE = "\u0000UNRESOLVED_VARIABLE\u0000"
const python = /^python(?:[23](?:\.\d+)*)?$/
const shell = /^(?:ba|da|k|z)?sh$/
const assignment = /^[A-Za-z_][A-Za-z_0-9]*=/
interface Reference { filename: string; cwd: string | null; executable: boolean }

function balancedQuotes(command: string): boolean {
  let quote = ""
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "\\" && quote !== "'") {
      if (++i === command.length) return false
    } else if (quote && char === quote) quote = ""
    else if (!quote && (char === "'" || char === '"')) quote = char
  }
  return !quote
}

function unsupportedShellSyntax(command: string): string | undefined {
  let quote = ""
  let inWord = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "\\" && quote !== "'") { i++; inWord = true }
    else if (quote) { if (char === quote) quote = "" }
    else if (char === "'" || char === '"') { quote = char; inWord = true }
    else if (char === "#") {
      if (!inWord) return
      return "Unquoted # within a shell word is outside reliable tokenization; script targets were not resolved."
    } else if (char === "[" || char === "{" || char === "}") {
      return "Unquoted bracket glob or brace syntax is outside literal discovery; script targets were not resolved."
    } else inWord = !/[\s;&|()<>]/.test(char!)
  }
}

/** Literal discovery only. shell-quote is a tokenizer, not a shell evaluator. */
export function discover(command: string, cwd: string | null, depth = 0): {
  references: Reference[]; limitations: string[]
} {
  const references: Reference[] = []
  const limitations: string[] = []
  const note = (text: string) => { if (!limitations.includes(text)) limitations.push(text) }
  if (depth > 4 || command.includes("\u0000") || /[\r\n`]/.test(command)) {
    note("Script discovery unavailable for multiline commands, backticks, NULs, or deeply nested shell strings; inspect command text directly.")
    return { references, limitations }
  }
  if (!balancedQuotes(command)) {
    note("Shell quoting could not be resolved reliably; script contents were not collected.")
    return { references, limitations }
  }
  const unsupported = unsupportedShellSyntax(command)
  if (unsupported) {
    note(unsupported)
    return { references, limitations }
  }
  let tokens: ReturnType<typeof parse>
  try { tokens = parse(command, () => VARIABLE) } catch {
    note("Shell tokenization failed; script targets could not be resolved.")
    return { references, limitations }
  }
  // No claim to understand control flow, substitutions, heredocs or redirections.
  if (tokens.some((t) => typeof t !== "string" && "op" in t && !["&&", "||", ";", "|", "glob"].includes(t.op))) {
    note("Shell grouping, substitution, background execution or redirection prevents reliable script discovery; inspect command text directly.")
    return { references, limitations }
  }
  let currentCwd = cwd
  let words: string[] = []
  let uncertainWord = false
  let preceded = false
  let previousOperator: string | undefined
  let conditionalCwd = false
  let explicitCdpath = false
  const observeAssignment = (word: string) => {
    if (!word.startsWith("CDPATH=")) return
    explicitCdpath = true
    note("Explicit CDPATH assignment is not evaluated; directory-search targets may be unresolved.")
  }
  const literal = (s: string) => !s.includes(VARIABLE) && !s.startsWith("~")
  const qualifySnapshot = () => {
    if (preceded) note("Files are current filesystem snapshots; preceding command statements may change them before execution.")
  }
  const add = (filename: string, executable = false) => {
    if (!literal(filename) || uncertainWord) {
      note(`Script filename unresolved: ${filename.replaceAll(VARIABLE, "<variable>")}`)
      return
    }
    references.push({ filename, cwd: currentCwd, executable })
    qualifySnapshot()
  }
  const visit = (next?: string) => {
    const args = words
    words = []
    let builtins = true
    while (args[0] && assignment.test(args[0])) observeAssignment(args.shift()!)
    let wrappers = 0
    while (["env", "/usr/bin/env", "command", "exec"].includes(args[0] ?? "")) {
      if (wrappers++ >= 8) { note("Wrapper nesting exceeds literal discovery's eight-wrapper limit; source was not resolved."); return }
      const wrapper = args.shift()!
      if (wrapper === "env" || wrapper === "/usr/bin/env") {
        builtins = false
        while (args[0]?.startsWith("-")) {
          const option = args.shift()!
          if (option === "--") break
          if (option === "-i" || option === "--ignore-environment") continue
          if (option === "-u" || option === "--unset") {
            if (!args[0] || !literal(args[0]) || uncertainWord) {
              note("Missing or unresolved env option argument; invoked source was not resolved.")
              return
            }
            args.shift()
            continue
          }
          note("Unsupported env option; invoked script source could not be resolved.")
          return
        }
        // `--` ends env options, not its NAME=value operands.
        while (args[0] && assignment.test(args[0])) observeAssignment(args.shift()!)
      } else {
        if (!builtins) {
          note(`Unsupported wrapper composition: ${wrapper} after an external launcher is not assumed to be a shell builtin.`)
          return
        }
        if (wrapper === "exec") builtins = false
        if (args[0] === "--") args.shift()
        else if (args[0]?.startsWith("-")) {
          note(`Unsupported ${wrapper} option; invoked script source was not resolved.`)
          return
        }
      }
      if (!args[0]) { note(`No command operand after ${wrapper}; invoked script source was not resolved.`); return }
    }
    const executable = args.shift()
    if (!executable) return
    if (executable.startsWith("-")) { note("Wrapper options prevent script discovery."); return }
    const base = path.basename(executable)
    if (builtins && ["export", "readonly", "declare", "typeset"].includes(executable)) args.forEach(observeAssignment)
    if (builtins && ["pushd", "popd"].includes(executable)) {
      currentCwd = null
      note("Directory-stack operations are outside literal discovery; the working directory is unresolved.")
      return
    }
    if (builtins && executable === "cd") {
      if (args[0] === "--") args.shift()
      const target = args[0]
      const searchesCdpath = target && !path.isAbsolute(target) && !/^\.\.?(?:\/|$)/.test(target)
      if (previousOperator === "|" || next === "|") {
        currentCwd = null
        note("Pipeline directory changes do not establish a reliable cwd for later script targets.")
      } else if (args.length === 1 && target && !target.startsWith("-") && literal(target) && !uncertainWord
        && !(explicitCdpath && searchesCdpath) && next === "&&" && currentCwd) {
        currentCwd = path.resolve(currentCwd, target)
        conditionalCwd = true
      } else {
        currentCwd = null
        note("Working directory after cd is unresolved; relative script targets will not be guessed.")
      }
      return
    }
    if (["if", "then", "else", "fi", "for", "while", "until", "do", "done", "case", "function", "{"].includes(base)) {
      note("Shell control flow is outside literal discovery; script coverage is incomplete.")
      currentCwd = null
      return
    }
    if (!literal(executable)) {
      note("Executable name contains unresolved expansion; script coverage is incomplete.")
      return
    }
    if (python.test(base) || shell.test(base)) {
      const isPython = python.test(base)
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!
        if (arg === "--") {
          const operand = args[i + 1]
          if (!operand || (isPython && operand === "-")) note("Interpreter reads stdin; no separate script file was resolved.")
          else if (!isPython && operand === "-") note("Shell '-' operand after -- is outside supported script discovery.")
          else add(operand)
          return
        }
        if (!isPython && arg === "-") { note("Shell '-' invocation is outside supported script discovery."); return }
        if (arg === "-" || (!isPython && /^-[abefhiklmnptuvxBCEHPTs]*s[abefhiklmnptuvxBCEHPTs]*$/.test(arg))) {
          note("Interpreter reads stdin; no separate script file was resolved.")
          return
        }
        if ((isPython && arg === "-c") || (!isPython && /^-[abefhiklmnptuvxBCEHPT]*c$/.test(arg))) {
          if (!args[i + 1] || !literal(args[i + 1]!) || uncertainWord) note("Inline interpreter code contains unresolved expansion or is missing; its runtime contents are unavailable.")
          if (!isPython && args[i + 1] && literal(args[i + 1]!) && !uncertainWord) {
            const nested = discover(args[i + 1]!, explicitCdpath ? null : currentCwd, depth + 1)
            references.push(...nested.references)
            nested.limitations.forEach(note)
            if (nested.references.length) qualifySnapshot()
          }
          return
        }
        if (isPython && (arg === "-m" || arg.startsWith("-m") || arg.startsWith("-c"))) {
          if (!arg.startsWith("-c")) note("Python module execution: module source is not resolved by direct-script discovery.")
          return
        }
        if ((isPython && (arg === "-W" || arg === "-X")) || (!isPython && (arg === "-o" || arg === "+o"))) {
          if (!args[i + 1] || !literal(args[i + 1]!) || uncertainWord) {
            note(`Interpreter option ${arg} has a missing or unresolved argument; script source was not resolved.`)
            return
          }
          i++
          continue
        }
        if (arg.startsWith("-") || (!isPython && arg.startsWith("+"))) {
          const known = isPython ? /^-[bBdEIOPqRsSuv]+$/.test(arg) || /^-(W|X).+/.test(arg)
            : /^[-+][abefhiklmnptuvxBCEHPT]+$/.test(arg) || ["--noprofile", "--norc"].includes(arg)
          if (known) continue
          note(`Interpreter option ${arg} is outside supported script discovery.`)
          return
        }
        add(arg)
        return
      }
      return
    }
    if (builtins && (executable === "source" || executable === ".")) {
      if (args[0] === "--") args.shift()
      if (args[0]?.startsWith("-")) note("Unsupported sourcing option; source target was not resolved.")
      else if (args[0] && !args[0].includes("/")) note("Bare source operand uses PATH lookup; its file was not resolved.")
      else if (args[0]) add(args[0])
      currentCwd = null
      note("Sourced code may change the shell environment or working directory.")
      return
    }
    if (executable.includes("/")) add(executable, true)
    else if (/\.(py|sh|bash|zsh)$/.test(executable)) note(`Executable ${executable} uses PATH lookup; its file was not resolved.`)
    else if (["sudo", "su", "ssh", "docker", "podman", "eval", "xargs", "find", "npm", "npx", "make", "uv", "poetry"].includes(base)) {
      note(`Indirect execution through ${base}: invoked source is not automatically discovered.`)
    }
  }
  for (const token of tokens) {
    if (typeof token === "string") words.push(token)
    else if ("comment" in token) break
    else if ("op" in token && token.op === "glob" && "pattern" in token) { words.push(String(token.pattern)); uncertainWord = true }
    else if ("op" in token && typeof token.op === "string") {
      visit(token.op)
      previousOperator = token.op
      uncertainWord = false
      preceded = true
      if (token.op === "||") {
        currentCwd = null
        note("Conditional fallback makes the working directory uncertain for later statements.")
      } else if (token.op === ";" && conditionalCwd) {
        currentCwd = null
        conditionalCwd = false
        note("Earlier cd may fail or be skipped before this statement; the working directory is unresolved at the branch join.")
      }
    }
  }
  visit()
  return { references, limitations }
}

async function capture(reference: Reference, budget: number, signal: AbortSignal): Promise<FileEvidence> {
  const result: FileEvidence = { filename: reference.filename, status: "unavailable" }
  if (!reference.cwd && !path.isAbsolute(reference.filename)) return { ...result, status: "working directory unresolved; contents not provided" }
  // Do not normalize `..` before the filesystem traverses preceding symlinks.
  const filename = path.isAbsolute(reference.filename) ? reference.filename : `${reference.cwd}/${reference.filename}`
  result.path = filename
  signal.throwIfAborted()
  try {
    const canonical = await realpath(filename)
    signal.throwIfAborted()
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    try {
      const before = await handle.stat()
      if (!before.isFile()) return { ...result, status: "not a regular file; contents not provided" }
      if (before.size > budget) return { ...result, status: "file too large for remaining evidence budget; contents not provided; assess risk accordingly" }
      // Keep an overflow-probe byte even for empty or exact-budget files. Stat
      // size is only an initial estimate: short reads and growth still need EOF.
      let buffer = Buffer.alloc(before.size + 1)
      let size = 0
      while (size <= budget) {
        signal.throwIfAborted()
        if (size === buffer.length) {
          const larger = Buffer.alloc(Math.min(budget + 1, buffer.length * 2))
          buffer.copy(larger, 0, 0, size)
          buffer = larger
        }
        const read = await handle.read(buffer, size, buffer.length - size, size)
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      if (size > budget) return { ...result, status: "file grew beyond evidence budget; contents not provided" }
      const after = await handle.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        return { ...result, status: "file changed while being read; contents not provided" }
      }
      let contents: string
      // ignoreBOM disables BOM stripping, preserving both source bytes and shebang position.
      try { contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size)) }
      catch { return { ...result, status: "not valid UTF-8 source; contents not provided" } }
      if (contents.includes("\u0000")) return { ...result, status: "binary content; contents not provided" }
      // Direct executable paths qualify only if extension or shebang identifies Python/shell.
      if (reference.executable && !/\.(py|sh|bash|zsh|ksh)$/.test(filename) && !/^#![^\n]*(?:\bpython[\d.]*|\b(?:ba|da|k|z)?sh)\b/.test(contents)) {
        return { ...result, status: "direct executable is not identifiable as Python/shell source; contents not provided" }
      }
      return { ...result, status: "captured", contents }
    } finally { await handle.close() }
  } catch (error) {
    signal.throwIfAborted()
    const code = (error as NodeJS.ErrnoException).code
    return { ...result, status: `cannot read file (${code ?? "filesystem error"}); contents not provided` }
  }
}

export async function collectEvidence(
  input: Omit<Evidence, "files" | "limitations"> & { limitations?: string[] },
  limits: Limits,
  signal: AbortSignal,
): Promise<Evidence> {
  signal.throwIfAborted()
  const commandBytes = Buffer.byteLength(input.command)
  if (commandBytes > limits.maxEvidenceBytes) throw new Error("Command exceeds configured evidence budget")
  const discovery = discover(input.command, input.cwd)
  const evidence: Evidence = { ...input, files: [], limitations: [
    ...(input.limitations ?? []),
    "Only literal Python/shell source is collected. Files are snapshots taken during review. Imports, dependencies, other runtimes and calls inside source files are not recursively inspected.",
    ...discovery.limitations,
  ] }
  if (!input.userPrompt) evidence.limitations.push("User prompt unavailable.")
  let remaining = limits.maxEvidenceBytes - commandBytes
  const seen = new Set<string>()
  let count = 0
  for (const reference of discovery.references) {
    signal.throwIfAborted()
    const key = JSON.stringify(reference)
    if (seen.has(key)) continue
    seen.add(key)
    if (count++ >= limits.maxFiles) {
      evidence.files.push({ filename: reference.filename, status: "file-count limit reached; contents not provided; assess risk accordingly" })
      continue
    }
    const file = await capture(reference, remaining, signal)
    evidence.files.push(file)
    remaining -= Buffer.byteLength(file.contents ?? "")
  }
  signal.throwIfAborted()
  return evidence
}

/** Use host-computed diffs, never apply edits or duplicate unbounded tool input. */
export function collectEditEvidence(input: EditContext, limits: Limits, signal: AbortSignal): EditEvidence {
  signal.throwIfAborted()
  const { metadata, ...scope } = input.permission
  const limitations = [...input.limitations,
    "Proposed diffs come from the pending host permission, not from applying edits. Full files, dependencies and post-approval formatter changes are not inspected; host diffs may normalize whitespace or omit BOMs.",
  ]
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const patch = input.tool === "apply_patch"
  const files = patch ? Array.isArray(metadata.files) ? metadata.files : []
    : [{ filePath: metadata.filepath, patch: metadata.diff, type: input.tool }]
  if (!files.length) limitations.push("Per-file patch metadata unavailable; affected changes could not be enumerated.")
  let remaining = limits.maxEvidenceBytes
  const changes: EditChange[] = []
  for (let index = 0; index < files.length; index++) {
    signal.throwIfAborted()
    const file = record(files[index])
    const operation = typeof file.type === "string" && ["add", "update", "delete", "move", "edit", "write"].includes(file.type) ? file.type as EditChange["operation"] : "unknown"
    const change: EditChange = {
      path: typeof file.filePath === "string" && file.filePath.trim() ? file.filePath : null,
      operation, status: "omitted",
      ...(typeof file.movePath === "string" ? { movePath: file.movePath } : {}),
    }
    if (index >= limits.maxFiles) change.reason = "file-count limit reached"
    else if (!change.path || !path.isAbsolute(change.path)) change.reason = "absolute target path unavailable"
    else if (operation === "unknown" || (patch && (operation === "edit" || operation === "write"))) change.reason = "file operation unavailable or unsupported"
    else if (operation === "move" && (!change.movePath || !path.isAbsolute(change.movePath))) change.reason = "absolute move destination unavailable"
    else if (typeof file.patch !== "string" || !file.patch.trim()) change.reason = "proposed diff unavailable"
    else if (Buffer.byteLength(file.patch) > remaining) change.reason = "complete diff exceeds remaining evidence byte budget"
    else {
      change.status = "included"
      change.diff = file.patch
      remaining -= Buffer.byteLength(file.patch)
    }
    changes.push(change)
  }
  const partial = !changes.length || changes.some((change) => change.status === "omitted")
  if (partial) limitations.push("Edit evidence is incomplete. Omitted changes are not assessed by the supplied diffs; do not assume the whole proposal is safe.")
  if (!input.userPrompt) limitations.push("User prompt unavailable.")
  signal.throwIfAborted()
  return {
    kind: "edit", tool: input.tool, userPrompt: input.userPrompt, session: input.session,
    location: input.location, changes, partial, limitations,
    permission: { ...scope, metadataStatus: "Host change metadata normalized into changes; raw metadata and tool input are omitted to avoid duplicate or unbounded change text." },
  }
}
