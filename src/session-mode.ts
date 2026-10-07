import { constants } from "node:fs"
import { mkdir, open, rename, unlink } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { withDeadline } from "./deadline.js"

type Session = { id: string; parentID?: string }
export interface SessionModeGate {
  root(sessionID: string, signal: AbortSignal): Promise<string>
  load(root: string, signal: AbortSignal): Promise<void>
  enabled(root: string): boolean
}
export interface ModeStore {
  read(root: string, signal: AbortSignal): Promise<boolean>
  write(root: string, enabled: boolean): Promise<void>
  flush(): Promise<void>
}

/** Independent root records avoid overwriting another conversation's updates. */
export class SessionModeStore implements ModeStore {
  private pending = Promise.resolve()
  constructor(private directory: string, private host: string) {
    if (!path.isAbsolute(directory)) throw new Error("Session mode directory must be absolute")
  }
  private file(root: string) {
    const key = createHash("sha256").update(JSON.stringify([this.host, root])).digest("hex")
    return path.join(this.directory, `${key}.json`)
  }
  async read(root: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    const file = await open(this.file(root), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error })
    if (!file) { signal.throwIfAborted(); return true }
    try {
      signal.throwIfAborted()
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 1024) throw new Error("Invalid session mode record")
      const buffer = Buffer.alloc(1025)
      let size = 0
      while (size < buffer.length) {
        signal.throwIfAborted()
        const result = await file.read(buffer, size, buffer.length - size, size)
        if (!result.bytesRead) break
        size += result.bytesRead
      }
      signal.throwIfAborted()
      if (size > 1024) throw new Error("Invalid session mode record")
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)))
      if (!value || Array.isArray(value) || Object.keys(value).length !== 2 || value.version !== 1 || typeof value.enabled !== "boolean") {
        throw new Error("Invalid session mode record")
      }
      return value.enabled
    } finally { await file.close() }
  }
  write(root: string, enabled: boolean): Promise<void> {
    const file = this.file(root)
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, "wx", 0o600)
        try { await handle.writeFile(JSON.stringify({ version: 1, enabled })); await handle.sync() }
        finally { await handle.close() }
        await rename(temporary, file)
        const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY)
        try { await directory.sync() } finally { await directory.close() }
      } finally { await unlink(temporary).catch(() => {}) }
    })
    return this.pending
  }
  flush() { return this.pending }
}

/** Only metadata needed to establish ownership is read before this gate opens. */
export class SessionModes implements SessionModeGate {
  private roots = new Map<string, string>()
  private values = new Map<string, boolean>()
  private changes = new Map<string, number>()
  constructor(private store: ModeStore, private session: (id: string, signal: AbortSignal) => Promise<Session | undefined>) {}
  root(sessionID: string, parent: AbortSignal): Promise<string> {
    return withDeadline(parent, 5000, async (signal) => {
      const visited = new Set<string>()
      let id = sessionID
      for (let depth = 0; depth <= 16; depth++) {
        signal.throwIfAborted()
        if (!id || visited.has(id)) throw new Error("Session ancestry unavailable")
        const cached = this.roots.get(id)
        if (cached) return cached
        visited.add(id)
        const value = await this.session(id, signal)
        signal.throwIfAborted()
        if (value?.id !== id || (value.parentID !== undefined && (typeof value.parentID !== "string" || !value.parentID))) {
          throw new Error("Session ancestry unavailable")
        }
        if (!value.parentID) {
          if (this.roots.size + visited.size > 4096) this.roots.clear()
          for (const child of visited) this.roots.set(child, id)
          return id
        }
        id = value.parentID
      }
      throw new Error("Session ancestry limit reached")
    }, "Session mode ancestry")
  }
  async load(root: string, parent: AbortSignal) {
    if (this.values.has(root)) return
    const revision = this.changes.get(root)
    const value = await withDeadline(parent, 5000, (signal) => this.store.read(root, signal), "Session mode loading")
    parent.throwIfAborted()
    // A read started before a local switch must never overwrite that switch.
    if (this.changes.get(root) === revision) this.values.set(root, value)
  }
  enabled(root: string) { return this.values.get(root) === true }
  set(root: string, enabled: boolean): Promise<void> {
    this.changes.set(root, (this.changes.get(root) ?? 0) + 1)
    this.values.set(root, enabled)
    return this.store.write(root, enabled)
  }
  deleted(id: string) {
    for (const [child, root] of this.roots) if (child === id || root === id) this.roots.delete(child)
  }
  flush() { return this.store.flush() }
}
