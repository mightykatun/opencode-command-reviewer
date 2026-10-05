import path from "node:path"
import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { parse } from "shell-quote"
import type { Evidence, FileEvidence, Limits } from "./types.js"

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
  const literal = (s: string) => !s.includes(VARIABLE) && !s.startsWith("~")
  const add = (filename: string, executable = false) => {
    if (!literal(filename) || uncertainWord) {
      note(`Script filename unresolved: ${filename.replaceAll(VARIABLE, "<variable>")}`)
      return
    }
    references.push({ filename, cwd: currentCwd, executable })
    if (preceded) note("Files are current filesystem snapshots; preceding command statements may change them before execution.")
  }
  const visit = (next?: string) => {
    let args = [...words]
    words = []
    while (args[0] && assignment.test(args[0])) args.shift()
    if (args.at(0) === "env" || args.at(0) === "/usr/bin/env") {
      args = args.slice(1)
      while (args[0]) {
        if (assignment.test(args[0]) || args[0] === "-i" || args[0] === "--ignore-environment") args.shift()
        else if (args[0] === "-u" || args[0] === "--unset") { args.shift(); args.shift() }
        else if (args[0] === "--") { args.shift(); break }
        else break
      }
      if (args[0]?.startsWith("-")) {
        note("Unsupported env option; invoked script source could not be resolved.")
        return
      }
    }
    while (args.at(0) === "command" || args.at(0) === "exec") { args.shift(); if (args[0] === "--") args.shift() }
    const executable = args.shift()
    if (!executable) return
    if (executable.startsWith("-")) { note("Wrapper options prevent script discovery."); return }
    const base = path.basename(executable)
    if (base === "cd") {
      if (args[0] === "--") args.shift()
      const target = args[0]
      if (args.length === 1 && target && literal(target) && !uncertainWord && next === "&&" && currentCwd) {
        currentCwd = path.resolve(currentCwd, target)
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
        if (arg === "--") { if (args[i + 1]) add(args[i + 1]!); return }
        if (arg === "-" || (!isPython && /^-[a-zA-Z]*s[a-zA-Z]*$/.test(arg))) {
          note("Interpreter reads stdin; no separate script file was resolved.")
          return
        }
        if ((isPython && arg === "-c") || (!isPython && /^-[a-zA-Z]*c$/.test(arg))) {
          if (!args[i + 1] || !literal(args[i + 1]!)) note("Inline interpreter code contains unresolved expansion or is missing; its runtime contents are unavailable.")
          if (!isPython && args[i + 1] && literal(args[i + 1]!)) {
            const nested = discover(args[i + 1]!, currentCwd, depth + 1)
            references.push(...nested.references)
            nested.limitations.forEach(note)
          }
          return
        }
        if (isPython && (arg === "-m" || arg.startsWith("-m") || arg.startsWith("-c"))) {
          if (!arg.startsWith("-c")) note("Python module execution: module source is not resolved by direct-script discovery.")
          return
        }
        if (arg === "-W" || arg === "-X" || (!isPython && (arg === "-o" || arg === "+o"))) { i++; continue }
        if (arg.startsWith("-")) {
          const known = isPython ? /^-[bBdEIOPqRsSuv]+$/.test(arg) || /^-(W|X).+/.test(arg)
            : /^-[abefhiklmnptuvxBCEHPT]+$/.test(arg) || ["--noprofile", "--norc"].includes(arg)
          if (known) continue
          note(`Interpreter option ${arg} is outside supported script discovery.`)
          return
        }
        add(arg)
        return
      }
      return
    }
    if (base === "source" || executable === ".") {
      if (args[0]) add(args[0])
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
      uncertainWord = false
      preceded = true
      if (token.op === "||") {
        currentCwd = null
        note("Conditional fallback makes the working directory uncertain for later statements.")
      }
    }
  }
  visit()
  return { references, limitations }
}

async function capture(reference: Reference, budget: number, signal: AbortSignal): Promise<FileEvidence> {
  const result: FileEvidence = { filename: reference.filename, status: "unavailable" }
  if (!reference.cwd && !path.isAbsolute(reference.filename)) return { ...result, status: "working directory unresolved; contents not provided" }
  const filename = path.resolve(reference.cwd ?? "/", reference.filename)
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
      const buffer = Buffer.alloc(budget + 1)
      let size = 0
      while (size < buffer.length) {
        signal.throwIfAborted()
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
      try { contents = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)) }
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
