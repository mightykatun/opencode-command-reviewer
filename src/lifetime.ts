import { constants } from "node:fs"
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { Usage } from "./usage.js"
import { uiText } from "./ui-text.js"

export interface LifetimeTotals {
  requests: number
  tokenRequests: number
  input: number
  output: number
  priced: number
  cost: number
  since: number | null
  safe: number
  unsafe: number
  ratingsSince: number | null
}
const empty = (): LifetimeTotals => ({ requests: 0, tokenRequests: 0, input: 0, output: 0, priced: 0, cost: 0, since: null,
  safe: 0, unsafe: 0, ratingsSince: null })
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const snapshotName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/

function validate(value: LifetimeTotals): LifetimeTotals {
  if (!value || ![value.requests, value.tokenRequests, value.input, value.output, value.priced, value.safe, value.unsafe, value.safe + value.unsafe].every(count)
    || !amount(value.cost) || value.priced > value.requests || value.tokenRequests > value.requests
    || value.requests > value.tokenRequests + value.priced
    || (!value.tokenRequests && (value.input !== 0 || value.output !== 0))
    || (value.requests > 0 ? !count(value.since) || value.since > 8.64e15 : value.since !== null || value.input !== 0 || value.output !== 0)
    || (!value.priced && value.cost !== 0)
    || (value.safe + value.unsafe > 0 ? !count(value.ratingsSince) || value.ratingsSince > 8.64e15 : value.ratingsSince !== null)) {
    throw new Error("Invalid lifetime usage totals")
  }
  return value
}

function add(left: LifetimeTotals, right: LifetimeTotals): LifetimeTotals {
  return validate({
    requests: left.requests + right.requests, input: left.input + right.input, output: left.output + right.output,
    tokenRequests: left.tokenRequests + right.tokenRequests,
    priced: left.priced + right.priced, cost: left.cost + right.cost,
    since: left.since === null ? right.since : right.since === null ? left.since : Math.min(left.since, right.since),
    safe: left.safe + right.safe, unsafe: left.unsafe + right.unsafe,
    ratingsSince: left.ratingsSince === null ? right.ratingsSince : right.ratingsSince === null ? left.ratingsSince : Math.min(left.ratingsSince, right.ratingsSince),
  })
}

/** One compact atomic snapshot per plugin instance: no shared read/modify/write race. */
export class LifetimeUsage {
  private readonly id = randomUUID()
  private local = empty()
  private pending = Promise.resolve()
  private readonly legacyDirectories: string[]
  constructor(readonly directory: string, ...legacyDirectories: string[]) {
    if (![directory, ...legacyDirectories].every(value => path.isAbsolute(value))) {
      throw new Error("Lifetime usage directory must be absolute")
    }
    this.legacyDirectories = legacyDirectories
  }

  record(usage: Usage): Promise<void> {
    const tokens = count(usage.input) && count(usage.output)
    if ((!tokens && (usage.input !== undefined || usage.output !== undefined || usage.cost === undefined))
      || (usage.cost !== undefined && !amount(usage.cost))) {
      return Promise.reject(new Error("Invalid request usage"))
    }
    return this.increment({ ...empty(), requests: 1, tokenRequests: tokens ? 1 : 0, input: usage.input ?? 0, output: usage.output ?? 0,
      priced: usage.cost === undefined ? 0 : 1, cost: usage.cost ?? 0, since: Date.now() })
  }

  /** One accepted final review, independent of POST count or received usage. */
  recordRating(safe: boolean): Promise<void> {
    if (typeof safe !== "boolean") return Promise.reject(new Error("Invalid review rating"))
    return this.increment({ ...empty(), safe: safe ? 1 : 0, unsafe: safe ? 0 : 1, ratingsSince: Date.now() })
  }

