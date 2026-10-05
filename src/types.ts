export interface Limits {
  maxFiles: number
  maxEvidenceBytes: number
}

export interface FileEvidence {
  filename: string
  path?: string
  status: string
  contents?: string
}

export interface Evidence {
  command: string
  cwd: string | null
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
