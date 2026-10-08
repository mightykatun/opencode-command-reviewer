import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { NotificationAudio } from "../src/notification-audio.js"
import { LinuxNotifications } from "../src/notification-linux.js"
import { OwnedNotificationProcesses, type NotificationProcesses } from "../src/notification-process.js"
import { gnomeTerminalIdentity } from "../src/notification-terminal.js"

const owned = new OwnedNotificationProcesses()
const measurements: Promise<unknown>[] = []
const playbacks: Promise<number | null>[] = []
let deliveredAt: number | undefined
let notificationStartedAt: number | undefined
const processes: NotificationProcesses = {
  start(command, args, ms, signal, line) {
    if (command === "notify-send") notificationStartedAt = performance.now()
    if (command === "notify-send" && process.argv.includes("--critical")) {
      args = args.map(value => value === "--urgency=normal" ? "--urgency=critical" : value)
    }
    if (command === "paplay" || command === "pw-play") {
      const deliveryToPlayerMs = deliveredAt === undefined ? undefined : performance.now() - deliveredAt
      const dispatchToPlayerMs = notificationStartedAt === undefined ? undefined : performance.now() - notificationStartedAt
      console.log(JSON.stringify({ player: command, deliveryToPlayerMs, dispatchToPlayerMs }))
      measurements.push(readFile(args.at(-1)!).then(bytes => {
      let square = 0, peak = 0
      for (let i = 44; i < bytes.length; i += 2) {
        const sample = bytes.readInt16LE(i) / 32768
        square += sample * sample; peak = Math.max(peak, Math.abs(sample))
      }
      const rms = Math.sqrt(square / ((bytes.length - 44) / 2))
      assert.ok(rms > 0 && rms <= 0.1001); assert.ok(peak <= 10 ** (-3 / 20) + 1 / 32768)
      console.log(JSON.stringify({ sound: args.at(-1)!.split("/").at(-1), rms, peak, normalizedBytes: bytes.length }))
    }))
    }
    const task = owned.start(command, args, ms, signal, value => {
      if (command === "notify-send" && /^[1-9][0-9]*$/.test(value)) {
        deliveredAt = performance.now()
        console.log(JSON.stringify({ dispatchToDeliveryMs: notificationStartedAt === undefined ? undefined : deliveredAt - notificationStartedAt }))
      }
      if (process.argv.includes("--click")) console.log(`${command} event: ${JSON.stringify(value.replace(/Activation Token: .*/, "Activation Token: <redacted>"))}`)
      line?.(value)
    })
    if (task && (command === "paplay" || command === "pw-play")) playbacks.push(task.result.then(result => result.code))
    if (task && process.argv.includes("--click")) void task.result.then(result => console.log(`${command}: exit ${result.code}; ${JSON.stringify(result.stdout.replace(/Activation Token: [^\n]*/g, "Activation Token: <redacted>"))}`))
    return task
  }, dispose: () => owned.dispose(),
}
if (process.argv.includes("--all")) {
  const backend = new LinuxNotifications({ notify: true, notifySound: true,
    notificationSoundDirectory: new URL("../sounds/", import.meta.url).pathname }, () => {
    console.log("Notification click activated the originating terminal.")
  }, processes)
  const cases = [
    { kind: "attention", title: "Session needs attention" },
    { kind: "attention", title: "Reviewer will approve permission in 5 s" },
    { kind: "approved", title: "Reviewer approved a permission" },
    { kind: "error", title: "Session error" },
    { kind: "ended", title: "Session ended" },
  ] as const
  try {
    console.log("All notification/sound tests start in ten seconds.")
    await sleep(10000)
    for (const item of cases) {
      console.log(`SHOW ${item.title}; SOUND ${item.kind}`)
      const before = playbacks.length
      const handle = await backend.show({ ...item, body: "Reviewer desktop sound test", sessionID: "desktop-fixture", sound: true }, new AbortController().signal)
      const end = Date.now() + 15000
      while (playbacks.length === before && Date.now() < end) await sleep(50)
      assert.equal(playbacks.length, before + 1, `${item.title} must reach its sound player`)
      assert.equal(await playbacks[before], 0, `${item.title} sound playback must succeed`)
      // Preserve the announced countdown interval and give each other banner
      // time to be read without replacing or overlapping the following test.
      await sleep(item.title.includes("in 5 s") ? 400 : 1500)
      handle?.close()
    }
    await Promise.all(measurements)
    assert.equal(measurements.length, cases.length)
    console.log("PASS: all five notification messages and their normalized sounds were delivered; every sound player exited successfully.")
  } finally { await backend.dispose() }
} else if (process.argv.includes("--sounds")) {
  const audio = new NotificationAudio(processes, new URL("../sounds/", import.meta.url).pathname)
  try {
    for (const kind of ["attention", "approved", "error", "ended"] as const) {
      console.log(`PLAY ${kind}`)
      await audio.play(kind, new AbortController().signal)
      await sleep(300)
    }
    await Promise.all(measurements)
    assert.equal(measurements.length, 4, "all four sounds must reach actual desktop playback")
  } finally { await audio.dispose(); owned.dispose() }
} else if (process.argv.includes("--click")) {
  assert.ok(gnomeTerminalIdentity(), "run directly inside GNOME Terminal, outside tmux/SSH")
  let clicked = false
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, () => {
    clicked = true
    console.log("PASS: actual notification click received; originating GNOME screen activation completed. Confirm visual window/tab focus separately.")
  }, processes)
  try {
    console.log("Switch to another terminal window/tab. Click the test banner when it appears.")
    await sleep(10000)
    for (let attempt = 0; attempt < (process.argv.includes("--critical") ? 1 : 3) && !clicked; attempt++) {
      const handle = await backend.show({ kind: "attention", title: "Session needs attention", body: "Reviewer activation test",
        sessionID: "desktop-fixture", sound: false }, new AbortController().signal)
      for (let poll = 0; poll < (process.argv.includes("--critical") ? 150 : 60) && !clicked; poll++) await sleep(100)
      handle?.close()
    }
    assert.ok(clicked, "no real click/activation was observed during the transient banner tests")
  } finally { await backend.dispose() }
} else throw new Error("Use --all, --sounds or --click")
