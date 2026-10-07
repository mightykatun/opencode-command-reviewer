import { test } from "node:test"
import type { TestContext } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseConfig } from "../src/config.js"
import { parseAssessment, review, withDeadline } from "../src/reviewer.js"
import { BUILTIN_PROMPTS, CONTRACT, CORRECTION, loadPrompts } from "../src/prompts.js"
import { collectEditEvidence } from "../src/evidence.js"
import type { Evidence, ReviewEvidence } from "../src/types.js"
import type { Usage } from "../src/usage.js"

const evidence: Evidence = {
  kind: "shell",
  command: "python fruits.py", cwd: "/external", userPrompt: "Count fruits",
  files: [{ filename: "fruits.py", status: "captured", contents: "print('pear')" }], limitations: [],
  permission: { id: "request", type: "bash", patterns: ["python fruits.py"], always: ["python *"], metadata: { command: "python fruits.py", workdir: "/external" }, tool: { messageID: "m", callID: "c" } },
  session: { root: { id: "root", parentID: null, directory: "/project/start", projectID: "repo", workspaceID: null }, current: null, currentProject: null, rootProject: { id: "repo", worktree: "/project", vcs: "git", name: "Initial repo" } },
  execution: { tool: "bash", requestedWorkdir: "/external", instanceDirectory: "/project/start", instanceWorktree: "/project", cwdSource: "absolute tool.workdir", canonicalCwd: "/external" },
}
const signal = () => new AbortController().signal
const envelope = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

