import type { Limits } from "./types.js"
import path from "node:path"

export interface Config extends Limits {
  baseURL: string
  model: string
  apiKey?: string
  apiKeyEnv?: string
  instructions?: string
  stream: boolean
  reviewBash: boolean
  reviewEdits: boolean
  reviewMcp: boolean
  reviewCustomTools: boolean
  reviewExternalDirectories: boolean
  autoApprove: boolean
  extraCareful: boolean
  autoApproveDelaySeconds: number
  formatRetries: number
  timeoutMs: number
}

export function parseConfig(options: Record<string, unknown> = {}): Config {
  const keys = new Set(["baseURL", "model", "apiKey", "apiKeyEnv", "instructions", "stream", "reviewBash", "reviewEdits", "reviewMcp", "reviewCustomTools", "reviewExternalDirectories", "autoApprove", "extraCareful", "autoApproveDelaySeconds", "formatRetries", "timeoutMs", "maxFiles", "maxEvidenceBytes"])
  for (const key of Object.keys(options)) if (!keys.has(key)) throw new Error(`Unknown opencode-reviewer setting: ${key}`)
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
  const boolean = (name: string, fallback = true) => {
    const value = options[name] === undefined ? fallback : options[name]
    if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`)
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
  const instructions = text("instructions", true)
  if (instructions && (!path.isAbsolute(instructions) || instructions.includes("\u0000"))) {
    throw new Error("instructions must be an absolute prompt-directory path; inline instructions are no longer supported")
  }
  return {
    baseURL: url.href.replace(/\/+$/, ""),
    model: text("model")!, apiKeyEnv,
    apiKey: text("apiKey", true),
    instructions,
    stream: boolean("stream", false),
    reviewBash: boolean("reviewBash"), reviewEdits: boolean("reviewEdits"),
    reviewMcp: boolean("reviewMcp", false), reviewCustomTools: boolean("reviewCustomTools", false),
    reviewExternalDirectories: boolean("reviewExternalDirectories", false),
    autoApprove: boolean("autoApprove", false),
    extraCareful: boolean("extraCareful"),
    autoApproveDelaySeconds: number("autoApproveDelaySeconds", 15, 0, 3600),
    formatRetries: number("formatRetries", 1, 0, 100),
    timeoutMs: number("timeoutMs", 30000, 1, 3600000),
    maxFiles: number("maxFiles", 6, 1, 1000),
    maxEvidenceBytes: number("maxEvidenceBytes", 131072, 1, 16 * 1024 * 1024),
  }
}
