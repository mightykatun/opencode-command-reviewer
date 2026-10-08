import { test } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import { NotificationPolicy } from "../src/notification-policy.js"
import { parseNotificationConfig } from "../src/notification-config.js"
import { notificationMarkup, notificationText, type NotificationMessage } from "../src/notification-types.js"
import type { View } from "../src/controller.js"

const target = { root: "root", sessionID: "root", title: "Fixture title" }
const view = (id = "a", status: View["status"] = "analyzing", safe = true): View => ({
  request: { id, sessionID: "root", permission: "bash", patterns: ["command"], always: [], metadata: {} },
  status, ...(status === "complete" ? { assessment: { safe, desc: "Fixture" } } : {}),
})
function fixture(auto = false, notify = true, sound = true) {
  let now = 0
  const timers = new Set<{ at: number; callback: () => void }>()
  const messages: NotificationMessage[] = [], closed: string[] = []
  const policy = new NotificationPolicy({ notify, notifySound: sound }, auto, {
    async show(message, signal) {
      assert.equal(signal.aborted, false)
      messages.push(message)
      return { close: () => { closed.push(message.title) } }
    }, dispose() {},
  }, { now: () => now, after(ms, callback) {
    const timer = { at: now + ms, callback }; timers.add(timer)
    return () => { timers.delete(timer) }
  } })
  return { policy, messages, closed, async advance(ms: number) {
    now += ms
    for (const timer of [...timers]) if (timer.at <= now && timers.delete(timer)) timer.callback()
    await settle()
  }, add(v = view()) { policy.snapshot([v]); policy.permission(v.request, target, true) } }
}

test("notification settings are independently strict, default on, and use absolute sound paths", () => {
  assert.deepEqual(parseNotificationConfig(), { notify: true, notifySound: true, notificationSoundDirectory: undefined })
  for (const name of ["notify", "notifySound"]) for (const value of [null, "true", 0, [], {}]) {
    assert.throws(() => parseNotificationConfig({ [name]: value }), new RegExp(`${name} must be a boolean`))
  }
  for (const value of ["relative", "", "/bad\0path", 2, null]) assert.throws(() => parseNotificationConfig({ notificationSoundDirectory: value }))
  assert.equal(parseNotificationConfig({ notificationSoundDirectory: "/custom sounds" }).notificationSoundDirectory, "/custom sounds")
  assert.equal(notificationMarkup("<name>&\u001b\u202e"), "&lt;name&gt;&amp;")
  assert.equal(notificationText("x".repeat(500)).length, 256)
})

test("questions notify immediately, baseline and repeated asks stay silent, resolution withdraws", async () => {
  const f = fixture()
  f.policy.question("old", target, false); f.policy.question("old", target, true)
  f.policy.question("new", target, true); f.policy.question("new", target, true)
  await settle()
  assert.deepEqual(f.messages.map(m => m.title), ["Session needs attention"])
  f.policy.resolved("question", "new")
  assert.equal(f.closed.length, 1)
  f.policy.dispose()
})

test("advisory waits for final assessments, including safe, and ignores previews and baseline permissions", async () => {
  const f = fixture(); f.add()
  f.policy.snapshot([{ ...view(), progress: { attempt: 0, phase: "streaming", preview: { safe: false } } }])
  await settle(); assert.equal(f.messages.length, 0)
  f.policy.snapshot([view("a", "complete")]); await settle()
  f.policy.snapshot([view("a", "complete")]); await settle()
  assert.equal(f.messages.length, 1)
  f.policy.permission(view("old").request, target, false)
  f.policy.snapshot([view("a", "complete"), view("old", "complete", false)])
  await settle(); assert.equal(f.messages.length, 1)
  f.policy.dispose()
})

for (const status of ["unrelated", "unidentified", "unavailable", "suspended"] as const) {
  test(`${status} manual fallback produces one attention episode`, async () => {
    const f = fixture(true); f.add(view("a", status)); await settle()
    f.policy.snapshot([view("a", status)]); await settle()
    assert.equal(f.messages.length, 1); assert.equal(f.messages[0]?.kind, "attention")
    f.policy.dispose()
  })
}

test("safe render grace checks current state, silent countdown withdraws attention, cancellation renews it", async () => {
  const f = fixture(true); f.add(view("a", "complete"))
  await f.advance(999); assert.equal(f.messages.length, 0)
  await f.advance(1); assert.equal(f.messages[0]?.kind, "attention")
  const countdown: View = { ...view("a", "complete"), autoApproval: { status: "countdown", seconds: 15 } }
  f.policy.snapshot([countdown]); await settle()
  assert.equal(f.messages.length, 1)
  assert.equal(f.closed.length, 1)
  f.policy.snapshot([{ ...countdown, autoApproval: { status: "countdown", seconds: 14 } }]); await settle()
  assert.equal(f.messages.length, 1)
  f.policy.snapshot([{ ...countdown, autoApproval: { status: "cancelled" } }]); await settle()
  assert.equal(f.messages[1]?.kind, "attention"); assert.equal(f.closed.length, 1)
  f.policy.resolved("permission", "a"); assert.equal(f.closed.length, 2)
  f.policy.dispose()
})

