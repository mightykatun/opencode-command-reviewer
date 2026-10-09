/** Fixed labels plus monotonic milliseconds and local ordinals only. No host/model data. */
export type DiagnosticPhase = "dispatch" | "headers" | "first-content" | "first-rating" | "final-validation"
  | "context.session" | "context.message" | "context.messages" | "context.projects" | "context.tool-ids" | "context.definition" | "context.skills"
  | "approval-verification" | "approval-read" | "approval-reply" | "pending-refresh"
  | "first-display" | "final-render" | "approval-countdown"
export interface DiagnosticEvent {
  phase: DiagnosticPhase
  at: number
  duration: number
  review?: number
  attempt?: number
  call?: number
}
export type DiagnosticObserver = (event: Readonly<DiagnosticEvent>) => void | Promise<void>

/** Observers are never awaited. Exceptions/rejections cannot alter the measured operation. */
export function emitDiagnostic(observer: DiagnosticObserver, event: DiagnosticEvent) {
  try {
    const result = observer(Object.freeze({ phase: event.phase, at: event.at, duration: event.duration,
      ...(event.review === undefined ? {} : { review: event.review }),
      ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
      ...(event.call === undefined ? {} : { call: event.call }),
    }))
    if (result) void Promise.resolve(result).catch(() => {})
  } catch { /* Diagnostics never become review or approval errors. */ }
}

/** Transport durations are relative to dispatch. Content means decoded assessment text,
 * not HTTP bytes/keepalives; non-streaming content becomes available after envelope decoding.
 * Final validation records completion of finish(), including a rejected assessment format.
 */
export function diagnosticAttempt(observer: DiagnosticObserver, attempt: number) {
  const start = performance.now()
  const seen = new Set<DiagnosticPhase>()
  emitDiagnostic(observer, { phase: "dispatch", attempt, at: start, duration: 0 })
  return (phase: "headers" | "first-content" | "first-rating" | "final-validation") => {
    if (seen.has(phase)) return
    seen.add(phase)
    const at = performance.now()
    emitDiagnostic(observer, { phase, attempt, at, duration: Math.max(0, at - start) })
  }
}

/** One evaluation generation. Call durations are per operation; UI durations are
 * relative to creation of this trace. Review zero is reserved for instance-wide reads.
 */
export class DiagnosticTrace {
  private start = performance.now()
  private calls = 0
  private attempt: number | undefined
  private displayed = new Set<string>()
  constructor(private observer: DiagnosticObserver, private review: number) {}
  readonly forward: DiagnosticObserver = (event) => {
    if (event.attempt !== undefined) this.attempt = event.attempt
    emitDiagnostic(this.observer, { ...event, review: this.review })
  }
  once(phase: "first-display" | "final-render" | "approval-countdown") {
    const key = `${this.attempt}:${phase}`
    if (this.displayed.has(key)) return
    this.displayed.add(key)
    const at = performance.now()
    this.forward({ phase, at, duration: Math.max(0, at - this.start), attempt: this.attempt })
  }
  async measure<T>(phase: DiagnosticPhase, run: () => Promise<T>): Promise<T> {
    const call = ++this.calls, start = performance.now()
    try { return await run() }
    finally {
      const at = performance.now()
      this.forward({ phase, call, at, duration: Math.max(0, at - start) })
    }
  }
}

export function measured<T>(trace: DiagnosticTrace | undefined, phase: DiagnosticPhase, run: () => Promise<T>): Promise<T> {
  return trace ? trace.measure(phase, run) : run()
}