async function endpoint(t: TestContext, handler: (index: number, res: ServerResponse) => void) {
  const requests: { body: Record<string, any>; authorization?: string; target?: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    requests.push({ body: JSON.parse(body), authorization: req.headers.authorization, target: req.url })
    handler(requests.length - 1, res)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return { requests, config: parseConfig({ baseURL: `http://127.0.0.1:${address.port}/v1`, model: "fixture" }) }
}

test("config defaults, URL handling, credentials, and invalid settings", () => {
  const cfg = parseConfig({ baseURL: "http://localhost:1234/v1/", model: "small" })
  assert.equal(cfg.baseURL, "http://localhost:1234/v1")
  assert.equal(cfg.timeoutMs, 30000)
  assert.equal(cfg.formatRetries, 1)
  assert.equal(cfg.maxFiles, 6)
  assert.equal(cfg.maxEvidenceBytes, 131072)
  assert.equal(cfg.reviewBash, true)
  assert.equal(cfg.reviewEdits, true)
  assert.equal(cfg.reviewMcp, false)
  assert.equal(cfg.reviewCustomTools, false)
  assert.equal(cfg.reviewExternalDirectories, false)
  assert.equal(cfg.autoApprove, false)
  assert.equal(cfg.autoApproveDelaySeconds, 15)
  for (const override of [ { baseURL: "file:///tmp" }, { baseURL: "https://secret@example.org" }, { model: "" }, { apiKeyEnv: "bad name" }, { timeoutMs: 0 }, { formatRetries: -1 }, { formatRetries: 1.2 }, { retries: 3 } ]) {
    assert.throws(() => parseConfig({ baseURL: "http://localhost/v1", model: "m", ...override }))
  }
})

test("review switches are independent strict booleans with enabled defaults", () => {
  const options = { baseURL: "http://localhost/v1", model: "m" }
  for (const reviewBash of [true, false]) for (const reviewEdits of [true, false]) {
    const config = parseConfig({ ...options, reviewBash, reviewEdits })
    assert.equal(config.reviewBash, reviewBash)
    assert.equal(config.reviewEdits, reviewEdits)
  }
  for (const name of ["reviewBash", "reviewEdits", "reviewMcp", "reviewCustomTools", "reviewExternalDirectories", "autoApprove"] as const) {
    assert.equal(parseConfig({ ...options, [name]: undefined })[name], name === "reviewBash" || name === "reviewEdits")
    for (const value of [true, false]) assert.equal(parseConfig({ ...options, [name]: value })[name], value)
    for (const value of [null, 0, 1, "true", "false", {}, []]) {
      assert.throws(() => parseConfig({ ...options, [name]: value }), { message: `${name} must be a boolean` })
    }
  }
})

test("numeric settings default only on omission and enforce integer boundaries before transport", async (t) => {
  for (const [name, fallback, min, max] of [
    ["formatRetries", 1, 0, 100],
    ["timeoutMs", 30000, 1, 3600000],
    ["maxFiles", 6, 1, 1000],
    ["maxEvidenceBytes", 131072, 1, 16 * 1024 * 1024],
    ["autoApproveDelaySeconds", 15, 0, 3600],
  ] as const) {
    await t.test(name, async (t) => {
      const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Unexpected."}')))
      const options = { baseURL: config.baseURL, model: config.model }
      assert.equal(parseConfig(options)[name], fallback)
      assert.equal(parseConfig({ ...options, [name]: undefined })[name], fallback)
      for (const value of [min, max]) assert.equal(parseConfig({ ...options, [name]: value })[name], value)
      let fetchCalls = 0
      const fetcher: typeof fetch = (...args) => { fetchCalls++; return fetch(...args) }
      for (const value of [null, min - 1, max + 1, min + 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "fixture-secret", false]) {
        await assert.rejects(async () => {
          const cfg = parseConfig({ ...options, [name]: value })
          await review(evidence, cfg, signal(), fetcher)
        }, { message: `${name} must be an integer between ${min} and ${max}` })
        assert.equal(fetchCalls, 0)
        assert.equal(requests.length, 0)
      }
    })
  }
})

test("strict boolean schema rejects coercion, fences, arrays, blank descriptions and extra keys", () => {
  assert.deepEqual(parseAssessment('{"safe":false,"desc":"  Prints credentials. "}'), { safe: false, desc: "Prints credentials." })
  for (const text of ['{"safe":"false","desc":"x"}', '{"safe":0,"desc":"x"}', '{"safe":true,"desc":" "}', '{"safe":true,"desc":"x","other":1}', '[]', 'null', '```json\n{"safe":true,"desc":"x"}\n```']) assert.throws(() => parseAssessment(text))
})

test("query and fragment base URLs fail before transport, including bare delimiters", async (t) => {
  for (const suffix of ["?", "?key=fixture", "#", "#fragment", "?#", "/?", "/#"]) {
    await t.test(suffix, async (t) => {
      const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Unexpected."}')))
      await assert.rejects(async () => {
        const cfg = parseConfig({ ...config, baseURL: `${config.baseURL}${suffix}` })
        await review(evidence, cfg, signal())
      }, { message: "baseURL must use HTTP(S) without embedded credentials, query, or fragment" })
      assert.deepEqual(requests.map((request) => request.target), [])
    })
  }
})

test("valid base URLs preserve encoded paths and normalize trailing slashes on the wire", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Counts fruits."}')))
  const origin = new URL(config.baseURL).origin
  for (const [path, target] of [
    ["", "/chat/completions"],
    ["/", "/chat/completions"],
    ["/v1", "/v1/chat/completions"],
    ["/v1/", "/v1/chat/completions"],
    ["/v1///", "/v1/chat/completions"],
    ["/v1/%3F%23%2F%20", "/v1/%3F%23%2F%20/chat/completions"],
    ["/v1/%3f%23%2f%20///", "/v1/%3f%23%2f%20/chat/completions"],
  ]) {
    const before = requests.length
    const cfg = parseConfig({ ...config, baseURL: `${origin}${path}` })
    assert.deepEqual(await review(evidence, cfg, signal()), { safe: true, desc: "Counts fruits." })
    assert.deepEqual(requests.slice(before).map((request) => request.target), [target])
  }
})

