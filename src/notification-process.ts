import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export interface ProcessResult { code: number | null; stdout: string }
export interface NotificationProcess {
  result: Promise<ProcessResult>
  cancel(): void
}
export interface NotificationProcesses {
  start(command: string, args: readonly string[], ms: number, signal: AbortSignal,
    line?: (line: string) => void): NotificationProcess | undefined
  dispose(): void
}

/** Only fixed-purpose desktop utilities; no shell, stdin, detached jobs or retries. */
export class OwnedNotificationProcesses implements NotificationProcesses {
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
