import { copyFile, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** Record fixed desktop/audio process effects while exercising the actual bundle. */
export async function notificationRecorder(plugin, directory) {
  const base = path.join(directory, "notification-reviewer-base.mjs")
  const records = path.join(directory, "notifications.jsonl")
  await copyFile(plugin, base)
  await writeFile(records, "")
  await writeFile(plugin, `
import plugin, { withNotificationProcesses } from ${JSON.stringify(pathToFileURL(base).href)}
import { appendFile, readFile } from "node:fs/promises"
let writes = Promise.resolve(), sequence = 1
const children = new Map()
const record = data => { writes = writes.then(() => appendFile(${JSON.stringify(records)}, JSON.stringify({ at: Date.now(), ...data }) + "\\n")); writes.catch(() => {}) }
const tui = withNotificationProcesses(() => ({
  start(command, args, ms, signal, line) {
    if (signal.aborted) return
    let finish
    const result = new Promise(resolve => { finish = resolve })
    let id
    signal.addEventListener("abort", () => finish({ code: null, stdout: "" }), { once: true })
    if (command === "notify-send") {
      id = String(sequence++)
      children.set(id, finish)
      const bodyText = args.at(-1), separator = bodyText.indexOf(" · ")
      const title = bodyText.slice(0, separator), body = bodyText.slice(separator + 3)
      record({ event: "notification", id, summary: args.at(-2), title, body, args })
      queueMicrotask(() => line?.(id))
    } else if (command === "gdbus") {
      const id = args.at(-1)
      record({ event: "withdraw", id })
      children.get(id)?.({ code: 0, stdout: "" }); children.delete(id)
      finish({ code: 0, stdout: "()" })
    } else if (command === "paplay" || command === "pw-play") {
      readFile(args.at(-1)).then(bytes => {
        let peak = 0, squares = 0
        for (let i = 44; i < bytes.length; i += 2) {
          const value = bytes.readInt16LE(i) / 32768
          squares += value * value; peak = Math.max(peak, Math.abs(value))
        }
        record({ event: "sound", kind: args.at(-1).split("/").at(-1).replace(".wav", ""),
          bytes: bytes.length, rms: Math.sqrt(squares / ((bytes.length - 44) / 2)), peak })
        finish({ code: 0, stdout: "" })
      }, () => finish({ code: 1, stdout: "" }))
    } else finish({ code: 1, stdout: "" })
    return { result, cancel: () => finish({ code: null, stdout: "" }) }
  },
  dispose() { for (const finish of children.values()) finish({ code: null, stdout: "" }); children.clear() },
}))
export default { id: plugin.id, tui: async (api, options) => {
  for (const type of ["permission.asked", "permission.replied", "question.asked", "question.replied", "question.rejected", "session.idle", "session.error"])
    api.event.on(type, event => record({ event: type, request: event.properties.requestID ?? event.properties.id,
      error: event.properties.error?.name }))
  api.lifecycle.onDispose(() => writes)
  return tui(api, options)
} }
`)
  return async () => (await readFile(records, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
}

export function assertNotificationAudio(assert, records) {
  for (const sound of records.filter(record => record.event === "sound")) {
    assert.ok(sound.bytes > 44)
    assert.ok(sound.rms > 0 && sound.rms <= 0.1001)
    assert.ok(sound.peak <= 10 ** (-3 / 20) + 1 / 32768)
  }
}
