/** Bounded queues use the same 8:1 service rule. Rotate roots within each class;
 * capacity/eligibility is supplied by the owner, never inferred from elapsed time. */
export class NotificationQueue<T extends { root: string; attention: boolean }> {
  readonly items: T[] = []
  private burst = 0
  constructor(private attentionLimit: number, private routineLimit: number) {}
  add(value: T) {
    if (this.items.filter(item => item.attention === value.attention).length >= (value.attention ? this.attentionLimit : this.routineLimit)) return false
    this.items.push(value); return true
  }
  remove(value: T) { const index = this.items.indexOf(value); if (index >= 0) this.items.splice(index, 1) }
  take(eligible: (value: T) => boolean = () => true): T | undefined {
    const candidates = this.items.filter(eligible)
    const attention = candidates.some(v => v.attention) && (this.burst < 8 || !candidates.some(v => !v.attention))
    const group = candidates.filter(v => v.attention === attention)
    const next = group[0]
    if (!next) return
    this.remove(next)
    const sameRoot = this.items.filter(v => v.attention === attention && v.root === next.root)
    for (const value of sameRoot) this.remove(value)
    this.items.push(...sameRoot)
    this.burst = attention ? this.burst + 1 : 0
    return next
  }
}

export const actionable = (kind: string) => ["attention", "unsafe", "question"].includes(kind)

/** Cancel a caller's wait without abandoning the shared worker's rejection. */
export function notificationWait<T>(worker: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void worker.then(value => { signal.removeEventListener("abort", abort); resolve(value) }, error => {
      signal.removeEventListener("abort", abort); reject(error)
    })
    if (signal.aborted) abort()
  })
}
