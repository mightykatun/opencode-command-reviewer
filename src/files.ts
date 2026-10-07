import path from "node:path"
import { fileAccess, type FileScope } from "./file-access.js"

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

/** Count only validated unified-diff hunks; headers and context are not changes. */
export function diffDelta(diff: unknown, signal: AbortSignal): { added: number; removed: number } | undefined {
  if (typeof diff !== "string") return
  let old = 0, next = 0, added = 0, removed = 0, hunks = 0
  for (let start = 0; start < diff.length;) {
    signal.throwIfAborted()
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
  if (hunks && !old && !next) return { added, removed }
}