test("minimal and explicit successful assistant envelopes remain compatible", async (t) => {
  for (const [name, fields, messageFields] of [
    ["minimal", {}, {}],
    ["assistant role only", {}, { role: "assistant" }],
    ["stop reason only", { finish_reason: "stop" }, {}],
    ["assistant stop", { finish_reason: "stop" }, { role: "assistant" }],
    ["null optional calls", { finish_reason: "stop" }, { role: "assistant", function_call: null, tool_calls: null, refusal: null }],
    ["empty tool calls", { finish_reason: "stop" }, { role: "assistant", tool_calls: [] }],
  ] as const) {
    await t.test(name, async (t) => {
      const { config, requests } = await endpoint(t, (_, res) => res.end(JSON.stringify({
        choices: [{ ...fields, message: { ...messageFields, content: '{"safe":true,"desc":"Counts fruits."}' } }],
      })))
      assert.deepEqual(await review(evidence, config, signal()), { safe: true, desc: "Counts fruits." })
      assert.deepEqual(requests.map((request) => request.target), ["/v1/chat/completions"])
    })
  }
})

test("invalid completion metadata terminates before assessment parsing without retries", async (t) => {
  for (const [name, fields, messageFields] of [
    ["legacy function call", {}, { function_call: { name: "fixture", arguments: "{}" } }],
    ["empty legacy function call", {}, { function_call: {} }],
    ["false legacy function call", {}, { function_call: false }],
    ["string legacy function call", {}, { function_call: "" }],
    ["tool call", {}, { tool_calls: [{ type: "function", function: { name: "fixture", arguments: "{}" } }] }],
    ["object tool calls", {}, { tool_calls: {} }],
    ["array-like tool calls", {}, { tool_calls: { length: 0 } }],
    ["string tool calls", {}, { tool_calls: "" }],
    ["false tool calls", {}, { tool_calls: false }],
    ["numeric tool calls", {}, { tool_calls: 0 }],
    ["user role", {}, { role: "user" }],
    ["tool role", {}, { role: "tool" }],
    ["null role", {}, { role: null }],
    ["empty role", {}, { role: "" }],
    ["length finish", { finish_reason: "length" }, {}],
    ["filtered finish", { finish_reason: "content_filter" }, {}],
    ["tool-call finish", { finish_reason: "tool_calls" }, {}],
    ["function-call finish", { finish_reason: "function_call" }, {}],
    ["null finish", { finish_reason: null }, {}],
    ["empty finish", { finish_reason: "" }, {}],
    ["unknown finish", { finish_reason: "unknown" }, {}],
    ["refusal", {}, { refusal: "Cannot assess." }],
  ] as const) {
    await t.test(name, async (t) => {
      for (const content of ['{"safe":true,"desc":"Must not be accepted."}', "bad assessment format"]) {
        const { config, requests } = await endpoint(t, (_, res) => res.end(JSON.stringify({
          choices: [{ finish_reason: "stop", ...fields, message: { role: "assistant", content, ...messageFields } }],
        })))
        config.formatRetries = 2
        await assert.rejects(review(evidence, config, signal()), { message: "Reviewer API did not return a text assessment" })
        assert.deepEqual(requests.map((request) => request.target), ["/v1/chat/completions"])
      }
    })
  }
})

test("malformed assessment in an assistant stop envelope still gets format correction", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: index ? '{"safe":true,"desc":"Counts fruits."}' : "bad format" } }],
  })))
  assert.deepEqual(await review(evidence, config, signal()), { safe: true, desc: "Counts fruits." })
  assert.deepEqual(requests.map((request) => request.target), ["/v1/chat/completions", "/v1/chat/completions"])
  assert.deepEqual(requests[1]!.body.messages[2], { role: "assistant", content: "bad format" })
  assert.match(requests[1]!.body.messages[3].content, /Format validation failed: Invalid JSON/)
})

test("formatted descriptions preserve Markdown and decoded JSON newlines", () => {
  const desc = "**Effects**\n\n- Writes `result.txt`.\n- *Risk:* replaces its existing contents.\n\n```sh\nprintf hello\n```"
  assert.deepEqual(parseAssessment(JSON.stringify({ safe: false, desc })), { safe: false, desc })
})

