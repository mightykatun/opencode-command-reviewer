import type { NotificationInteraction } from "./notification-types.js"

export interface PendingInteraction extends NotificationInteraction { sessionID: string }

/** OpenCode 1.18.35: permissions before questions, then code-unit session/request
 * order across a root and its direct children. Baseline and silent requests still
 * block. Deeper children have no native root input prompt in this host. */
export function notificationBlockers(roots: ReadonlySet<string>, pending: Iterable<PendingInteraction>,
  getSession: (id: string) => { id: string; parentID?: string } | undefined): Map<string, NotificationInteraction> {
  const selected = new Map<string, PendingInteraction>()
  for (const candidate of pending) {
    const session = getSession(candidate.sessionID)
    if (!session) continue
    const root = session.parentID ?? session.id
    if (!roots.has(root)) continue
    const previous = selected.get(root)
    if (!previous || (candidate.kind === "permission" && previous.kind === "question")
      || (candidate.kind === previous.kind && (candidate.sessionID < previous.sessionID
        || (candidate.sessionID === previous.sessionID && candidate.id < previous.id)))) selected.set(root, candidate)
  }
  return selected
}
