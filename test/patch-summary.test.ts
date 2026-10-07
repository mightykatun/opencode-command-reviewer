import { test } from "node:test"
import assert from "node:assert/strict"
import { patchOperations } from "../src/patch-summary.js"
import { collectDirectoryEvidence } from "../src/tool-evidence.js"
import { withDeadline } from "../src/deadline.js"
import type { DirectoryContext } from "../src/types.js"

const signal = () => new AbortController().signal
const limits = { maxFiles: 1, maxEvidenceBytes: 4096 }
const context = (patchText: string): DirectoryContext => ({
  kind: "external-directory", tool: "apply_patch", native: true, input: { patchText },
  location: { instanceDirectory: "/project", instanceWorktree: "/project" },
  userPrompt: "Update the neighboring project", limitations: [],
  permission: { id: "p", type: "external_directory", patterns: ["/outside/*"], always: ["/outside/*"],
    metadata: { filepath: "/outside/target", parentDir: "/outside" }, tool: { messageID: "m", callID: "c" } },
})
const envelope = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`

test("directory evidence distinguishes patch add, update, delete and move without contents or target reads", () => {
  const patches = ["*** Add File: /outside/target\n+PRIVATE-BODY", "*** Update File: /outside/target\n@@\n-before\n+PRIVATE-BODY",
    "*** Delete File: /outside/target", "*** Update File: /outside/target\n*** Move to: ../destination\n@@\n-before\n+PRIVATE-BODY"]
  const expected = [
    { operation: "add", path: "/outside/target" }, { operation: "update", path: "/outside/target" },
    { operation: "delete", path: "/outside/target" }, { operation: "move", path: "/outside/target", movePath: "../destination" },
  ]
  for (const [index, body] of patches.entries()) {
    const result = collectDirectoryEvidence(context(envelope(body)), limits, signal())
    assert.deepEqual(result.operation.patchOperations, [expected[index]])
    assert.deepEqual(result.operation.input, {})
    assert.equal(result.partial, true)
    assert.deepEqual(result.permission.patterns, ["/outside/*"])
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-BODY|patchText|@@/)
  }
})

test("patch summary preserves repeated operations and relative paths independently of maxFiles", () => {
  const body = "*** Add File: ../link/../a\n+text\n*** Delete File: b\n*** Update File: b\n*** Move to: c\n@@\n-old\n+new"
  const result = collectDirectoryEvidence(context(envelope(body)), limits, signal())
  assert.deepEqual(result.operation.patchOperations, [
    { operation: "add", path: "../link/../a" }, { operation: "delete", path: "b" }, { operation: "move", path: "b", movePath: "c" },
  ])
})

test("header extraction follows host column, marker, CRLF, wrapper and immediate move semantics", () => {
  const patchText = "cat <<'PATCH'\r\n  *** Begin Patch  \r\n*** Add File:  a  \r\n+*** Delete File: not-a-header\r\n *** Delete File: also-not-a-header\r\n*** Update File:b\r\n\r\n*** Move to: not-immediate\r\n@@\r\n-context\r\n+new\r\n*** Update File:c\r\n*** Move to:  d  \r\n*** Update File:e\r\n*** Move to: \r\n  *** End Patch  \r\n*** Delete File: after-end\r\nPATCH"
  assert.deepEqual(patchOperations({ patchText }, signal()), [
    { operation: "add", path: "a" }, { operation: "update", path: "b" },
    { operation: "move", path: "c", movePath: "d" }, { operation: "update", path: "e" },
  ])
})

test("missing or incomplete patch action data fails instead of returning an empty summary", () => {
  for (const patchText of [undefined, 1, "", "*** Add File: x", envelope(""), envelope("*** Delete File: "),
    "*** Begin Patch\n*** Delete File: x", "*** End Patch\n*** Begin Patch\n*** Delete File: x\n*** End Patch"]) {
    assert.throws(() => patchOperations({ patchText }, signal()), /Patch operation summary/)
  }
  let touched = false
  const input = { get patchText() { touched = true; return envelope("*** Delete File: x") } }
  assert.throws(() => patchOperations(input, signal()), /host-recorded patchText/)
  assert.equal(touched, false)
})

test("body scan and mandatory summary budgets fail explicitly without truncating operations", () => {
  const body = "x".repeat(10000)
  const small = collectDirectoryEvidence(context(envelope(`*** Add File: a\n+${body}`)), limits, signal())
  assert.doesNotMatch(JSON.stringify(small), /xxxx/)
  assert.throws(() => collectDirectoryEvidence(context(envelope(`*** Delete File: ${body}`)), limits, signal()), /byte budget/)
  for (const patchText of ["x".repeat(16 * 1024 * 1024 + 1), "é".repeat(9 * 1024 * 1024)]) {
    assert.throws(() => patchOperations({ patchText }, signal()), /16 MiB scan limit/)
  }
  assert.throws(() => patchOperations({ patchText: envelope(`*** Add File: a\n${"+\n".repeat(65536)}`) }, signal()), /line scan limit/)
  assert.throws(() => patchOperations({ patchText: envelope("*** Delete File: a\n".repeat(16385)) }, signal()), /structure limits/)
  assert.throws(() => collectDirectoryEvidence(context(envelope("*** Delete File: a\n".repeat(6000))),
    { ...limits, maxEvidenceBytes: 1_000_000 }, signal()), /structure limits/)
})

test("patch summaries respect parent aborts and expired monotonic review deadlines", async () => {
  const input = { patchText: envelope("*** Delete File: x") }
  assert.throws(() => patchOperations(input, AbortSignal.abort()), { name: "AbortError" })
  await assert.rejects(withDeadline(signal(), 10, async s => {
    const until = performance.now() + 20
    while (performance.now() < until) { /* Delay timer delivery. */ }
    patchOperations(input, s)
  }), /timed out/)
})