test("normal final rendering and request resolution cancel the grace timer", async () => {
  const f = fixture(true); f.add(view("a", "complete"))
  f.policy.snapshot([{ ...view("a", "complete"), autoApproval: { status: "countdown", seconds: 15 } }])
  await f.advance(1000)
  assert.deepEqual(f.messages, [])
  f.policy.snapshot([]); await f.advance(2000)
  assert.equal(f.messages.length, 0); f.policy.dispose()
})

test("uncertain writes wait for reconciliation, and confirmed pending failure notifies only once", async () => {
  const f = fixture(true); f.add(view("a", "complete"))
  const failed: View = { ...view("a", "complete"), autoApproval: { status: "failed" } }
  f.policy.snapshot([failed]); await f.advance(1000); assert.equal(f.messages.length, 0)
  f.policy.snapshot([{ ...failed, approvalPendingConfirmed: true }]); await settle()
  f.policy.snapshot([{ ...failed, approvalPendingConfirmed: true }]); await settle()
  assert.equal(f.messages.length, 1); assert.equal(f.closed.length, 0)
  f.policy.dispose()
})

test("zero-delay success requires its explicit fact, not countdown or request disappearance", async () => {
  const f = fixture(true); f.add(view("a", "complete"))
  f.policy.snapshot([{ ...view("a", "complete"), autoApproval: { status: "countdown", seconds: 0 } }])
  await settle(); assert.equal(f.messages.length, 0)
  f.policy.snapshot([]); f.policy.approved(view().request, target); await settle()
  assert.equal(f.messages[0]?.title, "Reviewer approved a permission")
  f.policy.approved(view().request, target); await settle(); assert.equal(f.messages.length, 1)
  f.policy.dispose()
})

test("positive countdown stays silent through submission and only confirmed success plays approval", async () => {
  const f = fixture(true); f.add(view("a", "complete"))
  f.policy.snapshot([{ ...view("a", "complete"), autoApproval: { status: "countdown", seconds: 15 } }])
  await f.advance(1000)
  f.policy.snapshot([{ ...view("a", "complete"), autoApproval: { status: "countdown", seconds: 14 } }])
  await f.advance(14000)
  for (const status of ["checking", "allowing"] as const) {
    f.policy.snapshot([{ ...view("a", "complete"), autoApproval: { status } }])
    await settle()
  }
  assert.equal(f.messages.length, 0, "no banner or sound before acknowledgement")
  f.policy.approved(view().request, target); f.policy.snapshot([]); await settle()
  f.policy.approved(view().request, target); await settle()
  assert.deepEqual(f.messages.map(m => [m.kind, m.title, m.sound]), [
    ["approved", "Reviewer approved a permission", true],
  ])
  f.policy.dispose()
})

test("every reviewer banner is delivered but its audio is rate limited without suppressing attention", async () => {
  const f = fixture(true)
  for (const id of ["a", "b"]) f.policy.approved(view(id).request, target)
  f.policy.question("q", target, true); await settle()
  assert.deepEqual(f.messages.map(m => [m.kind, m.sound]), [["approved", true], ["approved", false], ["attention", true]])
  await f.advance(2000); f.policy.approved(view("c").request, target); await settle()
  assert.equal(f.messages[3]?.sound, true); f.policy.dispose()
})

test("turn outcomes deduplicate across error/idle; disable, mute, disposal and late handles are isolated", async () => {
  const f = fixture(false, true, false)
  f.policy.turn("error", "turn", target); f.policy.turn("ended", "turn", target)
  f.policy.turn("ended", "other", target); await settle()
  assert.deepEqual(f.messages.map(m => [m.title, m.sound]), [["Session error", false], ["Session ended", false]])
  f.policy.dispose(); f.policy.question("late", target, true); await settle(); assert.equal(f.messages.length, 2)
  const disabled = fixture(false, false)
  disabled.policy.question("new", target, true); disabled.policy.turn("error", "turn", target)
  await settle(); assert.equal(disabled.messages.length, 0); disabled.policy.dispose()
  let release!: (value: { close(): void }) => void
  let closed = 0
  const policy = new NotificationPolicy({ notify: true, notifySound: true }, false, {
    show: () => new Promise(resolve => { release = resolve }), dispose() {},
  })
  policy.question("q", target, true); await settle(); policy.resolved("question", "q")
  release({ close() { closed++ } }); await settle(); assert.equal(closed, 1); policy.dispose()
})
