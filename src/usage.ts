import type { Model, Provider } from "@opencode-ai/sdk/v2"

export interface Usage { input: number; output: number; cost?: number }
export type Pricing = Model["cost"]
export type PricingLookup = (model: string) => Pricing | undefined

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const rate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const endpoint = (value: unknown) => {
  if (typeof value !== "string") return
  try { return new URL(value).href.replace(/\/+$/, "") } catch { return }
}

/** Use the host's live catalog, including user pricing overrides, not a stale price table. */
export function modelPricing(providers: readonly Pick<Provider, "options" | "models">[], baseURL: string, modelID: string): Pricing | undefined {
  const matches = providers.flatMap((provider) => Object.values(provider.models).filter((model) =>
    (model.id === modelID || model.api.id === modelID)
    && endpoint(model.options.baseURL ?? provider.options.baseURL ?? model.api.url) === endpoint(baseURL)))
  if (!matches.length || matches.some((model) => JSON.stringify(model.cost) !== JSON.stringify(matches[0]!.cost))) return
  return matches[0]!.cost
}

export function responseUsage(envelope: unknown, requestedModel: string, pricing?: PricingLookup): Usage | undefined {
  const body = record(envelope), usage = record(body.usage)
  if (!count(usage.prompt_tokens) || !count(usage.completion_tokens)) return
  const result: Usage = { input: usage.prompt_tokens, output: usage.completion_tokens }
  const prices = pricing?.(typeof body.model === "string" ? body.model : requestedModel)
  if (!prices) return result
  const details = record(usage.prompt_tokens_details)
  const cached = details.cached_tokens === undefined ? 0 : details.cached_tokens
  const written = details.cache_write_tokens === undefined ? 0 : details.cache_write_tokens
  // Native Anthropic usage is a different contract; do not guess its mapping to prompt_tokens.
  if (!count(cached) || !count(written) || cached + written > result.input
    || usage.cache_creation_input_tokens || usage.cache_read_input_tokens) return result
  const tiers = prices.tiers ?? (prices.experimentalOver200K ? [{ ...prices.experimentalOver200K, tier: { type: "context" as const, size: 200000 } }] : [])
  const selected = [...tiers].sort((a, b) => b.tier.size - a.tier.size).find((tier) => result.input > tier.tier.size) ?? prices
  if (![selected.input, selected.output, selected.cache.read, selected.cache.write].every(rate)) return result
  const cost = ((result.input - cached - written) * selected.input + result.output * selected.output
    + cached * selected.cache.read + written * selected.cache.write) / 1_000_000
  return Number.isFinite(cost) ? { ...result, cost } : result
}

/** An incomplete correction chain must not look like complete report usage. */
export function sumUsage(previous: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!previous || !next) return
  const input = previous.input + next.input, output = previous.output + next.output
  if (!count(input) || !count(output)) return
  const cost = previous.cost !== undefined && next.cost !== undefined ? previous.cost + next.cost : undefined
  return { input, output, ...(cost !== undefined && Number.isFinite(cost) ? { cost } : {}) }
}

export function usageText(usage: Usage): string {
  return `tokens in/out: ${usage.input}/${usage.output}${usage.cost === undefined ? "" : `\ncost: $${usage.cost.toFixed(4)}`}`
}
