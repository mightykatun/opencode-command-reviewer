import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import type { Config } from "./config.js"
import { candidateEnabled, classify, enabledKind, type ReviewOptions } from "./classification.js"
import { loadContext, loadEditContext, loadConversationContext, loadInvocation, permissionContext, type ContextReader } from "./context.js"
import { collectEvidence, collectEditEvidence } from "./evidence.js"
import { collectDirectoryEvidence, collectToolEvidence } from "./tool-evidence.js"
import { FileAccess } from "./file-access.js"
import { remainingTime, reviewStage, withDeadline } from "./deadline.js"
import type { ReviewEvidence, ToolDefinition } from "./types.js"

/** One verified tool snapshot is reused by context and evidence, never re-associated by name. */
export async function evaluateEvidence(request: PermissionRequest, reader: ContextReader, options: ReviewOptions,
  config: Config | undefined, configError: string, signal: AbortSignal, onIdentified: () => void,
  files: FileAccess): Promise<ReviewEvidence | null> {
  if (!candidateEnabled(request, options)) return null
  reviewStage(signal, "Permission context lookup")
  const invocation = await loadInvocation(request, reader, signal)
  let ids: readonly string[] | undefined
  try {
    ids = await withDeadline(signal, Math.min(1500, remainingTime(signal) / 4), async (s) => {
      const value = await reader.toolIDs?.(s)
      if (!value || value.length > 16384 || !value.every((id) => typeof id === "string")) throw new Error("Tool registry unavailable")
      return value
    }, "Tool registry lookup")
  } catch { signal.throwIfAborted() }
  const classified = classify(request, invocation, ids, reader.mcpServers?.() ?? [])
  if (!classified) return null
  if (!enabledKind(classified.kind, options)) return null
  onIdentified()
  if (!config) throw new Error(configError || "Invalid configuration")
  const scope = files.scope(signal)
  if (classified.kind === "shell") {
    const context = await loadContext(request, reader, signal, scope, invocation)
    if (!context) throw new Error("Native shell context unavailable")
    reviewStage(signal, "Evidence collection")
    return collectEvidence(context, config, signal, scope)
  }
  if (classified.kind === "edit") {
    const context = await loadEditContext(request, reader, signal, invocation)
    reviewStage(signal, "Evidence collection")
    return collectEditEvidence(context, config, signal, scope)
  }
  const conversation = await loadConversationContext(request, reader, signal)
  if (!invocation.location.instanceDirectory) conversation.limitations.push("Invocation directory unavailable; session origin is not substituted.")
  if (!invocation.location.instanceWorktree) conversation.limitations.push("Invocation worktree unavailable.")
  // New variable payloads are copied only by the bounded collector, not by an
  // earlier unrestricted structuredClone of permission metadata or scope arrays.
  const common = { ...conversation, tool: invocation.tool, input: invocation.input, permission: permissionContext(request, false), location: invocation.location }
  if (classified.kind === "external-directory") {
    if (!ids) common.limitations.push("Tool registry unavailable; operation origin is not verified as native.")
    return collectDirectoryEvidence({ ...common, kind: "external-directory", native: classified.native }, config, signal)
  }
  let definition: ToolDefinition | undefined
  if (classified.kind === "custom") {
    try {
      definition = await withDeadline(signal, Math.min(1000, remainingTime(signal) / 4),
        (s) => reader.definition?.(invocation.info, invocation.tool, s) ?? Promise.resolve(undefined), "Tool definition lookup")
      if (definition?.id !== invocation.tool) definition = undefined
    } catch { signal.throwIfAborted() }
  }
  return collectToolEvidence({ ...common, kind: classified.kind, definition,
    origin: { source: classified.kind === "mcp" ? "host MCP routing" : "host registry", server: classified.server } }, config, signal)
}
