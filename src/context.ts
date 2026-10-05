import path from "node:path"
import { realpath } from "node:fs/promises"
import type { Message, Part, PermissionRequest, Project, Session } from "@opencode-ai/sdk/v2"
import type { Evidence, ProjectLocation, SessionLocation } from "./types.js"

export interface ContextReader {
  session(id: string, signal: AbortSignal): Promise<Session | undefined>
  messages(id: string, signal: AbortSignal): Promise<readonly { info: Message; parts: Part[] }[]>
  message(sessionID: string, messageID: string, signal: AbortSignal): Promise<{ info: Message; parts: Part[] } | undefined>
  projects(signal: AbortSignal): Promise<readonly Project[]>
}

export type CommandContext = Omit<Evidence, "files">

/** Filter synthetic and attributed text using the public part metadata. */
export function findUserPrompt(messages: readonly { info: Message; parts: Part[] }[]): { text: string | null } | undefined {
  const ordered = messages.filter((m) => m.info.role === "user").toSorted((a, b) => b.info.time.created - a.info.time.created || b.info.id.localeCompare(a.info.id))
  for (const message of ordered) {
    const parts = message.parts.filter((p) => p.type === "text" && !p.synthetic && !p.ignored && !p.metadata?.source)
    if (parts.length) return { text: parts.map((p) => p.type === "text" ? p.text : "").join("\n").trim() || null }
    // A newer attachment-only user message must not be replaced by an older ask.
    if (message.parts.some((p) => p.type === "file")) return { text: null }
  }
}

export function latestUserPrompt(messages: readonly { info: Message; parts: Part[] }[]): string | null {
  return findUserPrompt(messages)?.text ?? null
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
  const instanceDirectory = message.info.role === "assistant" && path.isAbsolute(message.info.path.cwd) ? message.info.path.cwd : null
  const instanceWorktree = message.info.role === "assistant" && path.isAbsolute(message.info.path.root) ? message.info.path.root : null
  const requestedWorkdir = typeof workdir === "string" && workdir ? workdir : null
  // ShellTool resolves relative workdir against its execution instance, not the
  // stored session directory (which can differ when continuing a session).
  const cwd = requestedWorkdir && path.isAbsolute(requestedWorkdir) ? requestedWorkdir
    : instanceDirectory ? path.resolve(instanceDirectory, requestedWorkdir ?? ".") : null
  if (!instanceDirectory) limitations.push("Execution instance directory unavailable; the session's starting directory is not substituted for it.")
  const execution: NonNullable<Evidence["execution"]> = {
    tool: "bash", requestedWorkdir, instanceDirectory, instanceWorktree,
    cwdSource: requestedWorkdir && path.isAbsolute(requestedWorkdir) ? "absolute tool.workdir"
      : instanceDirectory ? requestedWorkdir ? "tool.workdir relative to assistant.path.cwd" : "assistant.path.cwd" : "unavailable",
    canonicalCwd: null,
  }
  if (cwd) {
    try { execution.canonicalCwd = await realpath(cwd) }
    catch { limitations.push("Execution directory could not be canonicalized; cwd is the declared launch path, not a verified physical path.") }
  }
  signal.throwIfAborted()
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
    prompt = latestUserPrompt(await reader.messages(root.id, signal))
  } catch {
    signal.throwIfAborted()
    limitations.push("Some session ancestry or root-user-prompt context is unavailable.")
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
    command, cwd, userPrompt: prompt, execution, limitations,
    session: { current: sessionLocation(current), root: sessionLocation(root), currentProject: projectLocation(current), rootProject: projectLocation(root) },
    permission: {
      id: request.id, type: request.permission, patterns: [...request.patterns], always: [...request.always],
      metadata: structuredClone(request.metadata), tool: { ...request.tool },
    },
  }
}
