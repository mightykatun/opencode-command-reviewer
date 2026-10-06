import path from "node:path"
import { realpath } from "node:fs/promises"
import type { Message, OpencodeClient, Part, PermissionRequest, Project, Session } from "@opencode-ai/sdk/v2"
import type { EditContext, Evidence, ProjectLocation, SessionLocation } from "./types.js"

export interface ContextReader {
  session(id: string, signal: AbortSignal): Promise<Session | undefined>
  messages(id: string, signal: AbortSignal): Promise<readonly { info: Message; parts: Part[] }[]>
  message(sessionID: string, messageID: string, signal: AbortSignal): Promise<{ info: Message; parts: Part[] } | undefined>
  projects(signal: AbortSignal): Promise<readonly Project[]>
}

type CommandContext = Omit<Evidence, "files">

class HistoryIncompleteError extends Error {}

export async function loadRootMessages(client: OpencodeClient, sessionID: string, directory: string, signal: AbortSignal) {
  // Each page is chronological; the opaque response cursor traverses older pages.
  let before: string | undefined
  const seen = new Set<string>()
  for (let page = 0; page < 20; page++) {
    signal.throwIfAborted()
    const result = await client.session.messages({ sessionID, directory, limit: 100, before }, { signal })
    signal.throwIfAborted()
    if (!result.data) throw new Error("Root messages unavailable")
    if (findUserPrompt(result.data, sessionID)) return result.data
    const next = result.response.headers.get("x-next-cursor")
    if (!next) return result.data
    if (seen.has(next)) throw new HistoryIncompleteError("Root-user history traversal incomplete: repeated pagination cursor.")
    seen.add(next)
    before = next
  }
  throw new HistoryIncompleteError("Root-user history traversal incomplete: 20-page limit reached.")
}

/** Filter synthetic and attributed text using the public part metadata. */
export function findUserPrompt(messages: readonly { info: Message; parts: Part[] }[], sessionID?: string): { text: string | null } | undefined {
  const ordered = messages.filter((m) => m.info.role === "user" && (sessionID === undefined || m.info.sessionID === sessionID)).toSorted((a, b) => b.info.time.created - a.info.time.created || (a.info.id < b.info.id ? 1 : a.info.id > b.info.id ? -1 : 0))
  for (const message of ordered) {
    const owned = message.parts.filter((p) => p.sessionID === message.info.sessionID && p.messageID === message.info.id)
    const parts = owned.filter((p) => p.type === "text" && !p.synthetic && !p.ignored && !p.metadata?.source)
    if (parts.length) return { text: parts.map((p) => p.type === "text" ? p.text : "").join("\n").trim() || null }
    // A newer attachment-only user message must not be replaced by an older ask.
    if (owned.some((p) => p.type === "file")) return { text: null }
  }
}

export function latestUserPrompt(messages: readonly { info: Message; parts: Part[] }[], sessionID?: string): string | null {
  return findUserPrompt(messages, sessionID)?.text ?? null
}

export async function loadContext(request: PermissionRequest, reader: ContextReader, signal: AbortSignal): Promise<CommandContext | null> {
  if (request.permission !== "bash" && request.permission !== "external_directory") return null
  if (!request.tool) {
    if (request.permission === "external_directory") return null
    throw new Error("Native shell tool context unavailable")
  }
  const message = await reader.message(request.sessionID, request.tool.messageID, signal)
  if (!message || message.info.sessionID !== request.sessionID || message.info.id !== request.tool.messageID) {
    throw new Error("Pending native shell message unavailable")
  }
  const part = message?.parts.find((p) => p.type === "tool" && p.callID === request.tool!.callID)
  if (part?.type === "tool" && part.tool !== "bash" && request.permission === "external_directory") return null
  if (!part || part.type !== "tool" || part.sessionID !== request.sessionID || part.messageID !== request.tool.messageID || part.tool !== "bash" || part.state.status !== "running") {
    throw new Error("Pending native shell arguments unavailable")
  }
  const { command, workdir } = part.state.input
  if (typeof command !== "string" || !command.trim()) throw new Error("Shell command unavailable")
  const limitations: string[] = []
  const invocation = message.info.role === "assistant" ? message.info.path : undefined
  const instanceDirectory = typeof invocation?.cwd === "string" && path.isAbsolute(invocation.cwd) ? invocation.cwd : null
  const instanceWorktree = typeof invocation?.root === "string" && path.isAbsolute(invocation.root) ? invocation.root : null
  const invalidWorkdir = workdir !== undefined && typeof workdir !== "string"
  const requestedWorkdir = typeof workdir === "string" && workdir ? workdir : null
  // ShellTool resolves relative workdir against its execution instance, not the
  // stored session directory (which can differ when continuing a session).
  const cwd = invalidWorkdir ? null : requestedWorkdir && path.isAbsolute(requestedWorkdir) ? requestedWorkdir
    : instanceDirectory ? path.resolve(instanceDirectory, requestedWorkdir ?? ".") : null
  if (!instanceDirectory) limitations.push("Execution instance directory unavailable; the session's starting directory is not substituted for it.")
  if (!instanceWorktree) limitations.push("Execution instance worktree unavailable.")
  if (invalidWorkdir) limitations.push("Supplied tool.workdir is not a string; execution directory is unknown.")
  const execution: NonNullable<Evidence["execution"]> = {
    tool: "bash", requestedWorkdir, instanceDirectory, instanceWorktree,
    cwdSource: invalidWorkdir ? "unavailable" : requestedWorkdir && path.isAbsolute(requestedWorkdir) ? "absolute tool.workdir"
      : instanceDirectory ? requestedWorkdir ? "tool.workdir relative to assistant.path.cwd" : "assistant.path.cwd" : "unavailable",
    canonicalCwd: null,
  }
  if (cwd) {
    try { execution.canonicalCwd = await realpath(cwd) }
    catch { limitations.push("Execution directory could not be canonicalized; cwd is the declared launch path, not a verified physical path.") }
  }
  const conversation = await loadConversationContext(request, reader, signal)
  return {
    ...conversation, command, cwd, execution,
    limitations: [...limitations, ...conversation.limitations],
    permission: permissionContext(request),
  }
}

