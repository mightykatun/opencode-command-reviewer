import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { setImmediate as settle } from "node:timers/promises"
import { LinuxNotifications } from "../src/notification-linux.js"
import { NotificationAudio } from "../src/notification-audio.js"
import { gnomeTerminalIdentity, activateGnomeTerminal } from "../src/notification-terminal.js"
import { OwnedNotificationProcesses, type NotificationProcesses, type ProcessResult } from "../src/notification-process.js"
import { fixtureWav } from "./notification-fixtures.js"

const identity = { service: ":1.123", screen: "00000000-0000-0000-0000-000000000001" }
const message = { kind: "attention" as const, title: "Session needs attention", body: "<root>&\u001b", sessionID: "root", sound: false }
function fakeProcesses() {
  const calls: { command: string; args: readonly string[]; line?: (line: string) => void; finish(result: ProcessResult): void; signal: AbortSignal }[] = []
  let playerCode = 0
  const processes: NotificationProcesses = {
    start(command, args, _ms, signal, line) {
      if (signal.aborted) return
      let finish!: (result: ProcessResult) => void
      const result = new Promise<ProcessResult>(resolve => { finish = resolve })
      const call = { command, args, line, finish, signal }; calls.push(call)
      signal.addEventListener("abort", () => finish({ code: null, stdout: "" }), { once: true })
      if (command === "gdbus") finish({ code: 0, stdout: args.includes("org.gnome.Shell.SearchProvider2.GetSubsearchResultSet") ? `(['${identity.screen}'],)` : "()" })
      if (["paplay", "pw-play"].includes(command)) finish({ code: playerCode, stdout: "" })
      return { result, cancel: () => finish({ code: null, stdout: "" }) }
    }, dispose() { for (const call of calls) call.finish({ code: null, stdout: "" }) },
  }
  return { processes, calls, playerCode: (value: number) => { playerCode = value } }
}

test("Linux banners are transient, normal, silent by default desktop sound, separate IDs, escaped bodies and bounded click targets", async () => {
  const f = fakeProcesses(), clicks: string[] = []
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, id => clicks.push(id), f.processes, identity)
  const abort = new AbortController()
  const handle = await backend.show(message, abort.signal)
  const call = f.calls[0]!
  assert.equal(call.command, "notify-send")
  assert.ok(call.args.includes("--transient")); assert.ok(call.args.includes("--urgency=normal"))
  assert.ok(call.args.includes("--expire-time=-1")); assert.ok(call.args.includes("--hint=boolean:suppress-sound:true"))
  assert.ok(call.args.includes("--hint=string:desktop-entry:org.gnome.Terminal"))
  const icon = call.args.find(arg => arg.startsWith("--icon="))!.slice(7)
  assert.ok(call.args.includes(`--hint=string:image-path:${icon}`), "status image must survive GNOME's source-icon override")
  assert.equal(path.basename(icon), "attention.png")
  assert.equal((await readFile(icon)).subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  assert.ok(!call.args.some(arg => arg.startsWith("--replace-id")))
  assert.equal(call.args.at(-2), "Opencode")
  assert.equal(call.args.at(-1), "Session needs attention · &lt;root&gt;&amp;")
  call.line!("42"); call.line!("default")
  call.line!("(notify-send:123): libnotify-DEBUG: 12:00:00.000: Activation Token: fixture-token_TIME1234")
  call.finish({ code: 0, stdout: "42\ndefault\n" }); await settle()
  assert.deepEqual(clicks, ["root"])
  assert.ok(f.calls.some(c => c.args.includes("org.gnome.Shell.SearchProvider2.ActivateResult")))
  assert.ok(f.calls.some(c => c.args.includes("org.gtk.Application.Activate") && c.args.at(-1)?.includes("fixture-token_TIME1234")))
  handle!.close(); await settle()
  await backend.dispose()
})

test("notify-send backslash decoding cannot turn literal session titles into markup or controls", async () => {
  const f = fakeProcesses()
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, () => {}, f.processes, null)
  await backend.show({ ...message, body: "literal \\074b\\076 \\033 title" }, new AbortController().signal)
  assert.equal(f.calls[0]?.args.at(-1), "Session needs attention · literal \\\\074b\\\\076 \\\\033 title")
  await backend.dispose()
})

test("late notification IDs are withdrawn after resolution; late clicks cannot navigate", async () => {
  const f = fakeProcesses(), clicks: string[] = []
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, id => clicks.push(id), f.processes, identity)
  const abort = new AbortController()
  await backend.show(message, abort.signal); abort.abort()
  f.calls[0]!.line!("43"); f.calls[0]!.line!("default"); await settle()
  assert.equal(clicks.length, 0)
  assert.ok(f.calls.some(c => c.args.at(-1) === "43"))
  await backend.dispose()
})

test("unsupported terminals still notify without actions; non-Linux never starts desktop processes", async () => {
  const f = fakeProcesses()
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, () => {}, f.processes, null)
  await backend.show(message, new AbortController().signal)
  assert.ok(!f.calls[0]!.args.some(arg => arg.startsWith("--action")))
  await backend.dispose()
  const other = new LinuxNotifications({ notify: true, notifySound: false }, () => {}, f.processes, identity, "darwin")
  const before = f.calls.length
  assert.equal(await other.show(message, new AbortController().signal), undefined)
  assert.equal(f.calls.length, before); await other.dispose()
})

