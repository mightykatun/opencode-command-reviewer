import { constants } from "node:fs"
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { Usage } from "./usage.js"

export interface LifetimeTotals {
  requests: number
  input: number
  output: number
  priced: number
  cost: number
  since: number | null
}
const empty = (): LifetimeTotals => ({ requests: 0, input: 0, output: 0, priced: 0, cost: 0, since: null })
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const snapshotName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/

function validate(value: LifetimeTotals): LifetimeTotals {
  if (!value || ![value.requests, value.input, value.output, value.priced].every(count)
    || !amount(value.cost) || value.priced > value.requests
    || (value.requests > 0 ? !count(value.since) || value.since > 8.64e15 : value.since !== null || value.input !== 0 || value.output !== 0)
    || (!value.priced && value.cost !== 0)) throw new Error("Invalid lifetime usage totals")
  return value
}

function add(left: LifetimeTotals, right: LifetimeTotals): LifetimeTotals {
  return validate({
    requests: left.requests + right.requests, input: left.input + right.input, output: left.output + right.output,
    priced: left.priced + right.priced, cost: left.cost + right.cost,
    since: left.since === null ? right.since : right.since === null ? left.since : Math.min(left.since, right.since),
  })
}

/** One compact atomic snapshot per plugin instance: no shared read/modify/write race. */
export class LifetimeUsage {
  private readonly id = randomUUID()
  private local = empty()
  private pending = Promise.resolve()
  constructor(readonly directory: string) {
    if (!path.isAbsolute(directory)) throw new Error("Lifetime usage directory must be absolute")
  }

  record(usage: Usage): Promise<void> {
    if (!count(usage.input) || !count(usage.output) || (usage.cost !== undefined && !amount(usage.cost))) {
      return Promise.reject(new Error("Invalid request usage"))
    }
    const increment = { requests: 1, input: usage.input, output: usage.output,
      priced: usage.cost === undefined ? 0 : 1, cost: usage.cost ?? 0, since: Date.now() }
    this.pending = this.pending.catch(() => {}).then(async () => {
      // A later successful write includes earlier increments if persistence failed.
      this.local = add(this.local, increment)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = path.join(this.directory, `${this.id}.${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, "wx", 0o600)
        try { await file.writeFile(JSON.stringify({ version: 1, ...this.local })); await file.sync() }
        finally { await file.close() }
        await rename(temporary, path.join(this.directory, `${this.id}.json`))
        const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY)
        try { await directory.sync() } finally { await directory.close() }
      } finally { await unlink(temporary).catch(() => {}) }
    })
    return this.pending
  }

  flush(): Promise<void> { return this.pending }

  async totals(signal?: AbortSignal): Promise<LifetimeTotals> {
    signal?.throwIfAborted()
    await this.flush()
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    let total = empty()
    for (const name of names.filter((name) => snapshotName.test(name))) {
      signal?.throwIfAborted()
      const file = await open(path.join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > 1024) throw new Error("Invalid lifetime usage snapshot")
        const bytes = Buffer.alloc(1025)
        let size = 0
        while (size < bytes.length) {
          const read = await file.read(bytes, size, bytes.length - size, size)
          if (!read.bytesRead) break
          size += read.bytesRead
        }
        if (size > 1024) throw new Error("Invalid lifetime usage snapshot")
        const value = JSON.parse(bytes.subarray(0, size).toString("utf8"))
        if (value?.version !== 1) throw new Error("Unsupported lifetime usage snapshot")
        total = add(total, validate(value))
      } finally { await file.close() }
    }
    signal?.throwIfAborted()
    return total
  }
}

export function lifetimeCost(totals: LifetimeTotals): string {
  if (!totals.requests) return "lifetime: no recorded usage"
  if (!totals.priced) return "lifetime: cost unavailable"
  return `lifetime: $${totals.cost.toFixed(4)}${totals.priced < totals.requests ? " (partial pricing)" : ""}`
}

export function lifetimeReport(totals: LifetimeTotals): string {
  return [lifetimeCost(totals), `${totals.requests} completed requests with usage`,
    `tokens in/out: ${totals.input}/${totals.output}`,
    `Pricing available: ${totals.priced}/${totals.requests} requests`,
    ...(totals.since === null ? [] : [`Recorded since: ${new Date(totals.since).toISOString().slice(0, 10)}`]),
    "", "Completed responses only, including format retries. Canceled requests and responses without usage are excluded. Costs are estimates; earlier usage cannot be recovered.",
  ].join("\n")
}