test("inline API keys must be nonempty strings and validation does not expose their values", () => {
  for (const apiKey of ["", " \t\n", null, 123, false, ["fixture-secret"], { key: "fixture-secret" }]) {
    assert.throws(() => parseConfig({ baseURL: "http://localhost/v1", model: "m", apiKey }), {
      message: "apiKey must be a nonempty string",
    })
  }
})

test("sends textual source, genuine user prompt, fixed schema and optional bearer key", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Counts fruits."}')))
  config.apiKeyEnv = "TEST_REVIEW_KEY"
  config.instructions = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
  t.after(() => rm(config.instructions!, { recursive: true, force: true }))
  await writeFile(path.join(config.instructions, "PERMISSION-REVIEW-PROMPT.md"), "Custom risk guidance")
  const prompts = await loadPrompts(config.instructions, signal())
  assert.deepEqual(await review(evidence, config, signal(), fetch, { TEST_REVIEW_KEY: "fixture-secret" }, prompts), { safe: true, desc: "Counts fruits." })
  const body = requests[0]!.body
  assert.equal(requests[0]!.authorization, "Bearer fixture-secret")
  assert.deepEqual(JSON.parse(body.messages[1].content), evidence)
  assert.match(body.messages[0].content, /Custom risk guidance/)
  assert.match(body.messages[0].content, /exactly two fields/)
  const contract = (await readFile(new URL("../contracts/PERMISSION-REVIEW-CONTRACT.md", import.meta.url), "utf8")).trim()
  assert.equal(body.messages[0].content, `Custom risk guidance\n\n${contract}`)
  assert.equal(body.stream, false)
  assert.equal(body.tools, undefined)
})

test("inline API key authenticates requests and corrections without entering model evidence", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index ? '{"safe":true,"desc":"Counts fruits."}' : "bad format")))
  const cfg = parseConfig({ ...config, apiKey: "  inline-fixture-key  " })
  assert.deepEqual(await review(evidence, cfg, signal(), fetch, {}), { safe: true, desc: "Counts fruits." })
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.authorization, "Bearer inline-fixture-key")
    assert.deepEqual(JSON.parse(request.body.messages[1].content), evidence)
    assert.ok(!JSON.stringify(request.body).includes("inline-fixture-key"))
  }
})

test("environment API keys match inline normalization on requests and corrections", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index % 2 ? '{"safe":true,"desc":"Counts fruits."}' : "bad format")))
  const padded = " \t\n fixture-environment-key \r\n\u00a0"
  for (const options of [{ apiKey: padded }, { apiKeyEnv: "TEST_REVIEW_KEY" }]) {
    const cfg = parseConfig({ ...config, ...options })
    assert.deepEqual(await review(evidence, cfg, signal(), fetch, { TEST_REVIEW_KEY: padded }), { safe: true, desc: "Counts fruits." })
  }
  assert.deepEqual(requests.map((request) => request.target), Array(4).fill("/v1/chat/completions"))
  for (const request of requests) {
    assert.equal(request.authorization, "Bearer fixture-environment-key")
    assert.deepEqual(JSON.parse(request.body.messages[1].content), evidence)
    assert.ok(!JSON.stringify(request.body).includes("fixture-environment-key"))
  }
})

test("inline API key takes precedence over set, blank or missing environment keys", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Counts fruits."}')))
  const cfg = parseConfig({ ...config, apiKey: "inline-fixture-key", apiKeyEnv: "TEST_REVIEW_KEY" })
  for (const environment of [{ TEST_REVIEW_KEY: "environment-fixture-key" }, { TEST_REVIEW_KEY: " \t\r\n" }, {}]) {
    await review(evidence, cfg, signal(), fetch, environment)
  }
  assert.equal(requests.length, 3)
  for (const request of requests) assert.equal(request.authorization, "Bearer inline-fixture-key")
})

test("omitting both API-key options sends no authorization header", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Counts fruits."}')))
  await review(evidence, config, signal(), fetch, { TEST_REVIEW_KEY: "unused-fixture-key" })
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.authorization, undefined)
})

