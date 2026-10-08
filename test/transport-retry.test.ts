import { test } from "node:test"
import assert from "node:assert/strict"
import { httpFailure, networkFailure, retryAfter, TransportRetries } from "../src/transport-retry.js"
import { withDeadline } from "../src/deadline.js"

test("Retry-After accepts seconds and HTTP dates without treating malformed delays as dates", () => {
  const now = Date.UTC(2026, 9, 8, 12)
  for (const [value, expected] of [[null, 0], ["0", 0], [" 2 ", 2000], ["Thu, 08 Oct 2026 12:00:02 GMT", 2000],
    ["Thursday, 08-Oct-26 12:00:02 GMT", 2000], ["Thu Oct  8 12:00:02 2026", 2000],
    ["Thu, 08 Oct 2026 11:00:00 GMT", 0], ["garbage", 0], ["-1", 0], ["1.5", 0], ["1e3", 0], ["2026", 2026000]] as const) {
    assert.equal(retryAfter(value, now), expected, String(value))
  }
  assert.equal(retryAfter("9".repeat(400), now), Infinity, "huge valid cooldowns must not become immediate retries")
})

test("transport retry budget is shared, backoff is bounded, and raw errors stay private", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const retries = new TransportRetries(), signal = new AbortController().signal
  const transient = networkFailure(new TypeError("PRIVATE", { cause: Object.assign(new Error("PRIVATE"), { code: "ECONNRESET" }) }), "Reviewer network request failed")
  assert.equal(transient.message, "Reviewer network request failed")
  assert.equal(transient.cause, undefined)
  for (let i = 0; i < 2; i++) {
    let done = false
    const wait = retries.wait(transient, signal).then(value => { done = true; return value })
    t.mock.timers.tick(249 * 2 ** i)
    await Promise.resolve()
    assert.equal(done, false)
    t.mock.timers.tick(501 * 2 ** i)
    assert.equal(await wait, true)
  }
  assert.equal(await retries.wait(transient, signal), false)
})

test("terminal transport errors do not sleep, retry or reveal provider details", async () => {
  const errors = [new TypeError("PRIVATE"), Object.assign(new Error("PRIVATE"), { code: "CERT_HAS_EXPIRED" }),
    { code: "ERR_TLS_CERT_ALTNAME_INVALID", cause: { code: "ECONNRESET" } }, { code: "ENOTFOUND" }, { code: "ABORT_ERR" }]
  const retries = new TransportRetries(), signal = new AbortController().signal
  for (const error of errors) assert.equal(await retries.wait(networkFailure(error, "Reviewer network request failed"), signal), false)
  for (const status of [400, 401, 403, 404, 409, 422, 501, 505]) {
    assert.equal(await retries.wait(httpFailure(new Response(null, { status })), signal), false)
  }
})

test("provider cooldowns never extend the review or cause an early retry", async () => {
  for (const value of ["100", "9".repeat(400), new Date(Date.now() + 60000).toUTCString()]) {
    await withDeadline(new AbortController().signal, 1000, async signal => {
      assert.equal(await new TransportRetries().wait(httpFailure(new Response(null, { status: 429, headers: { "Retry-After": value } })), signal), false)
    })
  }
})

test("a provider cooldown takes precedence over exponential backoff", async () => {
  const start = performance.now()
  assert.equal(await new TransportRetries().wait(httpFailure(new Response(null, { status: 429,
    headers: { "Retry-After": "1" } })), new AbortController().signal), true)
  assert.ok(performance.now() - start >= 990)
})

test("canceling transport backoff propagates the original reason immediately", async () => {
  const abort = new AbortController(), reason = new Error("canceled")
  const pending = new TransportRetries().wait(httpFailure(new Response(null, { status: 503 })), abort.signal)
  abort.abort(reason)
  await assert.rejects(pending, error => error === reason)
})
