import { empty, type LifetimeTotals } from "./lifetime.js"
import type { HistoryEvent } from "./history-records.js"

/** The same contribution drives both scopes, including received usage from
 * rejected/interrupted attempts and retries dispatched without received usage. */
export function historyDelta(e: HistoryEvent): LifetimeTotals {
  const delta = empty(), activity = delta.activity
  if (e.type === "attemptDispatched" && e.retry !== "initial") {
    activity.retries = 1; activity.since = e.at
  } else if (e.type === "attemptFinalized" && e.usage) {
    delta.requests = activity.usageRequests = 1; delta.since = activity.since = e.at
    if (e.usage.input !== undefined) { delta.tokenRequests = 1; delta.input = e.usage.input; delta.output = e.usage.output! }
    if (e.usage.cost !== undefined) { delta.priced = 1; delta.cost = e.usage.cost }
  } else if (e.type === "reviewAccepted") {
    delta.safe = e.accepted.safe ? 1 : 0; delta.unsafe = e.accepted.safe ? 0 : 1; delta.ratingsSince = e.accepted.completedAt
    activity.reviews = 1; activity.since = e.accepted.completedAt
    if (e.accepted.timing) { activity.timedReviews = 1; activity.meanFullReportMs = e.accepted.timing.fullReportMs; activity.meanRatingMs = e.accepted.timing.ratingMs }
  } else if (e.type === "approvalConfirmed" && e.automatic) {
    activity.autoApproved = 1; activity.since = e.at
  }
  return delta
}