test("format correction uses validation feedback and configurable retry count", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index < 2 ? '{"safe":"yes","desc":"x"}' : '{"safe":false,"desc":"Source unavailable."}')))
  config.formatRetries = 2
  const result = await review(evidence, config, signal())
  assert.equal(result.safe, false)
  assert.equal(requests.length, 3)
  assert.deepEqual(requests.map((request) => request.target), Array(3).fill("/v1/chat/completions"))
  const prompt = (await readFile(new URL("../prompts/PERMISSION-REVIEW-PROMPT.md", import.meta.url), "utf8")).trim()
  const contract = (await readFile(new URL("../contracts/PERMISSION-REVIEW-CONTRACT.md", import.meta.url), "utf8")).trim()
  const correction = (await readFile(new URL("../contracts/PERMISSION-REVIEW-CORRECTION.md", import.meta.url), "utf8")).trim()
  assert.match(correction, /\{\{validationError\}\}/)
  assert.equal(requests[0]!.body.messages[0].content, `${prompt}\n\n${contract}`)
  assert.equal(requests[1]!.body.messages[3].content, correction.replace("{{validationError}}", "Invalid assessment fields or types"))
  assert.deepEqual(JSON.parse(requests[2]!.body.messages[1].content), evidence)
})

test("zero retries and exhausted retries end with unavailable, not a fabricated rating", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope("not json")))
  config.formatRetries = 0
  await assert.rejects(review(evidence, config, signal()), /format invalid/)
  assert.equal(requests.length, 1)
  config.formatRetries = 2
  await assert.rejects(review(evidence, config, signal()), /format invalid/)
  assert.deepEqual(requests.map((request) => request.target), Array(4).fill("/v1/chat/completions"))
})

test("HTTP errors, malformed API envelopes and oversized bodies do not trigger correction", async (t) => {
  for (const [name, handler, expected] of [
    ["http", (_: number, res: ServerResponse) => { res.statusCode = 401; res.end("secret diagnostic") }, /HTTP 401/],
    ["envelope", (_: number, res: ServerResponse) => res.end("not API json"), /invalid API JSON/],
    ["no choices", (_: number, res: ServerResponse) => res.end("{}"), /one completion/],
    ["oversized", (_: number, res: ServerResponse) => res.end("x".repeat(70000)), /exceeds 64 KiB/],
  ] as const) {
    await t.test(name, async (t) => {
      const { config, requests } = await endpoint(t, handler)
      await assert.rejects(review(evidence, config, signal()), expected)
      assert.equal(requests.length, 1)
    })
  }
})

test("total deadline covers format retries rather than resetting per attempt", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => {
    if (!index) res.end(envelope("bad format"))
    // Correction intentionally never completes.
  })
  const start = Date.now()
  await assert.rejects(withDeadline(signal(), 100, (s) => review(evidence, config, s)), /timed out/)
  assert.equal(requests.length, 2)
  assert.ok(Date.now() - start < 1500)
})

test("cancelled and pre-cancelled reviews never return or retry a late response", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => {
    void sleep(100).then(() => res.end(envelope('{"safe":true,"desc":"Late."}')))
  })
  const controller = new AbortController()
  const promise = withDeadline(controller.signal, 1000, (s) => review(evidence, config, s))
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(promise, { name: "AbortError" })
  await sleep(120)
  assert.equal(requests.length, 1)
  await assert.rejects(withDeadline(controller.signal, 100, (s) => review(evidence, config, s)), { name: "AbortError" })
  assert.equal(requests.length, 1)
})

test("missing and blank environment API keys fail before transport with value-free errors", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Unexpected."}')))
  const cfg = parseConfig({ ...config, apiKeyEnv: "TEST_REVIEW_KEY" })
  let fetchCalls = 0
  const fetcher: typeof fetch = (...args) => { fetchCalls++; return fetch(...args) }
  for (const value of [undefined, "", " ", " \t\r\n", "\u00a0\uFEFF"]) {
    await assert.rejects(review(evidence, cfg, signal(), fetcher, { TEST_REVIEW_KEY: value }), {
      message: "API key environment variable TEST_REVIEW_KEY is unset or empty",
    })
    assert.equal(fetchCalls, 0)
    assert.equal(requests.length, 0)
  }
})

