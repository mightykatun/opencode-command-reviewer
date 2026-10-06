import { readFileSync } from "node:fs"

type PromptName = "PERMISSION-REVIEW-PROMPT" | "PERMISSION-REVIEW-CONTRACT" | "PERMISSION-REVIEW-CORRECTION"

// The build embeds these files; direct source tests read the same Markdown.
declare const __REVIEW_PROMPTS__: Record<PromptName, string> | undefined

function prompt(name: PromptName): string {
  if (typeof __REVIEW_PROMPTS__ !== "undefined") return __REVIEW_PROMPTS__[name]
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8").trim()
}

export const DEFAULT_INSTRUCTIONS = prompt("PERMISSION-REVIEW-PROMPT")
export const CONTRACT = prompt("PERMISSION-REVIEW-CONTRACT")
const CORRECTION = prompt("PERMISSION-REVIEW-CORRECTION")

export function correctionPrompt(validationError: string): string {
  return CORRECTION.replace("{{validationError}}", () => validationError)
}
