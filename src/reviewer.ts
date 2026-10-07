import type { Config } from "./config.js"
import type { Assessment, ReviewEvidence, ReviewResult } from "./types.js"
import { BUILTIN_PROMPTS, CONTRACT, correctionPrompt, type PromptSet } from "./prompts.js"
import { responseUsage, sumUsage, type PricingLookup, type Usage } from "./usage.js"
import { reviewStage } from "./deadline.js"
export { withDeadline } from "./deadline.js"

class FormatError extends Error {}

export function parseAssessment(content: string): Assessment {
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new FormatError("Invalid JSON") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FormatError("Non-object JSON")
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.safe !== "boolean" || typeof record.desc !== "string" || !record.desc.trim()) {
    throw new FormatError("Invalid assessment fields or types")
  }
  return { safe: record.safe, desc: record.desc.trim() }
}

const MAX_RESPONSE_BYTES = 65536
async function responseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error("Reviewer returned an empty HTTP response")
  const reader = response.body.getReader()
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Reviewer HTTP response exceeds 64 KiB")
      chunks.push(value)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function review(
  evidence: ReviewEvidence,
  config: Config,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  environment: NodeJS.ProcessEnv = process.env,
  prompts: PromptSet = BUILTIN_PROMPTS,
  pricing?: PricingLookup,
  onUsage?: (usage: Usage) => void,
): Promise<ReviewResult> {
  const key = config.apiKey ?? (config.apiKeyEnv ? environment[config.apiKeyEnv]?.trim() : undefined)
  if (config.apiKeyEnv && !key) throw new Error(`API key environment variable ${config.apiKeyEnv} is unset or empty`)
  const prompt = prompts[evidence.kind]
  const messages = [
    { role: "system", content: [prompt.instructions, ...(config.autoApprove ? [prompts.extraCareful] : []), CONTRACT].join("\n\n") },
    { role: "user", content: JSON.stringify(evidence) },
  ]
  let usage: Usage | undefined
  for (let attempt = 0; attempt <= config.formatRetries; attempt++) {
    signal.throwIfAborted()
    reviewStage(signal, "Reviewer response")
    let response: Response
    try {
      response = await fetcher(`${config.baseURL}/chat/completions`, {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: config.model, messages, stream: false }),
      })
    } catch {
      signal.throwIfAborted()
      throw new Error("Reviewer network request failed")
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Reviewer HTTP ${response.status}`)
    }
    let envelope: unknown
    reviewStage(signal, "Reviewer response body")
    try { envelope = JSON.parse(await responseText(response, signal)) }
    catch (error) {
      signal.throwIfAborted()
      if (error instanceof SyntaxError) throw new Error("Reviewer returned invalid API JSON")
      throw error
    }
    reviewStage(signal, "Assessment validation")
    let currentUsage: Usage | undefined
    try { currentUsage = responseUsage(envelope, config.model, pricing) }
    catch { currentUsage = responseUsage(envelope, config.model) }
    // A completed HTTP response can be billable even if its assessment is invalid.
    // Accounting is observational: it must never change review/permission outcomes.
    if (currentUsage) { try { onUsage?.({ ...currentUsage }) } catch { /* The observer owns persistence diagnostics. */ } }
    const choices = (envelope as { choices?: unknown })?.choices
    if (!Array.isArray(choices) || choices.length !== 1) throw new Error("Reviewer API must return one completion")
    const choice = choices[0]
    const message = choice?.message
    // Minimal providers may omit metadata; explicit metadata must describe a completed text response.
    if (!message || typeof message.content !== "string"
      || (message.role !== undefined && message.role !== "assistant")
      || (choice.finish_reason !== undefined && choice.finish_reason !== "stop")
      || message.function_call != null
      || (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 0))
      || message.refusal) {
      throw new Error("Reviewer API did not return a text assessment")
    }
    signal.throwIfAborted()
    usage = attempt === 0 ? currentUsage : sumUsage(usage, currentUsage)
    try { return { ...parseAssessment(message.content), ...(usage ? { usage } : {}) } }
    catch (error) {
      if (!(error instanceof FormatError)) throw error
      if (attempt === config.formatRetries) throw new Error("Reviewer response format invalid after configured attempts")
      messages.push(
        { role: "assistant", content: message.content },
        { role: "user", content: correctionPrompt(error.message) },
      )
    }
  }
  throw new Error("Reviewer exhausted attempts")
}