test("environment API keys are excluded from HTTP and network error messages", async (t) => {
  const secret = "fixture-sensitive-key"
  const environment = { TEST_REVIEW_KEY: `  ${secret}  ` }
  const { config, requests } = await endpoint(t, (_, res) => { res.statusCode = 401; res.end(`Rejected ${secret}`) })
  const cfg = parseConfig({ ...config, apiKeyEnv: "TEST_REVIEW_KEY" })
  await assert.rejects(review(evidence, cfg, signal(), fetch, environment), { message: "Reviewer HTTP 401" })
  assert.deepEqual(requests.map((request) => request.target), ["/v1/chat/completions"])
  assert.equal(requests[0]!.authorization, `Bearer ${secret}`)
  let fetchCalls = 0
  const fetcher: typeof fetch = async () => { fetchCalls++; throw new Error(`Transport rejected ${secret}`) }
  await assert.rejects(review(evidence, cfg, signal(), fetcher, environment), { message: "Reviewer network request failed" })
  assert.equal(fetchCalls, 1)
})

test("deadline also aborts a response that stalls after HTTP headers", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.write('{"choices":[')
  })
  await assert.rejects(withDeadline(signal(), 100, (s) => review(evidence, config, s)), /timed out/)
  assert.equal(requests.length, 1)
})

test("redirects are not followed and cannot forward review evidence", async (t) => {
  const destination = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Unexpected."}')))
  const origin = await endpoint(t, (_, res) => {
    res.writeHead(307, { Location: `${destination.config.baseURL}/chat/completions` })
    res.end()
  })
  await assert.rejects(review(evidence, origin.config, signal()), /network request failed/)
  assert.equal(origin.requests.length, 1)
  assert.equal(destination.requests.length, 0)
})

test("edit evidence uses its own assessment and fixed correction, retaining partial coverage", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index % 2 ? '{"safe":false,"desc":"Partial review: deleted file content omitted."}' : '{"safe":"yes","desc":"bad type"}')))
  const edit = await collectEditEvidence({
    kind: "edit", tool: "apply_patch", userPrompt: "Update a setting", limitations: [], session: evidence.session,
    location: { instanceDirectory: "/project", instanceWorktree: "/project" },
    permission: { id: "edit", type: "edit", patterns: ["config", "data"], always: ["*"], tool: { messageID: "m", callID: "c" }, metadata: {
      diff: "raw secret aggregate", files: [
        { filePath: "/project/config", type: "update", patch: "-false\n+true\n" },
        { filePath: "/project/data", type: "delete", patch: "omitted secret" },
      ],
    } },
  }, { maxFiles: 1, maxEvidenceBytes: 100 }, signal())
  const customDir = await mkdtemp(path.join(tmpdir(), "review-prompts-"))
  t.after(() => rm(customDir, { recursive: true, force: true }))
  await writeFile(path.join(customDir, "EDIT-REVIEW-PROMPT.md"), "Custom edit instructions")
  await writeFile(path.join(customDir, "PERMISSION-REVIEW-PROMPT.md"), "Shell-only guidance")
  const custom = await loadPrompts(customDir, signal())
  for (const prompts of [BUILTIN_PROMPTS, custom]) {
    const index = requests.length
    const result = await review(edit, config, signal(), fetch, {}, prompts)
    assert.equal(result.safe, false)
    assert.equal(requests[index]!.body.messages[0].content, `${prompts.edit.instructions}\n\n${CONTRACT}`)
    assert.deepEqual(JSON.parse(requests[index]!.body.messages[1].content), edit)
    assert.ok(!JSON.stringify(requests[index]!.body).includes("raw secret aggregate"))
    assert.ok(!JSON.stringify(requests[index]!.body).includes("omitted secret"))
    assert.ok(!JSON.stringify(requests[index]!.body).includes("Shell-only guidance"))
    assert.equal(requests[index + 1]!.body.messages[3].content, CORRECTION.replace("{{validationError}}", "Invalid assessment fields or types"))
    assert.deepEqual(JSON.parse(requests[index + 1]!.body.messages[1].content), edit)
    assert.equal(requests[index]!.body.tools, undefined)
    assert.equal(requests[index]!.body.stream, false)
  }
})

