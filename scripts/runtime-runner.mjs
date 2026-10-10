import { spawn } from "node:child_process"

/** Own the whole fixture process group, including wrappers with child drivers.
 * smokeRuntime's detached supervisor separately owns its private tmux server.
 */
export async function executeFixture(command, args, { cwd, env = process.env, signal, timeoutMs, graceMs = 10000, output = () => {} }) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let timedOut = false, escalation, settled = false
    const kill = signal => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== "ESRCH") throw error }
    }
    const stop = () => {
      if (settled || escalation) return
      kill("SIGTERM")
      escalation = setTimeout(() => kill("SIGKILL"), graceMs)
    }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    signal?.addEventListener("abort", stop, { once: true })
    if (signal?.aborted) stop()
    for (const [stream, channel] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) stream.on("data", chunk => output(chunk, channel))
    const cleanup = () => {
      settled = true
      clearTimeout(timer); clearTimeout(escalation)
      signal?.removeEventListener("abort", stop)
    }
    child.once("error", error => { cleanup(); reject(error) })
    child.once("close", (code, exitSignal) => {
      // Even a wrapper exiting early must not leave its child driver behind.
      kill("SIGKILL")
      cleanup()
      resolve({ code, signal: exitSignal, timedOut, interrupted: signal?.aborted === true })
    })
  })
}
