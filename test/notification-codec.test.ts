import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { normalizedSound, SOUND_PEAK, SOUND_RMS } from "../src/notification-codec.js"
import { fixtureWav } from "./notification-fixtures.js"
function stats(bytes: Buffer) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF"); assert.equal(bytes.toString("ascii", 8, 12), "WAVE")
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44)
  let square = 0, peak = 0
  for (let i = 44; i < bytes.length; i += 2) {
    const x = bytes.readInt16LE(i) / 32768
    square += x * x; peak = Math.max(peak, Math.abs(x))
  }
  return { rms: Math.sqrt(square / ((bytes.length - 44) / 2)), peak }
}

test("quiet and loud WAV signals converge to the same RMS without modifying originals", async () => {
  for (const amplitude of [20, 1000, 30000]) {
    const input = fixtureWav(amplitude), original = Buffer.from(input)
    const pcm = await normalizedSound(input, "wav", new AbortController().signal)
    assert.deepEqual(input, original)
    assert.ok(Math.abs(stats(pcm).rms - SOUND_RMS) < 0.0001)
    assert.ok(stats(pcm).peak <= SOUND_PEAK)
  }
})

test("silence stays silent; sparse transients respect the peak ceiling", async () => {
  const silence = await normalizedSound(fixtureWav(0), "wav", new AbortController().signal)
  assert.deepEqual(stats(silence), { rms: 0, peak: 0 })
  const spike = fixtureWav(0); spike.writeInt16LE(32767, 44)
  const pcm = await normalizedSound(spike, "wav", new AbortController().signal)
  assert.ok(stats(pcm).peak <= SOUND_PEAK + 1 / 32768)
})

test("all six bundled MP3 assets decode, normalize and yield while the event loop stays responsive", async () => {
  let turns = 0
  const tick = setInterval(() => { turns++ }, 1)
  try {
    for (const kind of ["attention", "unsafe", "question", "approved", "error", "ended"]) {
      const bytes = await readFile(new URL(`../sounds/${kind}.mp3`, import.meta.url))
      const pcm = await normalizedSound(bytes, "mp3", new AbortController().signal)
      const measured = stats(pcm)
      assert.ok(measured.rms > 0.01 && measured.rms <= SOUND_RMS + 0.0001, kind)
      assert.ok(measured.peak <= SOUND_PEAK + 1 / 32768, kind)
      assert.ok(pcm.length > 1000, kind)
    }
  } finally { clearInterval(tick) }
  assert.ok(turns > 0)
})

test("malformed WAV, excessive duration, invalid floats and parent cancellation fail without playback", async () => {
  const signal = new AbortController().signal
  const bad = fixtureWav(); bad.writeUInt32LE(0xffffffff, 40)
  await assert.rejects(normalizedSound(bad, "wav", signal))
  await assert.rejects(normalizedSound(fixtureWav(1000, 160001), "wav", signal))
  const float = fixtureWav(); float.writeUInt16LE(3, 20); float.writeUInt16LE(32, 34)
  float.writeUInt16LE(4, 32); float.writeUInt32LE(64000, 28); float.writeFloatLE(Infinity, 44)
  await assert.rejects(normalizedSound(float, "wav", signal))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(normalizedSound(fixtureWav(), "wav", abort.signal))
})
