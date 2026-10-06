import type { Limits } from "./types.js"

export interface Config extends Limits {
  baseURL: string
  model: string
  apiKey?: string
  apiKeyEnv?: string
  instructions?: string
  formatRetries: number
  timeoutMs: number
}

export function parseConfig(options: Record<string, unknown> = {}): Config {
  const keys = new Set(["baseURL", "model", "apiKey", "apiKeyEnv", "instructions", "formatRetries", "timeoutMs", "maxFiles", "maxEvidenceBytes"])
  for (const key of Object.keys(options)) if (!keys.has(key)) throw new Error(`Unknown command-reviewer setting: ${key}`)
  const text = (name: string, optional = false): string | undefined => {
    const value = options[name]
    if (value === undefined && optional) return undefined
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a nonempty string`)
    return value.trim()
  }
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = options[name] === undefined ? fallback : options[name]
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}`)
    }
    return value
  }
  let url: URL
  try { url = new URL(text("baseURL")!) } catch { throw new Error("baseURL must be an HTTP(S) API base URL") }
  // search/hash are empty for bare delimiters, but href retains them.
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[?#]/.test(url.href)) {
    throw new Error("baseURL must use HTTP(S) without embedded credentials, query, or fragment")
  }
  const apiKeyEnv = text("apiKeyEnv", true)
  if (apiKeyEnv && !/^[A-Za-z_][A-Za-z_0-9]*$/.test(apiKeyEnv)) throw new Error("apiKeyEnv must be an environment-variable name")
  return {
    baseURL: url.href.replace(/\/+$/, ""),
    model: text("model")!, apiKeyEnv,
    apiKey: text("apiKey", true),
    instructions: text("instructions", true),
    formatRetries: number("formatRetries", 1, 0, 100),
    timeoutMs: number("timeoutMs", 30000, 1, 3600000),
    maxFiles: number("maxFiles", 4, 1, 1000),
    maxEvidenceBytes: number("maxEvidenceBytes", 65536, 1, 16 * 1024 * 1024),
  }
}
