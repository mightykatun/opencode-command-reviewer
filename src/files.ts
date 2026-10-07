import path from "node:path"
import { fileAccess, type FileScope } from "./file-access.js"
import { reviewStage } from "./deadline.js"

/** Count distinct target files, including unavailable candidates, once per review. */
export class FileLimit {
  private files = new Map<string | symbol, boolean>()
  private paths = new Map<string, string>()
  constructor(private maxFiles: number, private scope?: FileScope) {}
  readonly limitations = new Set<string>()

  async consider(filename: string | null, signal: AbortSignal) {
    signal.throwIfAborted()
    let key: string | symbol = Symbol()
    if (filename !== null) {
      key = this.paths.get(filename) ?? await this.resolve(filename, signal)
      this.paths.set(filename, key)
    }
    signal.throwIfAborted()
    if (!this.files.has(key)) this.files.set(key, this.files.size < this.maxFiles)
    return { key, withinLimit: this.files.get(key)! }
  }

  private async resolve(filename: string, signal: AbortSignal) {
    const scope = this.scope ??= fileAccess.scope(signal)
    const result = await scope.canonical(filename)
    if (result.path) return result.path
    let reason = result.reason
    // Only missing files justify a parent lookup. Stalls/errors do not start more I/O.
    if (result.reason === "ENOENT") {
      const parent = await scope.canonical(path.dirname(filename))
      if (parent.path) return `${parent.path}/${path.basename(filename)}`
      reason = parent.reason
    }
    this.limitations.add(`Canonical path unavailable for ${JSON.stringify(filename)} (${reason}); unresolved aliases count separately.`)
    // Never collapse symlink-sensitive parent components.
    return filename.replace(/\/+/g, "/").replace(/\/(?:\.\/)+/g, "/").replace(/\/\.$/, "")
  }
}

export function omittedFile(filename: string | null): string {
  // JSON quoting keeps hostile/newline-bearing paths on one machine-readable line.
  return `[!] File ${JSON.stringify(filename)} not included in context.`
}

/** Shared optional counting work, separate from the included-diff byte allowance. */
export class DiffBudget {
  bytes: number
  lines: number
  ms: number
  exhausted = false
  constructor(limits = { bytes: 16 * 1024 * 1024, lines: 65536, ms: 250 }, readonly now = () => performance.now()) {
    this.bytes = limits.bytes; this.lines = limits.lines; this.ms = limits.ms
  }
  check(signal: AbortSignal, end: number) {
    reviewStage(signal, "Evidence collection")
    if (this.now() >= end) { this.exhausted = true; return false }
    return true
  }
}

/** Count only complete validated hunks, under one review's shared scan allowance. */
export function diffDelta(diff: unknown, signal: AbortSignal, budget = new DiffBudget()): { added: number; removed: number } | undefined {
  reviewStage(signal, "Evidence collection")
  if (typeof diff !== "string") return
  if (diff.length > budget.bytes || budget.ms <= 0) { budget.exhausted = true; return }
  const startTime = budget.now(), endTime = startTime + budget.ms
  try {
    // Length rejects oversized strings before any full UTF-8 measurement or copy.
    const bytes = Buffer.byteLength(diff)
    const available = budget.bytes
    budget.bytes = Math.max(0, available - bytes)
    if (bytes > available) { budget.exhausted = true; return }
    let old = 0, next = 0, added = 0, removed = 0, hunks = 0
    for (let start = 0; start < diff.length;) {
      if (!budget.check(signal, endTime)) return
      if (budget.lines <= 0) { budget.exhausted = true; return }
      budget.lines--
      const end = diff.indexOf("\n", start)
      const line = diff.slice(start, end < 0 ? diff.length : end).replace(/\r$/, "")
      start = end < 0 ? diff.length : end + 1
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/.exec(line)
      if (header) {
        if (old || next) return
        old = Number(header[1] ?? 1); next = Number(header[2] ?? 1)
        if (!Number.isSafeInteger(old) || !Number.isSafeInteger(next)) return
        hunks++
      } else if (line === "\\ No newline at end of file") continue
      else if (old || next) {
        if (line.startsWith("+")) { next--; added++ }
        else if (line.startsWith("-")) { old--; removed++ }
        else if (line.startsWith(" ")) { old--; next-- }
        else return
        if (old < 0 || next < 0) return
      } else if (hunks && line) return
    }
    if (budget.check(signal, endTime) && hunks && !old && !next) return { added, removed }
  } finally { budget.ms = Math.max(0, budget.ms - (budget.now() - startTime)) }
}
