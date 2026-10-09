export interface Limits {
  maxFiles: number
  maxEvidenceBytes: number
}

export interface FileEvidence {
  filename: string
  path?: string
  aliases?: string[]
  status: string
  contents?: string
  warning?: string
}

export type ReviewKind = "shell" | "edit" | "mcp" | "custom" | "external-directory" | "skill"

export interface DelegationContext {
  sessionID: string
  parentSessionID: string
  messageID: string | null
  prompt: string | null
}

export interface Evidence {
  kind: "shell"
  command: string
  cwd: string | null
  delegation?: DelegationContext
  userPrompt: string | null
  files: FileEvidence[]
  limitations: string[]
  permission?: {
    id: string
    type: string
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
    tool: { messageID: string; callID: string } | null
  }
  session?: {
    current: SessionLocation | null
    root: SessionLocation | null
    currentProject: ProjectLocation | null
    rootProject: ProjectLocation | null
  }
  execution?: {
    tool: "bash"
    requestedWorkdir: string | null
    instanceDirectory: string | null
    instanceWorktree: string | null
    cwdSource: "absolute tool.workdir" | "tool.workdir relative to assistant.path.cwd" | "assistant.path.cwd" | "unavailable"
    canonicalCwd: string | null
  }
}

export interface EditChange {
  path: string | null
  operation: "edit" | "write" | "add" | "update" | "delete" | "move" | "unknown"
  movePath?: string
  status: "included" | "omitted"
  reason?: string
  diff?: string
  warning?: string
  delta?: string
}

export interface EditEvidence {
  kind: "edit"
  tool: "edit" | "write" | "apply_patch"
  delegation?: DelegationContext
  userPrompt: string | null
  session?: Evidence["session"]
  location: { instanceDirectory: string | null; instanceWorktree: string | null }
  permission: Omit<NonNullable<Evidence["permission"]>, "metadata"> & { metadataStatus: string }
  changes: EditChange[]
  partial: boolean
  limitations: string[]
}

/** Internal host context; raw metadata must pass through bounded edit collection. */
export type EditContext = Omit<EditEvidence, "changes" | "partial" | "permission"> & {
  permission: NonNullable<Evidence["permission"]>
}

export type PermissionEvidence = NonNullable<Evidence["permission"]>
export type InvocationLocation = EditEvidence["location"]
export interface ToolDefinition { id: string; description: string; parameters: unknown }

export interface ToolContext {
  kind: "mcp" | "custom"
  tool: string
  input: Record<string, unknown>
  origin: { source: "host MCP routing" | "host registry"; server: string | null }
  definition?: ToolDefinition
  permission: PermissionEvidence
  location: InvocationLocation
  delegation?: DelegationContext
  userPrompt: string | null
  session?: Evidence["session"]
  limitations: string[]
}

export interface ToolEvidence extends Omit<ToolContext, "definition"> {
  definition: { status: "included"; source: "public host tool catalog"; description: string; parameters: unknown }
    | { status: "unavailable" | "omitted"; reason: string }
  partial: boolean
}

export interface DirectoryContext {
  kind: "external-directory"
  tool: string
  input: Record<string, unknown>
  native: boolean
  permission: PermissionEvidence
  location: InvocationLocation
  delegation?: DelegationContext
  userPrompt: string | null
  session?: Evidence["session"]
  limitations: string[]
}

export interface PatchOperation {
  operation: "add" | "update" | "delete" | "move"
  path: string
  movePath?: string
}

export interface DirectoryEvidence extends Omit<DirectoryContext, "input" | "permission" | "native"> {
  operation: { input: Record<string, unknown>; inputStatus: string; patchOperations?: PatchOperation[] }
  permission: Omit<PermissionEvidence, "metadata"> & { metadata?: Record<string, unknown>; metadataStatus: string }
  partial: boolean
}

export interface SkillDefinition { name: string; description?: string; location: string; content: string }
export interface SkillContext {
  kind: "skill"
  tool: "skill"
  input: Record<string, unknown>
  skill: SkillDefinition
  permission: PermissionEvidence
  location: InvocationLocation
  delegation?: DelegationContext
  userPrompt: string | null
  session?: Evidence["session"]
  limitations: string[]
}
export interface SkillEvidence extends SkillContext { files: FileEvidence[]; partial: boolean }

export type ReviewEvidence = Evidence | EditEvidence | ToolEvidence | DirectoryEvidence | SkillEvidence

export interface SessionLocation {
  id: string
  parentID: string | null
  directory: string
  projectID: string
  workspaceID: string | null
}

export interface ProjectLocation {
  id: string
  name: string | null
  worktree: string
  vcs: string | null
}

export interface Assessment {
  safe: boolean
  desc: string
}

/** Monotonic durations from evaluation start, excluding approval/countdown time. */
export interface ReviewTiming {
  fullReportMs: number
  ratingMs: number
}

/** Provisional transport observations, not an accepted assessment. Only opt-in
 * fast mode may use a parsed Safe preview for early approval.
 * Attempts are zero-based; evaluating/retrying (and absent preview) clear prior content.
 * The display layer must sanitize prefixes before rendering.
 */
export interface ReviewProgress {
  attempt: number
  phase: "evaluating" | "retrying" | "streaming"
  preview?: Partial<Assessment>
}

/** Endpoint metadata stays outside the model's strict assessment JSON. */
export interface ReviewResult extends Assessment {
  usage?: import("./usage.js").Usage
  metadata?: ReviewMetadata
}

export interface ReviewMetadata {
  review: string
  kind: ReviewKind
  configuredModel: string
  provider: string
  reportedModel?: string
}
export type ReviewAttemptEvent =
  | { type: "dispatched"; review: string; attempt: string; retry: "initial" | "transport" | "format" }
  | { type: "finalized"; review: string; attempt: string; usage?: import("./usage.js").Usage; reportedModel?: string }
export interface ReviewObservation {
  review: string
  observe?: (event: ReviewAttemptEvent) => unknown
}
