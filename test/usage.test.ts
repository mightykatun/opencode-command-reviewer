import { test } from "node:test"
import assert from "node:assert/strict"
import type { Model } from "@opencode-ai/sdk/v2"
import { modelPricing, responseUsage, sumUsage, usageText, type Pricing } from "../src/usage.js"

const prices: Pricing = { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }
const response = (input = 1000, output = 100) => ({ model: "fixture", usage: { prompt_tokens: input, completion_tokens: output } })

test("usage requires both actual endpoint counts; malformed or missing usage is never replaced with zeros", () => {
  for (const usage of [undefined, null, [], {}, { prompt_tokens: 1 }, { completion_tokens: 1 }, { prompt_tokens: "10", completion_tokens: 2 }, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: 1.5, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: Infinity }]) {
    assert.equal(responseUsage({ usage }, "fixture"), undefined)
  }
  assert.deepEqual(responseUsage(response(0, 0), "fixture"), { input: 0, output: 0 })
  assert.equal(usageText(responseUsage(response(), "fixture")!), "tokens in/out: 1000/100")
})

test("cost uses per-million input/output, cached reads/writes and returns four decimal places", () => {
  const plain = responseUsage(response(), "fixture", () => prices)!
  assert.equal(plain.cost, 0.0045)
  assert.equal(usageText(plain), "tokens in/out: 1000/100\ncost: $0.0045")
  const cached = responseUsage({ usage: { ...response().usage, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 } } }, "fixture", () => prices)!
  assert.ok(Math.abs(cached.cost! - 0.002955) < 1e-10)
  const free = responseUsage(response(), "fixture", () => ({ input: 0, output: 0, cache: { read: 0, write: 0 } }))!
  assert.equal(usageText(free), "tokens in/out: 1000/100\ncost: $0.0000")
})

test("context-tier prices include cached input; exact thresholds use the preceding tier", () => {
  const expensive = { input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } }
  const tiered = { ...prices, tiers: [{ ...expensive, tier: { type: "context" as const, size: 200000 } }] }
  assert.equal(responseUsage(response(200000, 0), "fixture", () => tiered)?.cost, 0.6)
  assert.equal(responseUsage(response(200001, 0), "fixture", () => tiered)?.cost, 1.200006)
  const cached = { usage: { prompt_tokens: 200001, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 200000 } } }
  assert.equal(responseUsage(cached, "fixture", () => tiered)?.cost, 0.120006)
  assert.equal(responseUsage(response(200001, 0), "fixture", () => ({ ...prices, experimentalOver200K: expensive }))?.cost, 1.200006)
})

test("unknown or malformed pricing/cache metadata retains token counts without an invented cost", () => {
  for (const details of [{ cached_tokens: 1001 }, { cached_tokens: -1 }, { cached_tokens: "100" }, { cached_tokens: 900, cache_write_tokens: 200 }]) {
    assert.deepEqual(responseUsage({ usage: { ...response().usage, prompt_tokens_details: details } }, "fixture", () => prices), { input: 1000, output: 100 })
  }
  for (const cost of [{ ...prices, input: -1 }, { ...prices, output: NaN }, { ...prices, output: Number.MAX_VALUE }]) {
    assert.deepEqual(responseUsage(response(), "fixture", () => cost), { input: 1000, output: 100 })
  }
  let lookedUp = ""
  responseUsage(response(), "alias", (model) => { lookedUp = model; return undefined })
  assert.equal(lookedUp, "fixture")
})

test("catalog pricing matches endpoint and model exactly, honors overrides and rejects ambiguous prices", () => {
  const model = { id: "fixture", api: { id: "upstream-fixture", url: "https://example.test/v1" }, options: {}, cost: prices } as Model
  const provider = { options: {}, models: { fixture: model } }
  assert.equal(modelPricing([provider], "https://example.test/v1/", "fixture"), prices)
  assert.equal(modelPricing([provider], "https://example.test/v1", "upstream-fixture"), prices)
  assert.equal(modelPricing([provider], "https://other.test/v1", "fixture"), undefined)
  assert.equal(modelPricing([provider], "https://example.test/v1", "fixture-latest"), undefined)
  const overridden = { ...provider, options: { baseURL: "https://proxy.test/v1" } }
  assert.equal(modelPricing([overridden], "https://example.test/v1", "fixture"), undefined)
  assert.equal(modelPricing([overridden], "https://proxy.test/v1", "fixture"), prices)
  const different = { ...provider, models: { fixture: { ...model, cost: { ...prices, input: 9 } } } }
  assert.equal(modelPricing([provider, different], "https://example.test/v1", "fixture"), undefined)
})

test("correction totals include every request and never silently undercount partial data", () => {
  assert.deepEqual(sumUsage({ input: 10, output: 5, cost: 0.01 }, { input: 20, output: 10, cost: 0.02 }), { input: 30, output: 15, cost: 0.03 })
  assert.deepEqual(sumUsage({ input: 10, output: 5, cost: 0.01 }, { input: 20, output: 10 }), { input: 30, output: 15 })
  assert.equal(sumUsage(undefined, { input: 10, output: 5 }), undefined)
  assert.equal(sumUsage({ input: 10, output: 5 }, undefined), undefined)
  assert.equal(sumUsage({ input: Number.MAX_SAFE_INTEGER, output: 0 }, { input: 1, output: 0 }), undefined)
})
