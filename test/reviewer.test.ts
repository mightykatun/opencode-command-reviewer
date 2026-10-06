import { test } from "node:test"
import type { TestContext } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { parseConfig } from "../src/config.js"
import { parseAssessment, review, withDeadline } from "../src/reviewer.js"
import type { Evidence } from "../src/types.js"

const evidence: Evidence = {
  command: "python fruits.py", cwd: "/external", userPrompt: "Count fruits",
  files: [{ filename: "fruits.py", status: "captured", contents: "print('pear')" }], limitations: [],
  permission: { id: "request", type: "external_directory", patterns: ["/external/*"], always: ["/external/*"], metadata: { directories: ["/external"] }, tool: { messageID: "m", callID: "c" } },
  session: { root: { id: "root", parentID: null, directory: "/project/start", projectID: "repo", workspaceID: null }, current: null, currentProject: null, rootProject: { id: "repo", worktree: "/project", vcs: "git", name: "Initial repo" } },
  execution: { tool: "bash", requestedWorkdir: "/external", instanceDirectory: "/project/start", instanceWorktree: "/project", cwdSource: "absolute tool.workdir", canonicalCwd: "/external" },
}
const signal = () => new AbortController().signal
const envelope = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

async function endpoint(t: TestContext, handler: (index: number, res: ServerResponse) => void) {
  const requests: { body: Record<string, any>; authorization?: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    requests.push({ body: JSON.parse(body), authorization: req.headers.authorization })
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
  assert.equal(cfg.maxFiles, 4)
  assert.equal(cfg.maxEvidenceBytes, 65536)
  for (const override of [ { baseURL: "file:///tmp" }, { baseURL: "https://secret@example.org" }, { model: "" }, { apiKeyEnv: "bad name" }, { timeoutMs: 0 }, { formatRetries: -1 }, { formatRetries: 1.2 }, { retries: 3 } ]) {
    assert.throws(() => parseConfig({ baseURL: "http://localhost/v1", model: "m", ...override }))
  }
})

test("strict boolean schema rejects coercion, fences, arrays, blank descriptions and extra keys", () => {
  assert.deepEqual(parseAssessment('{"safe":false,"desc":"  Prints credentials. "}'), { safe: false, desc: "Prints credentials." })
  for (const text of ['{"safe":"false","desc":"x"}', '{"safe":0,"desc":"x"}', '{"safe":true,"desc":" "}', '{"safe":true,"desc":"x","other":1}', '[]', 'null', '```json\n{"safe":true,"desc":"x"}\n```']) assert.throws(() => parseAssessment(text))
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
  config.instructions = "Custom risk guidance"
  assert.deepEqual(await review(evidence, config, signal(), fetch, { TEST_REVIEW_KEY: "fixture-secret" }), { safe: true, desc: "Counts fruits." })
  const body = requests[0]!.body
  assert.equal(requests[0]!.authorization, "Bearer fixture-secret")
  assert.deepEqual(JSON.parse(body.messages[1].content), evidence)
  assert.match(body.messages[0].content, /Custom risk guidance/)
  assert.match(body.messages[0].content, /exactly two fields/)
  const contract = (await readFile(new URL("../prompts/PERMISSION-REVIEW-CONTRACT.md", import.meta.url), "utf8")).trim()
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

test("inline API key takes precedence over set or missing environment keys", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope('{"safe":true,"desc":"Counts fruits."}')))
  const cfg = parseConfig({ ...config, apiKey: "inline-fixture-key", apiKeyEnv: "TEST_REVIEW_KEY" })
  for (const environment of [{ TEST_REVIEW_KEY: "environment-fixture-key" }, {}]) {
    await review(evidence, cfg, signal(), fetch, environment)
  }
  assert.equal(requests.length, 2)
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
  const prompt = (await readFile(new URL("../prompts/PERMISSION-REVIEW-PROMPT.md", import.meta.url), "utf8")).trim()
  const contract = (await readFile(new URL("../prompts/PERMISSION-REVIEW-CONTRACT.md", import.meta.url), "utf8")).trim()
  const correction = (await readFile(new URL("../prompts/PERMISSION-REVIEW-CORRECTION.md", import.meta.url), "utf8")).trim()
  assert.match(correction, /\{\{validationError\}\}/)
  assert.equal(requests[0]!.body.messages[0].content, `${prompt}\n\n${contract}`)
  assert.equal(requests[1]!.body.messages[3].content, correction.replace("{{validationError}}", 'Response must contain exactly "safe": boolean and "desc": nonempty string'))
  assert.deepEqual(JSON.parse(requests[2]!.body.messages[1].content), evidence)
})

test("zero retries and exhausted retries end with unavailable, not a fabricated rating", async (t) => {
  const { config, requests } = await endpoint(t, (_, res) => res.end(envelope("not json")))
  config.formatRetries = 0
  await assert.rejects(review(evidence, config, signal()), /format invalid/)
  assert.equal(requests.length, 1)
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

test("missing configured API key stops before a network request", async () => {
  const cfg = parseConfig({ baseURL: "http://localhost:1", model: "m", apiKeyEnv: "MISSING" })
  await assert.rejects(review(evidence, cfg, signal(), fetch, {}), /is unset/)
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