  private increment(increment: LifetimeTotals): Promise<void> {
    this.pending = this.pending.catch(() => {}).then(async () => {
      // A later successful write includes earlier increments if persistence failed.
      this.local = add(this.local, increment)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = path.join(this.directory, `${this.id}.${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, "wx", 0o600)
        try { await file.writeFile(JSON.stringify({ version: 3, ...this.local })); await file.sync() }
        finally { await file.close() }
        await rename(temporary, path.join(this.directory, `${this.id}.json`))
        const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY)
        try { await directory.sync() } finally { await directory.close() }
      } finally { await unlink(temporary).catch(() => {}) }
    })
    return this.pending
  }

  /** Call after active review workers have finalized; this drains only writes already queued. */
  flush(): Promise<void> { return this.pending }

  async totals(signal?: AbortSignal): Promise<LifetimeTotals> {
    signal?.throwIfAborted()
    await this.flush()
    signal?.throwIfAborted()
    let total = empty()
    // Never copy legacy totals into local snapshots: concurrent/restarted instances would duplicate history.
    const directories = new Set([this.directory, ...this.legacyDirectories].map((directory) => path.resolve(directory)))
    for (const directory of directories) total = add(total, await this.readDirectory(directory, signal))
    signal?.throwIfAborted()
    return total
  }

  private async readDirectory(directory: string, signal?: AbortSignal): Promise<LifetimeTotals> {
    signal?.throwIfAborted()
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    signal?.throwIfAborted()
    let total = empty()
    for (const name of names.filter((name) => snapshotName.test(name))) {
      signal?.throwIfAborted()
      const file = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        signal?.throwIfAborted()
        const stat = await file.stat()
        signal?.throwIfAborted()
        if (!stat.isFile() || stat.size > 1024) throw new Error("Invalid lifetime usage snapshot")
        const bytes = Buffer.alloc(1025)
        let size = 0
        while (size < bytes.length) {
          signal?.throwIfAborted()
          const read = await file.read(bytes, size, bytes.length - size, size)
          signal?.throwIfAborted()
          if (!read.bytesRead) break
          size += read.bytesRead
        }
        if (size > 1024) throw new Error("Invalid lifetime usage snapshot")
        const value = JSON.parse(bytes.subarray(0, size).toString("utf8"))
        if (value?.version !== 1 && value?.version !== 2 && value?.version !== 3) throw new Error("Unsupported lifetime usage snapshot")
        total = add(total, validate({ requests: value.requests, input: value.input, output: value.output,
          tokenRequests: value.version === 1 ? value.requests : value.tokenRequests,
          priced: value.priced, cost: value.cost, since: value.since,
          safe: value.version === 3 ? value.safe : 0, unsafe: value.version === 3 ? value.unsafe : 0,
          ratingsSince: value.version === 3 ? value.ratingsSince : null }))
      } finally { await file.close() }
      signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
    return total
  }
}

export function lifetimeCost(totals: LifetimeTotals): string {
  if (!totals.requests) return uiText.lifetime.empty
  if (!totals.priced) return uiText.lifetime.costUnavailable
  return uiText.lifetime.cost(totals.cost.toFixed(4), totals.priced < totals.requests)
}

export function lifetimeReport(totals: LifetimeTotals): string {
  return [lifetimeCost(totals), uiText.lifetime.ratings(totals.safe, totals.unsafe), uiText.lifetime.requests(totals.requests),
    totals.tokenRequests ? uiText.lifetime.tokens(totals.input, totals.output, totals.tokenRequests < totals.requests) : uiText.lifetime.tokensUnavailable,
    uiText.lifetime.tokenCoverage(totals.tokenRequests, totals.requests),
    uiText.lifetime.pricingCoverage(totals.priced, totals.requests),
    ...(totals.since === null ? [] : [uiText.lifetime.since(new Date(totals.since).toISOString().slice(0, 10))]),
    ...(totals.ratingsSince === null ? [] : [uiText.lifetime.ratingsSince(new Date(totals.ratingsSince).toISOString().slice(0, 10))]),
    "", uiText.lifetime.explanation, "", uiText.lifetime.ratingsExplanation,
  ].join("\n")
}
