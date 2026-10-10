import * as fs from "node:fs/promises"
import { randomUUID } from "node:crypto"

/** Fixture-only snapshots. A publisher owns one destination; separate hosts use separate files. */
export function observationPublisher(file, { io = fs } = {}) {
  let queued, worker, failure, closed = false
  const start = () => {
    if (worker || failure || queued === undefined) return
    worker = (async () => {
      while (queued !== undefined) {
        const text = queued
        queued = undefined
        const temporary = `${file}.${randomUUID()}.tmp`
        let primaryError
        try {
          await io.writeFile(temporary, text, { mode: 0o600, flag: "wx" })
          await io.rename(temporary, file)
        } catch (cause) { primaryError = cause; throw cause }
        finally {
          try { await io.rm(temporary, { force: true }) }
          catch (cause) { if (!primaryError) throw cause }
        }
      }
    })().catch(async cause => {
      failure = new Error(`Observation publication failed: ${file}: ${cause.message}`, { cause })
      // Cross-process failure channel. If the filesystem itself is unavailable,
      // flush still rejects and the host log retains the exact publication error.
      const temporary = `${file}.${randomUUID()}.error.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify({ error: failure.message }), { mode: 0o600, flag: "wx" })
        await fs.rename(temporary, `${file}.error`)
      } catch { console.error(failure) }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    }).finally(() => { worker = undefined; start() })
  }
  const flush = async () => {
    while (worker) await worker
    if (failure) throw failure
  }
  return {
    publish(value) {
      if (closed) throw new Error(`Observation publisher closed: ${file}`)
      if (failure) return // Error stays owned and is reported by read/flush/close.
      const text = JSON.stringify(value)
      if (text === undefined) throw new Error(`Observation must be JSON: ${file}`)
      queued = text
      start()
      return worker
    },
    flush,
    async close() { closed = true; await flush() },
  }
}

export async function readObservation(file, { optional = false } = {}) {
  let fault
  try { fault = await fs.readFile(`${file}.error`, "utf8") }
  catch (error) { if (error.code !== "ENOENT") throw error }
  if (fault !== undefined) throw new Error(`Fixture publisher error: ${fault}`)
  let text
  try { text = await fs.readFile(file, "utf8") }
  catch (cause) {
    if (optional && cause.code === "ENOENT") return
    throw new Error(`Cannot read observation ${file}: ${cause.message}`, { cause })
  }
  try { return JSON.parse(text) }
  catch (cause) { throw new Error(`Invalid JSON observation ${file}: ${cause.message}`, { cause }) }
}

/** One-shot control publication, including driver-to-host fault injection. */
export async function publishObservation(file, value) {
  const publisher = observationPublisher(file)
  publisher.publish(value)
  await publisher.close()
}
