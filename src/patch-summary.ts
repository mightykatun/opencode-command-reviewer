import { DeadlineError, remainingTime } from "./deadline.js"
import type { PatchOperation } from "./types.js"

const MAX_PATCH_BYTES = 16 * 1024 * 1024
const MAX_PATCH_LINES = 65536

/** Read only operation headers using the pinned host's marker/path semantics.
 * Never retain bodies, resolve paths, or apply hunks. Unsupported/oversized input
 * fails explicitly rather than publishing an incomplete operation list.
 */
export function patchOperations(input: Record<string, unknown>, signal: AbortSignal): PatchOperation[] {
  signal.throwIfAborted()
  const descriptor = Object.getOwnPropertyDescriptor(input, "patchText")
  const text: unknown = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined
  if (typeof text !== "string") throw new Error("Patch operation summary requires host-recorded patchText")
  if (text.length > MAX_PATCH_BYTES || Buffer.byteLength(text) > MAX_PATCH_BYTES) {
    throw new Error("Patch operation summary exceeds the 16 MiB scan limit")
  }
  const operations: PatchOperation[] = []
  let begun = false, ended = false, lines = 0
  let update: PatchOperation | undefined
  for (let start = 0; start < text.length;) {
    if (remainingTime(signal) <= 0) throw new DeadlineError("Patch operation summary")
    if (++lines > MAX_PATCH_LINES) throw new Error("Patch operation summary exceeds the 65,536-line scan limit")
    const end = text.indexOf("\n", start)
    const line = text.slice(start, end < 0 ? text.length : end)
    start = end < 0 ? text.length : end + 1
    // The host locates the first trimmed Begin/End markers, including within a
    // heredoc wrapper. Headers themselves must begin at column zero.
    if (line.trim() === "*** End Patch") { ended = true; break }
    if (!begun) { begun = line.trim() === "*** Begin Patch"; continue }
    if (update && line.startsWith("*** Move to:")) {
      const movePath = line.slice("*** Move to:".length).trim()
      if (movePath) { update.operation = "move"; update.movePath = movePath }
      update = undefined
      continue
    }
    update = undefined
    const kind = line.startsWith("*** Add File:") ? "add"
      : line.startsWith("*** Delete File:") ? "delete"
      : line.startsWith("*** Update File:") ? "update" : undefined
    if (!kind) continue
    const path = line.slice(line.indexOf(":") + 1).trim()
    if (!path) throw new Error("Patch operation summary contains an empty target path")
    if (operations.length >= 16384) throw new Error("Patch operation summary exceeds bounded JSON structure limits")
    const operation: PatchOperation = { operation: kind, path }
    operations.push(operation)
    if (kind === "update") update = operation
  }
  if (!begun || !ended || !operations.length) throw new Error("Patch operation summary requires a complete nonempty patch envelope")
  signal.throwIfAborted()
  return operations
}
