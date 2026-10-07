import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_SSE_EVENT_BYTES, MAX_SSE_EVENTS, MAX_SSE_WIRE_BYTES, SSEParser, type SSEEvent } from "../src/sse.js"

test("SSE comments, fields, multiline data, BOM and LF/CRLF/CR framing work at every byte split", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const bytes = Buffer.from(["\uFEFF: comment", "id: ignored", "retry: 10", "unknown: ignored", "event: message",
      'data: {"desc":', 'data: "🍐 café"}', "", "event:", "data:  preserves extra space", "data", "", ""].join(eol))
    const expected = [{ event: "message", data: '{"desc":\n"🍐 café"}' }, { event: "message", data: " preserves extra space\n" }]
    for (let split = 0; split <= bytes.length; split++) {
      const events: SSEEvent[] = []
      const parser = new SSEParser((event) => events.push(event))
      parser.push(bytes.subarray(0, split))
      parser.push(bytes.subarray(split))
      parser.finish()
      assert.deepEqual(events, expected)
    }
    const events: SSEEvent[] = []
    const parser = new SSEParser((event) => events.push(event))
    for (const byte of bytes) parser.push(Uint8Array.of(byte))
    parser.finish()
    assert.deepEqual(events, expected)
  }
})

test("fatal UTF-8 and truncated events never erase already dispatched usage in the same chunk", () => {
  const good = Buffer.from('data: {"usage":{"cost":0.01},"choices":[]}\n\n')
  for (const bad of [Buffer.from([0xff]), Buffer.from([0xe2, 0x28, 0xa1]), Buffer.from([0xf0, 0x9f]), Buffer.from([0xed, 0xa0, 0x80])]) {
    const events: SSEEvent[] = []
    const parser = new SSEParser((event) => events.push(event))
    assert.throws(() => { parser.push(Buffer.concat([good, bad])); parser.finish() }, /invalid UTF-8/)
    assert.equal(events.length, 1)
    assert.equal(JSON.parse(events[0]!.data).usage.cost, 0.01)
  }
  for (const text of ["data: [DONE]", "data: [DONE]\n", "event: error\n", "data: {}\r"]) {
    const events: SSEEvent[] = []
    const parser = new SSEParser((event) => events.push(event))
    parser.push(Buffer.from(text))
    assert.throws(() => parser.finish(), /mid-event/)
    assert.deepEqual(events, [])
  }
})

test("SSE limits include comments, unknown fields, empty events and all wire bytes", () => {
  for (const field of [":", "data:", "unknown:"]) {
    const parser = new SSEParser(() => {})
    parser.push(Buffer.from(field + "x".repeat(MAX_SSE_EVENT_BYTES - field.length - 2) + "\n\n"))
    parser.finish()
    const oversized = new SSEParser(() => {})
    assert.throws(() => oversized.push(Buffer.from(field + "x".repeat(MAX_SSE_EVENT_BYTES) + "\n\n")), /event exceeds 64 KiB/)
  }
  const crlf = new SSEParser(() => {})
  crlf.push(Buffer.from(":" + "x".repeat(MAX_SSE_EVENT_BYTES - 5) + "\r\n\r\n"))
  crlf.finish()
  const oversizedCRLF = new SSEParser(() => {})
  assert.throws(() => oversizedCRLF.push(Buffer.from(":" + "x".repeat(MAX_SSE_EVENT_BYTES - 4) + "\r\n\r\n")), /event exceeds 64 KiB/)
  const events = new SSEParser(() => {})
  events.push(Buffer.from("\n".repeat(MAX_SSE_EVENTS)))
  assert.throws(() => events.push(Buffer.from("\n")), /exceeds 65536 events/)
  const wire = new SSEParser(() => {})
  const comment = Buffer.from(":" + "x".repeat(1021) + "\n\n")
  for (let i = 0; i < MAX_SSE_WIRE_BYTES / comment.length; i++) wire.push(comment)
  assert.throws(() => wire.push(Buffer.from("\n")), /wire exceeds 4 MiB/)
})

test("SSE callback errors stop further event dispatch and parser cannot be reused after EOF", () => {
  let calls = 0
  const error = new Error("bad event")
  const parser = new SSEParser(() => { calls++; throw error })
  assert.throws(() => parser.push(Buffer.from("data: a\n\ndata: b\n\n")), (value) => value === error)
  assert.equal(calls, 1)
  const finished = new SSEParser(() => {})
  finished.finish()
  assert.throws(() => finished.push(Buffer.from("\n")), /already ended/)
  assert.throws(() => finished.finish(), /already ended/)
})