function permissionContext(request: PermissionRequest): NonNullable<Evidence["permission"]> {
  return {
    id: request.id, type: request.permission, patterns: [...request.patterns], always: [...request.always],
    metadata: structuredClone(request.metadata), tool: request.tool ? { ...request.tool } : null,
  }
}

export async function loadEditContext(request: PermissionRequest, reader: ContextReader, signal: AbortSignal): Promise<EditContext> {
  signal.throwIfAborted()
  if (request.permission !== "edit" || !request.tool) throw new Error("Native edit tool context unavailable")
  const message = await reader.message(request.sessionID, request.tool.messageID, signal)
  if (!message || message.info.sessionID !== request.sessionID || message.info.id !== request.tool.messageID) {
    throw new Error("Pending native edit message unavailable")
  }
  const part = message.parts.find((p) => p.type === "tool" && p.callID === request.tool!.callID)
  if (!part || part.type !== "tool" || part.sessionID !== request.sessionID || part.messageID !== request.tool.messageID
    || part.state.status !== "running" || (part.tool !== "edit" && part.tool !== "write" && part.tool !== "apply_patch")) {
    throw new Error("Pending native edit arguments unavailable or unsupported tool")
  }
  const invocation = message.info.role === "assistant" ? message.info.path : undefined
  const location = {
    instanceDirectory: typeof invocation?.cwd === "string" && path.isAbsolute(invocation.cwd) ? invocation.cwd : null,
    instanceWorktree: typeof invocation?.root === "string" && path.isAbsolute(invocation.root) ? invocation.root : null,
  }
  const conversation = await loadConversationContext(request, reader, signal)
  if (!location.instanceDirectory) conversation.limitations.push("Edit invocation directory unavailable; session origin is not substituted.")
  if (!location.instanceWorktree) conversation.limitations.push("Edit invocation worktree unavailable.")
  return { ...conversation, kind: "edit", tool: part.tool, location, permission: permissionContext(request) }
}

async function loadConversationContext(request: PermissionRequest, reader: ContextReader, signal: AbortSignal) {
  signal.throwIfAborted()
  const limitations: string[] = []
  let current: Session | undefined
  let root: Session | undefined
  let prompt: string | null = null
  try {
    const loaded = await reader.session(request.sessionID, signal)
    if (loaded?.id !== request.sessionID) throw new Error("Session mismatch")
    current = loaded
    let ancestor = current
    const seen = new Set<string>()
    while (ancestor.parentID) {
      signal.throwIfAborted()
      if (seen.has(ancestor.id) || seen.size >= 16) throw new Error("Parent chain incomplete")
      seen.add(ancestor.id)
      const expected: string = ancestor.parentID
      const parent = await reader.session(expected, signal)
      if (parent?.id !== expected) throw new Error("Parent session unavailable")
      ancestor = parent
    }
    root = ancestor
    prompt = latestUserPrompt(await reader.messages(root.id, signal), root.id)
  } catch (error) {
    signal.throwIfAborted()
    limitations.push(error instanceof HistoryIncompleteError ? error.message : "Some session ancestry or root-user-prompt context is unavailable.")
  }
  let projects: readonly Project[] = []
  if (current || root) {
    try { projects = await reader.projects(signal) }
    catch { signal.throwIfAborted(); limitations.push("OpenCode project metadata unavailable.") }
  }
  const sessionLocation = (s: Session | undefined): SessionLocation | null => s ? {
    id: s.id, parentID: s.parentID ?? null, directory: s.directory, projectID: s.projectID, workspaceID: s.workspaceID ?? null,
  } : null
  const projectLocation = (s: Session | undefined): ProjectLocation | null => {
    if (!s) return null
    const p = projects.find((p) => p.id === s.projectID)
    if (!p) { limitations.push(`Project metadata unavailable for session ${s.id}.`); return null }
    return { id: p.id, name: p.name ?? null, worktree: p.worktree, vcs: p.vcs ?? null }
  }
  signal.throwIfAborted()
  return {
    userPrompt: prompt, limitations,
    session: { current: sessionLocation(current), root: sessionLocation(root), currentProject: projectLocation(current), rootProject: projectLocation(root) },
  }
}
