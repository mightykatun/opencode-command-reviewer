import { test } from "node:test"
import assert from "node:assert/strict"
import { AssessmentFormatError, MAX_ASSESSMENT_BYTES, StreamingAssessment } from "../src/streaming-assessment.js"
import { parseAssessment } from "../src/reviewer.js"

test("incremental assessment matches the final contract across every character split and field order", () => {
  const inputs = [
    '{"safe":true,"desc":"Text 🍐 café\\n\\t\\b\\f\\r\\/\\\\\\\" \\uD83C\\uDF50."}',
    ' \r\n{ "d\\u0065sc" : "**Effects**\\n\\n- Writes `note`." , "saf\\u0065": false } \t',
    '{"desc":"x","safe":false}',
  ]
  for (const text of inputs) {
    const expected = JSON.parse(text)
    for (let split = 0; split <= text.length; split++) {
      const parser = new StreamingAssessment()
      parser.push(text.slice(0, split))
      parser.push(text.slice(split))
      assert.deepEqual(parser.finish(), expected)
      assert.equal(parser.content, text)
    }
    const parser = new StreamingAssessment()
    for (let i = 0; i < text.length; i++) {
      parser.push(text[i]!)
      const preview = parser.preview()
      if (preview?.desc !== undefined) {
        assert.ok(expected.desc.startsWith(preview.desc))
        assert.doesNotMatch(preview.desc, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "prefix must never expose an isolated surrogate")
      }
    }
    assert.deepEqual(parser.finish(), expected)
  }
})

test("boolean preview waits for a complete token boundary, including false and invalid suffixes", () => {
  for (const literal of ["true", "false"]) for (const boundary of [",", " ", "\r", "\n", "\t", "}"]) {
    const parser = new StreamingAssessment()
    parser.push('{"safe":')
    for (const char of literal) { parser.push(char); assert.equal(parser.preview()?.safe, undefined) }
    parser.push(boundary)
    assert.equal(parser.preview()?.safe, literal === "true")
  }
  for (const text of ["truex", "false0", "truE", "true:", "true\u00a0"]) {
    const parser = new StreamingAssessment()
    for (const char of '{"safe":' + text) {
      parser.push(char)
      assert.equal(parser.preview()?.safe, undefined)
    }
    assert.throws(() => parser.finish(), AssessmentFormatError)
  }
})

test("unfinished escapes and surrogate pairs are held until a complete decoded character exists", () => {
  const parser = new StreamingAssessment()
  parser.push('{"safe":true,"desc":"a\\')
  assert.deepEqual(parser.preview(), { safe: true, desc: "a" })
  for (const char of "uD83C") { parser.push(char); assert.equal(parser.preview()?.desc, "a") }
  for (const char of "\\uDF5") { parser.push(char); assert.equal(parser.preview()?.desc, "a") }
  parser.push("0")
  assert.equal(parser.preview()?.desc, "a🍐")
  parser.push('"}')
  assert.deepEqual(parser.finish(), { safe: true, desc: "a🍐" })
  const copy = parser.preview()!
  copy.safe = false
  assert.equal(parser.finish().safe, true)
})

test("duplicate fields including escaped spellings are rejected by both full and incremental paths", () => {
  for (const text of [
    '{"safe":true,"safe":false,"desc":"x"}',
    '{"safe":true,"s\\u0061fe":true,"desc":"x"}',
    '{"desc":"a","safe":true,"d\\u0065sc":"b"}',
    '{"\\u0073afe":true,"desc":"x","safe":true}',
  ]) {
    for (let split = 0; split <= text.length; split++) {
      const parser = new StreamingAssessment()
      parser.push(text.slice(0, split))
      parser.push(text.slice(split))
      assert.equal(parser.preview(), undefined)
      assert.throws(() => parser.finish(), /Duplicate assessment field/)
    }
    assert.throws(() => parseAssessment(text), /Duplicate assessment field/)
  }
})

test("invalid JSON/schema and unpaired surrogates fail only at final validation; valid strings preserve Markdown", () => {
  for (const text of ["", "[]", "null", "true", "{}", '{"safe":true}', '{"desc":"x"}',
    '{"safe":true,"desc":" "}', '{"safe":true,"desc":null}', '{"safe":1,"desc":"x"}',
    '{"safe":true,"desc":"x",}', '{"safe":true,"desc":"x"} trailing',
    '{"safe":true,"desc":"x","other":0}', '{"safe":true,"desc":"x"}{"safe":false,"desc":"y"}',
    '{"safe":true,"desc":"\\q"}', '{"safe":true,"desc":"\\u00X0"}', '{"safe":true,"desc":"raw\nnewline"}',
    '{"safe":true,"desc":"\\uD800"}', '{"safe":true,"desc":"\\uDC00"}', '{"safe":true,"desc":"\\uD800x"}',
    '{"safe":true,"desc":"\ud800"}', '{"safe":true,"desc":"\udc00"}', '{"safe":true,"desc":"x\\',
  ]) {
    const parser = new StreamingAssessment()
    assert.doesNotThrow(() => { for (const char of text) parser.push(char) })
    assert.throws(() => parser.finish(), AssessmentFormatError, text)
    assert.throws(() => parseAssessment(text), AssessmentFormatError, text)
  }
  assert.deepEqual(parseAssessment('{"safe":true,"desc":"  **Safe**\\n\\n`cat file`  "}'), { safe: true, desc: "**Safe**\n\n`cat file`" })
})

test("assessment byte bounds are UTF-8 accurate across literal surrogate splits and apply after syntax errors", () => {
  const prefix = '{"safe":true,"desc":"', suffix = '"}'
  const text = prefix + "x".repeat(MAX_ASSESSMENT_BYTES - prefix.length - suffix.length - 4) + "🍐" + suffix
  assert.equal(Buffer.byteLength(text), MAX_ASSESSMENT_BYTES)
  const parser = new StreamingAssessment()
  for (let i = 0; i < text.length; i++) parser.push(text[i]!)
  assert.equal(parser.finish().desc.endsWith("🍐"), true)
  assert.throws(() => parser.push(" "), /assessment exceeds 64 KiB/)
  const bad = new StreamingAssessment()
  bad.push("x".repeat(MAX_ASSESSMENT_BYTES))
  assert.throws(() => bad.push("x"), /assessment exceeds 64 KiB/)
})
