import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { NotificationQueue } from "./notification-queue.js"

export interface ProcessResult { code: number | null; stdout: string }
export interface NotificationProcess {
  result: Promise<ProcessResult>
  started?: Promise<boolean>
  cancel(): void
}
export interface ProcessScheduling { lane: "banner" | "audio" | "close" | "activation"; root?: string; attention?: boolean }
export interface NotificationProcesses {
  start(command: string, args: readonly string[], ms: number, signal: AbortSignal,
    line?: (line: string) => void, scheduling?: ProcessScheduling): NotificationProcess | undefined
  dispose(): void
}

/** Only fixed-purpose desktop utilities; no shell, stdin, detached jobs or retries. */
class NotificationChildren implements NotificationProcesses {
  private children = new Set<ChildProcessWithoutNullStreams>()
  private stopped = false
  start(command: string, args: readonly string[], ms: number, signal: AbortSignal, line?: (line: string) => void) {
    if (this.stopped || signal.aborted || this.children.size >= 24) return
    // notify-send uses buffered C stdio for --print-id. Without line buffering
    // the desktop can display a banner seconds before our delivery callback.
    // stdbuf execs the same process, preserving signal/cleanup ownership.
    const executable = command === "notify-send" ? "stdbuf" : command
    const argv = command === "notify-send" ? ["--output=L", "--error=L", command, ...args] : [...args]
    const child = spawn(executable, argv, { stdio: "pipe", shell: false, windowsHide: true,
      // libnotify's CLI exposes the click token only through its debug line.
      // Consume that bounded output internally; never log or persist the token.
      ...(command === "notify-send" ? { env: { ...process.env, G_MESSAGES_DEBUG: "all" } } : {}),
    })
    this.children.add(child)
    child.stdin.end()
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill("SIGTERM")
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 250)
    }
    const timeout = setTimeout(cancel, ms)
    signal.addEventListener("abort", cancel, { once: true })
    let stdout = "", buffer = "", bytes = 0
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (text: string) => {
      bytes += Buffer.byteLength(text)
      if (bytes > 16384) { cancel(); return }
      stdout += text; buffer += text
      let end: number
      while ((end = buffer.indexOf("\n")) >= 0) {
        const value = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
        try { line?.(value) } catch { /* Callback cannot escape process ownership. */ }
      }
    })
    child.stderr.on("data", (data: Buffer) => { bytes += data.length; if (bytes > 16384) cancel() })
    const result = new Promise<ProcessResult>((resolve) => {
      child.once("error", () => {})
      child.once("close", code => {
        clearTimeout(timeout); clearTimeout(killTimer)
        signal.removeEventListener("abort", cancel)
        this.children.delete(child)
        resolve({ code, stdout })
      })
    })
    return { result, cancel }
  }
  dispose() {
    this.stopped = true
    for (const child of this.children) child.kill("SIGKILL")
  }
}

interface Job {
  root: string; attention: boolean; lane: ProcessScheduling["lane"]
  run(): void; cancel(): void
}

/** One bounded process admission point, also used around fixture transports.
 * Reserved close/activation lanes cannot be consumed by long-lived banners. */
export class NotificationProcessPool implements NotificationProcesses {
  private queue = new NotificationQueue<Job>(131, 131)
  private active = new Set<Job>()
  private stopped = false
  private scheduled = false
  constructor(private transport: NotificationProcesses) {}
  start(command: string, args: readonly string[], ms: number, parent: AbortSignal, line?: (line: string) => void,
    scheduling: ProcessScheduling = { lane: command === "paplay" || command === "pw-play" ? "audio"
      : command === "gdbus" ? args.includes("org.freedesktop.Notifications.CloseNotification") ? "close" : "activation" : "banner" }): NotificationProcess | undefined {
    if (this.stopped || parent.aborted) return
    const lane = scheduling.lane
    const queued = this.queue.items.filter(v => v.lane === lane)
    if (lane === "activation") for (const old of queued) old.cancel()
    if (queued.length >= (lane === "audio" ? 2 : lane === "activation" ? 2 : 64)) return
    let finish!: (value: ProcessResult) => void, start!: (value: boolean) => void
    const result = new Promise<ProcessResult>(resolve => { finish = resolve })
    const started = new Promise<boolean>(resolve => { start = resolve })
    const abort = new AbortController(), signal = AbortSignal.any([parent, abort.signal])
    let child: NotificationProcess | undefined, done = false
    const release = (value: ProcessResult) => {
      if (done) return
      done = true; start(false); signal.removeEventListener("abort", cancel)
      this.queue.remove(job); this.active.delete(job); finish(value); this.drain()
    }
    const cancel = () => {
      abort.abort()
      if (this.active.has(job)) child?.cancel()
      else release({ code: null, stdout: "" })
    }
    const job: Job = { root: scheduling.root ?? "", attention: scheduling.attention ?? false, lane, cancel, run: () => {
      if (signal.aborted) { release({ code: null, stdout: "" }); return }
      this.active.add(job)
      try { child = this.transport.start(command, args, ms, signal, line) } catch {}
      if (!child) { release({ code: null, stdout: "" }); return }
      start(true)
      void child.result.then(release, () => release({ code: null, stdout: "" }))
    } }
    signal.addEventListener("abort", cancel, { once: true })
    if (!this.queue.add(job)) { release({ code: null, stdout: "" }); return }
    this.drain()
    return { result, started, cancel }
  }
  private drain() {
    if (this.scheduled || this.stopped) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.stopped) return
      let job: Job | undefined
      while ((job = this.queue.take(next => {
        const same = [...this.active].filter(v => v.lane === next.lane)
        return this.active.size < 24 && same.length < ({ banner: 20, audio: 2, close: 1, activation: 1 }[next.lane])
          && (next.lane !== "banner" || next.attention || same.filter(v => !v.attention).length < 16)
      }))) job.run()
    })
  }
  dispose() {
    this.stopped = true
    for (const job of [...this.queue.items, ...this.active]) job.cancel()
    this.transport.dispose()
  }
}

export class OwnedNotificationProcesses extends NotificationProcessPool {
  constructor() { super(new NotificationChildren()) }
}
