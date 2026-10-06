import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import type { Assessment } from "./types.js"

export interface View {
  request: PermissionRequest
  status: "identifying" | "unidentified" | "analyzing" | "complete" | "unavailable" | "unrelated"
  assessment?: Assessment
  error?: string
}

type Evaluate = (request: PermissionRequest, signal: AbortSignal, onIdentified: () => void) => Promise<Assessment | null>
interface Entry { view: View; abort: AbortController }

/** This component has no host permission-writing or shell-execution capability. */
export class Controller {
  private entries = new Map<string, Entry>()
  private stopped = false
  private version = 0
  constructor(private evaluate: Evaluate, private changed: (views: View[]) => void) {}
  get revision() { return this.version }
  get views() { return [...this.entries.values()].map((entry) => entry.view) }
  private publish() { if (!this.stopped) this.changed(this.views) }

  asked(request: PermissionRequest) {
    if (this.stopped || this.entries.has(request.id)) return
    this.version++
    const entry: Entry = {
      abort: new AbortController(),
      view: {
        request,
        status: request.permission === "bash" ? "analyzing" : request.permission === "external_directory" ? "identifying" : "unrelated",
      },
    }
    this.entries.set(request.id, entry)
    this.publish()
    if (entry.view.status === "unrelated") return
    const active = () => !this.stopped && !entry.abort.signal.aborted && this.entries.get(request.id) === entry
    void Promise.resolve().then(() => {
      entry.abort.signal.throwIfAborted()
      return this.evaluate(request, entry.abort.signal, () => {
        // A timed-out evaluator may still call back after its review has settled.
        if (active() && (entry.view.status === "identifying" || entry.view.status === "analyzing")) {
          entry.view = { ...entry.view, status: "analyzing" }; this.publish()
        }
      })
    }).then((assessment) => {
      if (active()) { entry.view = assessment ? { ...entry.view, status: "complete", assessment } : { ...entry.view, status: "unrelated" }; this.publish() }
    }, (error: unknown) => {
      if (active()) {
        entry.view = { ...entry.view, status: entry.view.status === "identifying" ? "unidentified" : "unavailable", error: error instanceof Error ? error.message : "Review failed" }
        this.publish()
      }
    })
  }

  replied(id: string) {
    if (this.stopped) return
    // Increment even for an unknown ID: an in-flight snapshot may still contain it.
    this.version++
    this.entries.get(id)?.abort.abort()
    if (this.entries.delete(id)) this.publish()
  }

  deleted(sessionID: string) {
    if (this.stopped) return
    // A startup snapshot may contain requests for a session not yet tracked here.
    this.version++
    for (const entry of this.entries.values()) if (entry.view.request.sessionID === sessionID) this.replied(entry.view.request.id)
  }

  /** Reject stale HTTP snapshots if permission events arrived during the request. */
  reconcile(requests: readonly PermissionRequest[], revision: number) {
    if (this.stopped || this.version !== revision) return
    const ids = new Set(requests.map((request) => request.id))
    for (const id of this.entries.keys()) if (!ids.has(id)) this.replied(id)
    for (const request of requests) this.asked(request)
  }

  dispose() {
    this.stopped = true
    for (const entry of this.entries.values()) entry.abort.abort()
    this.entries.clear()
  }
}

/** Mirrors the documented session scope; host source confirms direct children. */
export function visibleReview(
  views: readonly View[],
  sessionID: string | undefined,
  getSession: (id: string) => { id: string; parentID?: string } | undefined,
): View | undefined {
  if (!sessionID) return
  const session = getSession(sessionID)
  if (!session || session.parentID) return
  let first: View | undefined
  for (const view of views) {
    const request = view.request
    if (request.sessionID !== sessionID && getSession(request.sessionID)?.parentID !== sessionID) continue
    // Match native code-unit ordering; hidden requests still participate in selection.
    if (!first || request.sessionID < first.request.sessionID ||
      (request.sessionID === first.request.sessionID && request.id < first.request.id)) first = view
  }
  return first && first.status !== "unrelated" && first.status !== "identifying" && first.status !== "unidentified" ? first : undefined
}

export function displayText(text: string): string {
  // Escape controls rather than letting source/model text issue terminal commands
  // or reorder the displayed rating through bidi controls.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
}