test("auto mode adds only the extra-careful template to both review kinds, including corrections", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index % 2 ? '{"safe":true,"desc":"Bounded effects."}' : "invalid JSON")))
  const edit = await collectEditEvidence({
    kind: "edit", tool: "edit", userPrompt: "Update note", limitations: [], session: evidence.session,
    location: { instanceDirectory: "/project", instanceWorktree: "/project" },
    permission: { ...evidence.permission!, type: "edit", metadata: { filepath: "/project/note", diff: "-old\n+new" } },
  }, config, signal())
  for (const input of [evidence, edit]) for (const autoApprove of [false, true]) {
    const prompts = { ...BUILTIN_PROMPTS, extraCareful: "CUSTOM EXTRA CARE: check the supplied evidence carefully." }
    const start = requests.length
    await review(input, { ...config, autoApprove, autoApproveDelaySeconds: 17 }, signal(), fetch, {}, prompts)
    const kind = input.kind === "edit" ? "edit" : "shell"
    for (const request of requests.slice(start)) {
      assert.equal(request.body.messages[0].content, [prompts[kind].instructions, ...(autoApprove ? [prompts.extraCareful] : []), CONTRACT].join("\n\n"))
      assert.deepEqual(JSON.parse(request.body.messages[1].content), input)
      assert.doesNotMatch(JSON.stringify(request.body), /autoApprove|countdown|automatic approval/)
    }
    assert.equal(requests.length - start, 2)
  }
})

test("provider reasoning stays outside the displayed assessment", async (t) => {
  const { config } = await endpoint(t, (_, res) => res.end(JSON.stringify({ choices: [{ message: {
    content: '{"safe":true,"desc":"Visible effects."}', reasoning: "hidden reasoning", reasoning_content: "hidden thoughts",
  } }] })))
  assert.deepEqual(await review(evidence, config, signal()), { safe: true, desc: "Visible effects." })
})

test("new review kinds select only their own instructions and share the fixed correction contract", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(envelope(index % 2 ? '{"safe":true,"desc":"Bounded operation."}' : "bad format")))
  for (const kind of ["mcp", "custom", "external-directory"] as const) for (const autoApprove of [false, true]) {
    const common = { kind, tool: "fixture_tool", userPrompt: "Perform fixture operation", limitations: [],
      permission: { ...evidence.permission!, type: kind === "external-directory" ? "external_directory" : "fixture_tool" }, location: { instanceDirectory: "/fixture", instanceWorktree: "/fixture" }, partial: false }
    const input: ReviewEvidence = kind === "external-directory"
      ? { ...common, kind, operation: { input: { path: "/outside" }, inputStatus: "complete" }, permission: { ...common.permission, metadataStatus: "complete" } }
      : { ...common, kind, input: { target: "fixture" }, origin: { source: kind === "mcp" ? "host MCP routing" : "host registry", server: null }, definition: { status: "unavailable", reason: "Fixture definition unavailable" } }
    const start = requests.length
    await review(input, { ...config, autoApprove }, signal())
    assert.equal(requests.length - start, 2)
    for (const request of requests.slice(start)) {
      assert.equal(request.body.messages[0].content, [BUILTIN_PROMPTS[kind].instructions, ...(autoApprove ? [BUILTIN_PROMPTS.extraCareful] : []), CONTRACT].join("\n\n"))
      assert.deepEqual(JSON.parse(request.body.messages[1].content), input)
      assert.equal(request.body.tools, undefined)
      assert.equal(request.body.stream, false)
    }
    assert.equal(requests[start + 1]!.body.messages[3].content, CORRECTION.replace("{{validationError}}", "Invalid JSON"))
  }
})