test("terminal identity rejects multiplexed, remote, malformed or stale targets without guessing", async () => {
  const env = { GNOME_TERMINAL_SERVICE: identity.service, GNOME_TERMINAL_SCREEN: `/org/gnome/Terminal/screen/${identity.screen.replaceAll("-", "_")}` }
  assert.deepEqual(gnomeTerminalIdentity(env), identity)
  for (const override of [{ TMUX: "pane" }, { STY: "screen" }, { SSH_TTY: "remote" }, { GNOME_TERMINAL_SERVICE: "bad;command" }, { GNOME_TERMINAL_SCREEN: "unknown" }]) {
    assert.equal(gnomeTerminalIdentity({ ...env, ...override }), undefined)
  }
  const f = fakeProcesses()
  assert.equal(await activateGnomeTerminal(f.processes, undefined, new AbortController().signal), false)
  assert.equal(f.calls.length, 0)
  const stale: NotificationProcesses = { start: () => ({ result: Promise.resolve({ code: 0, stdout: "([], )" }), cancel() {} }), dispose() {} }
  assert.equal(await activateGnomeTerminal(stale, identity, new AbortController().signal), false)
})

test("custom WAV playback and per-file bundled fallback use literal paths and owned temporary files", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-audio-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const wav = fixtureWav()
  await writeFile(path.join(directory, "attention.wav"), wav)
  await writeFile(path.join(directory, "error.wav"), "not audio")
  const f = fakeProcesses()
  const audio = new NotificationAudio(f.processes, directory, { error: { format: "wav", data: wav.toString("base64") } })
  const signal = new AbortController().signal
  await audio.play("attention", signal)
  assert.notEqual(f.calls[0]?.args.at(-1), path.join(directory, "attention.wav"))
  assert.deepEqual(await readFile(path.join(directory, "attention.wav")), wav)
  await audio.play("error", signal)
  const fallback = f.calls[1]!.args.at(-1)!
  assert.ok(fallback.startsWith(path.join(tmpdir(), "opencode-reviewer-sounds-")))
  assert.equal((await readFile(fallback)).toString("ascii", 0, 4), "RIFF")
  await audio.dispose(); await assert.rejects(readFile(fallback))
  assert.equal(f.calls.every(c => c.command === "paplay"), true)
})

test("missing players and invalid sounds stay isolated, mute schedules no playback", async () => {
  const f = fakeProcesses(); f.playerCode(1)
  const audio = new NotificationAudio(f.processes, "/nonexistent", { attention: { format: "wav", data: "bad" } })
  await audio.play("attention", new AbortController().signal)
  assert.equal(f.calls.length, 0); await audio.dispose()
  const backend = new LinuxNotifications({ notify: true, notifySound: false }, () => {}, f.processes, identity)
  await backend.show(message, new AbortController().signal); f.calls[0]!.line!("99"); await settle()
  assert.ok(f.calls.every(c => !["paplay", "pw-play"].includes(c.command))); await backend.dispose()
})

test("audio is normalized before the banner is dispatched; delivery starts cached low-latency playback", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-sync-audio-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, "attention.wav"), fixtureWav(1000, 160000))
  const f = fakeProcesses()
  const backend = new LinuxNotifications({ notify: true, notifySound: true, notificationSoundDirectory: directory },
    () => {}, f.processes, null)
  t.after(() => backend.dispose())
  await backend.show({ ...message, sound: true }, new AbortController().signal)
  assert.deepEqual(f.calls.map(c => c.command), ["notify-send"], "preparation must not play early")
  // Prove the post-delivery path does not re-open or decode the custom source.
  await rm(path.join(directory, "attention.wav"))
  f.calls[0]!.line!("51")
  await settle()
  const playback = f.calls.find(c => c.command === "paplay")
  assert.ok(playback, "cached playback must dispatch without post-banner preparation")
  assert.equal(playback.args[0], "--latency-msec=50")
  assert.equal((await readFile(playback.args.at(-1)!)).toString("ascii", 0, 4), "RIFF")
})

test("resolution during audio preparation cannot emit a stale banner or sound", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "reviewer-canceled-audio-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, "attention.wav"), fixtureWav(1000, 160000))
  const f = fakeProcesses(), abort = new AbortController()
  const backend = new LinuxNotifications({ notify: true, notifySound: true, notificationSoundDirectory: directory },
    () => {}, f.processes, null)
  const pending = backend.show({ ...message, sound: true }, abort.signal)
  abort.abort()
  assert.equal(await pending, undefined)
  assert.equal(f.calls.length, 0)
  await backend.dispose()
})

test("a canceled banner cannot poison the shared preparation needed by the next attention sound", async () => {
  const f = fakeProcesses()
  const audio = new NotificationAudio(f.processes, undefined, {
    attention: { format: "wav", data: fixtureWav(1000, 160000).toString("base64") },
  })
  const first = new AbortController()
  const abandoned = audio.play("attention", first.signal)
  await settle(); first.abort()
  await Promise.all([abandoned, audio.play("attention", new AbortController().signal)])
  assert.equal(f.calls.filter(c => c.command === "paplay").length, 1)
  await audio.dispose()
})

test("owned processes preserve argv, consume spawn failure, cap output and force-kill aborted jobs", async () => {
  const processes = new OwnedNotificationProcesses()
  const signal = new AbortController().signal
  const literal = "space ; $(not-executed)"
  const task = processes.start(process.execPath, ["-e", "process.stdout.write(process.argv[1])", literal], 1000, signal)!
  assert.deepEqual(await task.result, { code: 0, stdout: literal })
  const missing = processes.start("/nonexistent/desktop-utility", [], 1000, signal)!
  assert.notEqual((await missing.result).code, 0)
  const large = processes.start(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], 1000, signal)!
  assert.ok((await large.result).stdout.length <= 16384)
  const abort = new AbortController()
  const stalled = processes.start(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], 1000, abort.signal,
    line => { if (line === "ready") abort.abort() })!
  assert.equal((await stalled.result).code, null)
  processes.dispose(); assert.equal(processes.start(process.execPath, [], 1000, signal), undefined)
})
