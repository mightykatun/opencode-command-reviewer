import { constants } from "node:fs"
import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { NotificationKind } from "./notification-types.js"
import type { NotificationProcesses } from "./notification-process.js"
import { withDeadline } from "./deadline.js"
import { MAX_SOUND_BYTES, normalizedSound } from "./notification-codec.js"

export interface BundledSound { format: "mp3" | "wav"; data: string }
declare const __REVIEW_SOUNDS__: Partial<Record<NotificationKind, BundledSound>>
const bundled = typeof __REVIEW_SOUNDS__ === "undefined" ? {} : __REVIEW_SOUNDS__

/** Bounded capture, bundled decoding, normalization and playback outside review budgets. */
export class NotificationAudio {
  private stopped = false
  private active = 0
  private preparing = 0
  private temporary?: Promise<string>
  private prepared = new Map<NotificationKind, Promise<string | undefined>>()
  private transactions = new Set<Promise<unknown>>()
  private abort = new AbortController()
  constructor(private processes: NotificationProcesses, private directory?: string,
    private sounds: Partial<Record<NotificationKind, BundledSound>> = bundled) {}
  private async capture(file: string, signal: AbortSignal) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      signal.throwIfAborted()
      const stat = await handle.stat()
      if (!stat.isFile() || !stat.size || stat.size > MAX_SOUND_BYTES) throw new Error("Invalid notification sound file")
      const bytes = Buffer.alloc(stat.size + 1)
      let size = 0
      while (size < bytes.length) {
        signal.throwIfAborted()
        const read = await handle.read(bytes, size, Math.min(65536, bytes.length - size), size)
        signal.throwIfAborted()
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      if (size > stat.size) throw new Error("Notification sound changed during capture")
      return bytes.subarray(0, size)
    } finally { await handle.close() }
  }
  private async prepare(kind: NotificationKind, signal: AbortSignal) {
    let pcm: Buffer | undefined
    if (this.directory) for (const format of ["wav", "mp3"] as const) {
      signal.throwIfAborted()
      try { pcm = await normalizedSound(await this.capture(path.join(this.directory, `${kind}.${format}`), signal), format, signal); break }
      catch { signal.throwIfAborted() }
    }
    if (!pcm) {
      const sound = this.sounds[kind]
      if (!sound) return
      pcm = await normalizedSound(Buffer.from(sound.data, "base64"), sound.format, signal)
    }
    signal.throwIfAborted()
    this.temporary ??= mkdtemp(path.join(tmpdir(), "opencode-reviewer-sounds-"))
    const directory = await this.temporary
    signal.throwIfAborted()
    const file = path.join(directory, `${kind}.wav`)
    await writeFile(file, pcm, { flag: "w", mode: 0o600 })
    signal.throwIfAborted()
    return file
  }
  private async file(kind: NotificationKind, signal: AbortSignal) {
    const existing = this.prepared.get(kind)
    if (existing) return withDeadline(signal, 2000, () => existing)
    if (this.preparing >= 2) return
    const preparation = withDeadline(this.abort.signal, 2000, bounded => {
      this.preparing++
      const worker = this.prepare(kind, bounded).finally(() => { this.preparing-- })
      this.transactions.add(worker)
      void worker.then(() => this.transactions.delete(worker), () => this.transactions.delete(worker))
      return worker
    })
    this.prepared.set(kind, preparation)
    void preparation.catch(() => { if (this.prepared.get(kind) === preparation) this.prepared.delete(kind) })
    // A resolved/canceled banner stops its playback wait, not a shared bounded
    // preparation that a following notification of the same kind still needs.
    return withDeadline(signal, 2000, () => preparation)
  }
  /** Decode/cache before desktop delivery, so a visible banner does not wait on WASM or file I/O. */
  async ready(kind: NotificationKind, parent: AbortSignal): Promise<boolean> {
    if (this.stopped || parent.aborted) return false
    try { return !!await this.file(kind, AbortSignal.any([parent, this.abort.signal])) }
    catch { return false }
  }
  async play(kind: NotificationKind, parent: AbortSignal) {
    if (this.stopped || parent.aborted || this.active >= 2) return
    this.active++
    const signal = AbortSignal.any([parent, this.abort.signal])
    try {
      const file = await this.file(kind, signal)
      signal.throwIfAborted()
      if (!file) return
      for (const player of ["paplay", "pw-play"]) {
        signal.throwIfAborted()
        const process = this.processes.start(player, [player === "paplay" ? "--latency-msec=50" : "--latency=50ms", file], 12000, signal)
        if (!process || (await process.result).code === 0) return
      }
    } catch { /* Audio failures do not affect banners, review or approval. */ }
    finally { this.active-- }
  }
  async dispose() {
    this.stopped = true; this.abort.abort()
    const cleanup = async () => {
      await Promise.allSettled([...this.prepared.values(), ...this.transactions])
      const directory = await this.temporary?.catch(() => undefined)
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
    // Retain eventual cleanup if a filesystem transaction outlives disposal.
    const worker = cleanup().catch(() => {})
    await withDeadline(new AbortController().signal, 2500, () => worker).catch(() => {})
  }
}