test("review usage sums correction requests outside assessment JSON and evidence", async (t) => {
  const { config, requests } = await endpoint(t, (index, res) => res.end(JSON.stringify({
    model: "fixture", usage: { prompt_tokens: 100 + index, completion_tokens: 10 },
    choices: [{ message: { content: index ? '{"safe":true,"desc":"Visible effects."}' : "bad format" } }],
  })))
  const result = await review(evidence, config, signal(), fetch, {}, BUILTIN_PROMPTS,
    () => ({ input: 1, output: 2, cache: { read: 0, write: 0 } }))
  assert.deepEqual(result, { safe: true, desc: "Visible effects.", usage: { input: 201, output: 20, cost: 0.000241 } })
  assert.equal(requests.length, 2)
  for (const request of requests) assert.deepEqual(JSON.parse(request.body.messages[1].content), evidence)
  assert.throws(() => parseAssessment('{"safe":true,"desc":"x","usage":{"prompt_tokens":10}}'))
})

test("missing usage in either correction response omits the report usage line", async (t) => {
  for (const missing of [0, 1]) {
    const { config } = await endpoint(t, (index, res) => res.end(JSON.stringify({
      ...(index === missing ? {} : { usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      choices: [{ message: { content: index ? '{"safe":true,"desc":"Visible effects."}' : "bad format" } }],
    })))
    assert.deepEqual(await review(evidence, config, signal()), { safe: true, desc: "Visible effects." })
  }
})

test("lifetime observer receives each completed attempt even when the final assessment fails", async (t) => {
  const { config } = await endpoint(t, (_, res) => res.end(JSON.stringify({
    usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ message: { content: "bad format" } }],
  })))
  const observed: Usage[] = []
  await assert.rejects(review(evidence, config, signal(), fetch, {}, BUILTIN_PROMPTS, undefined, (usage) => observed.push(usage)), /format invalid/)
  assert.deepEqual(observed, [{ input: 100, output: 10 }, { input: 100, output: 10 }])
})

test("completed invalid envelopes retain reported usage; accounting failures cannot break reviews", async (t) => {
  const observed: Usage[] = []
  const invalid = await endpoint(t, (_, res) => res.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 10 } })))
  await assert.rejects(review(evidence, invalid.config, signal(), fetch, {}, BUILTIN_PROMPTS, undefined, (usage) => observed.push(usage)), /one completion/)
  assert.equal(observed.length, 1)
  const valid = await endpoint(t, (_, res) => res.end(JSON.stringify({
    usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ message: { content: '{"safe":true,"desc":"Bounded effects."}' } }],
  })))
  const result = await review(evidence, valid.config, signal(), fetch, {}, BUILTIN_PROMPTS, undefined, (usage) => {
    usage.input = 999
    throw new Error("storage failure")
  })
  assert.deepEqual(result, { safe: true, desc: "Bounded effects.", usage: { input: 100, output: 10 } })
  const unpriced = await review(evidence, valid.config, signal(), fetch, {}, BUILTIN_PROMPTS,
    () => { throw new Error("catalog unavailable") }, (usage) => observed.push(usage))
  assert.deepEqual(unpriced, result)
  assert.deepEqual(observed.at(-1), { input: 100, output: 10 })
})

test("missing usage, HTTP errors, and cancellation produce no lifetime usage records", async (t) => {
  let observations = 0
  const observe = () => { observations++ }
  const missing = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Bounded effects."}')))
  await review(evidence, missing.config, signal(), fetch, {}, BUILTIN_PROMPTS, undefined, observe)
  const error = await endpoint(t, (_, res) => { res.writeHead(503); res.end("Unavailable") })
  await assert.rejects(review(evidence, error.config, signal(), fetch, {}, BUILTIN_PROMPTS, undefined, observe), /HTTP 503/)
  const held = await endpoint(t, () => {})
  await assert.rejects(withDeadline(signal(), 100, (s) => review(evidence, held.config, s, fetch, {}, BUILTIN_PROMPTS, undefined, observe)), /timed out/)
  assert.equal(observations, 0)
})
