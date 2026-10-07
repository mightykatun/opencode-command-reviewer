import { execFileSync, fork } from "node:child_process"
import path from "node:path"

const tmux = (socket, args) => execFileSync("tmux", ["-S", socket, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL",
})
const stop = (socket) => { try { tmux(socket, ["kill-server"]) } catch { /* Already stopped or not started. */ } }

if (process.argv[2] === "--guard") {
  const socket = process.argv[3]
  if (!socket || !path.isAbsolute(socket) || !process.send) process.exit(1)
  const cleanup = () => { stop(socket); process.exit() }
  process.on("disconnect", cleanup)
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("message", ({ id, args }) => {
    // Own startup as well as cleanup. If the parent dies during new-session,
    // disconnect is handled only after the synchronous launch has settled.
    let error
    try { tmux(socket, ["new-session", ...args]) } catch (cause) { error = String(cause) }
    if (!process.connected) return cleanup()
    process.send({ id, error }, (failure) => { if (failure) cleanup() })
  })
  process.send({ ready: true }, (error) => { if (error) cleanup() })
}

/** Each fixture supplies its own mkdtemp directory, never a shared/default socket. */
export async function smokeRuntime(directory) {
  if (!path.isAbsolute(directory)) throw new Error("Fixture directory must be absolute")
  const socket = path.join(directory, "tmux.sock")
  const guard = fork(new URL(import.meta.url), ["--guard", socket], {
    detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"], execArgv: [],
  })
  let closed = false, sequence = 0
  const requests = new Map()
  let ready, failed
  const initialized = new Promise((resolve, reject) => { ready = resolve; failed = reject })
  const cleanup = () => stop(socket)
  process.on("exit", cleanup)
  guard.on("message", (message) => {
    if (message.ready) { ready(); return }
    const request = requests.get(message.id)
    requests.delete(message.id)
    if (!requests.size) guard.channel?.unref()
    if (message.error) request?.reject(new Error(message.error))
    else request?.resolve()
  })
  guard.on("error", failed)
  const exited = new Promise((resolve) => guard.once("exit", () => {
    closed = true
    cleanup() // Also handle a supervisor failure while the owner remains alive.
    process.off("exit", cleanup)
    const error = new Error("Fixture supervisor stopped")
    failed(error)
    for (const request of requests.values()) request.reject(error)
    requests.clear()
    resolve()
  }))
  await initialized
  guard.unref()
  guard.channel?.unref()
  return {
    socket,
    supervisorPID: guard.pid,
    tmux: (...args) => {
      if (closed) throw new Error("Fixture runtime is closed")
      if (args[0] === "new-session") throw new Error("Use supervised start for new sessions")
      return tmux(socket, args)
    },
    start: (...args) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Fixture runtime is closed")); return }
      const id = ++sequence
      requests.set(id, { resolve, reject })
      guard.channel?.ref()
      guard.send({ id, args }, (error) => {
        if (error) {
          requests.delete(id)
          if (!requests.size) guard.channel?.unref()
          reject(error)
        }
      })
    }),
    dispose: async () => {
      closed = true
      guard.ref()
      if (guard.connected) guard.disconnect()
      await exited
    },
  }
}
