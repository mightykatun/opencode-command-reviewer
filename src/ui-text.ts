/**
 * User-facing interface copy. Edit the values here, then rebuild and restart
 * OpenCode. Keep keys and formatter parameters intact so callers stay typed.
 *
 * This is source-level customization, not a tui.json option or runtime override.
 * Model instructions live in prompts/ and contracts/. Model-written reports,
 * host-owned controls and technical diagnostic details are not interface copy.
 * Keep labels short: the review sidebar is 42 columns including padding.
 */
export const uiText = {
  review: {
    heading: "Permission analysis",
    safe: "✓ Safe",
    unsafe: "✗ Unsafe",
    unavailable: "! Analysis unavailable",
    evaluating: "Evaluating",
    retrying: "Retrying",
    staticIndicator: "[⋯]",
    failed: "Review failed",
    invalidConfiguration: "Invalid configuration",
  },
  autoApproval: {
    countdown: (seconds: number) => `Allowed in ${seconds}s`,
    checking: "Checking…",
    cancel: "Cancel",
    allowing: "Allowing…",
    cancelled: "Auto-approval canceled",
    unavailable: "! Auto-approval unavailable. Use native controls.",
  },
  commands: {
    history: "Reviewer: Report history",
    category: "Reviewer",
    enable: "Reviewer: Enable for conversation",
    disable: "Reviewer: Disable for conversation",
    lifetime: "Reviewer: Lifetime usage",
  },
  sessionMode: {
    saved: (enabled: boolean) => enabled
      ? "Reviewer enabled for this conversation."
      : "Reviewer disabled for this conversation.",
    saveFailed: (enabled: boolean) => enabled
      ? "Reviewer enabled locally, but saving failed. Resume may use the previous setting."
      : "Reviewer disabled locally, but saving failed. Resume may use the previous setting.",
    unavailable: "Reviewer setting unavailable. Session ancestry or saved mode could not be read.",
  },
  history: {
    heading: "Analysis history", close: "Close",
    outcomes: { auto: "Auto approved", manual: "Manually approved", cancelled: "Cancelled", rejected: "Rejected" },
    older: "<", newer: ">", index: (x: number, y: number) => `${x}/${y}`,
    empty: "No history entries", loading: "Loading history", unavailable: "History could not be read",
    unreadable: "! Unreadable entry", model: (model: string) => `model: ${model}`,
    provider: (providerBaseURL: string) => `provider: ${providerBaseURL}`,
  },
  usage: {
    tokens: (input: number, output: number) => `token: ${input} in ${output} out`,
    cost: (amount: string) => `cost: $${amount}`,
  },
  lifetime: {
    title: "Reviewer lifetime usage",
    loading: "Loading recorded usage…",
    unavailable: "Lifetime usage unavailable. Recorded totals have not been reset.",
    inlineUnavailable: "lifetime: usage unavailable",
    empty: "lifetime: no recorded usage",
    costUnavailable: "lifetime: cost unavailable",
    cost: (amount: string, partial: boolean) => `lifetime: $${amount}${partial ? " (partial pricing)" : ""}`,
    requests: (count: number) => `${count} requests with recorded usage`,
    tokens: (input: number, output: number, partial: boolean) => `token: ${input} in ${output} out${partial ? " (partial coverage)" : ""}`,
    tokensUnavailable: "tokens unavailable",
    tokenCoverage: (available: number, total: number) => `Token counts available: ${available}/${total} requests`,
    pricingCoverage: (available: number, total: number) => `Pricing available: ${available}/${total} requests`,
    since: (date: string) => `Recorded since: ${date}`,
    ratings: (safe: number, unsafe: number) => `${safe} ✓ ${unsafe} ✗`,
    dialogReviews: (count: number) => `Reviews: ${count}`,
    dialogRetries: (count: number, partial: boolean) => `Retries: ${count}${partial ? " (partial history)" : ""}`,
    dialogTokens: (input: number, output: number, partial: boolean) => `Tokens: ${input} in ${output} out${partial ? " (partial coverage)" : ""}`,
    dialogTokensUnavailable: "Tokens: unavailable",
    dialogCost: (amount: string | undefined, partial: boolean) => amount === undefined ? "Cost: unavailable" : `Cost: $${amount}${partial ? " (partial pricing)" : ""}`,
    dialogSafe: (count: number, percentage: string | undefined) => `Safe: ${count} (${percentage === undefined ? "n/a" : `${percentage}%`})`,
    dialogUnsafe: (count: number, percentage: string | undefined) => `Unsafe: ${count} (${percentage === undefined ? "n/a" : `${percentage}%`})`,
    dialogAutoApproved: (count: number, percentage: string | undefined, partial: boolean) => `Auto-approved: ${count} (${percentage === undefined ? "n/a" : `${percentage}%`})${partial ? " (partial history)" : ""}`,
    averageFullReport: (seconds: string | undefined) => `Average time to full report: ${seconds === undefined ? "unavailable" : `${seconds}s`}`,
    averageRating: (seconds: string | undefined) => `Average time to rating: ${seconds === undefined ? "unavailable" : `${seconds}s`}`,
    ratingsSince: (date: string) => `Ratings recorded since: ${date}`,
    ratingsExplanation: "Ratings count completed, validated reviews, including those without usage data. Previews, retries and failed or interrupted analyses do not count. A fresh review after re-enabling counts again. Earlier ratings were not recorded and cannot be recovered.",
    explanation: "Received usage only, including interrupted or unsuccessful reviews. Unreported charges remain unknown. Costs combine endpoint-reported amounts and catalog estimates; legacy history retains its original estimates. Earlier unrecorded usage cannot be recovered.",
  },
  notifications: {
    application: "Opencode",
    heading: (session: string) => `Opencode (${session})`,
    openSession: "Open session",
    fallbackSession: "OpenCode session",
    attention: "Session needs attention",
    unsafe: "Unsafe permission needs human approval",
    question: "Agent has a question",
    reminder: (event: string) => `${event} (Reminder)`,
    approved: "Reviewer approved a permission",
    error: "Session error",
    ended: "Session ended",
    // Arguments are escaped by the desktop adapter before formatting.
    body: (event: string) => event,
  },
} as const
