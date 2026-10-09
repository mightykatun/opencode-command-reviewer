// Isolated fixture state only. Seed through the production SQL event protocol,
// using Node's SQLite adapter; the real host subsequently uses its Bun adapter.
import assert from "node:assert/strict"
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { tsImport } from "tsx/esm/api"

const { HistorySQL } = await tsImport("../src/history-schema.ts", import.meta.url)
const { encodeEvent } = await tsImport("../src/history-records.ts", import.meta.url)
const { privateDatabase } = await tsImport("../src/history-storage-worker.ts", import.meta.url)
const file = temp => path.join(temp, "state/opencode/opencode-reviewer/history-v1.sqlite")
const legacyName = "00000000-0000-4000-8000-000000000001.json"
const legacyText = version => JSON.stringify({ version, requests: 999, tokenRequests: 999, input: 99900, output: 19980,
  priced: 999, cost: 999, since: 1, safe: 999, unsafe: 0, ratingsSince: 1,
  activity: { reviews: 999, usageRequests: 999, retries: 999, autoApproved: 999, timedReviews: 0,
    meanFullReportMs: 0, meanRatingMs: 0, since: 1 } })

export async function seedLifetime(temp, { usage, storageError = false } = {}) {
  for (const version of [1, 2, 3, 4]) {
    const directory = path.join(path.dirname(file(temp)), `usage-v${version}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(directory, legacyName), legacyText(version))
  }
  if (storageError) {
    await writeFile(file(temp), "Deliberately invalid isolated history database", { mode: 0o600 })
    return
  }
  privateDatabase(file(temp))
  const sql = new HistorySQL(new DatabaseSync(file(temp)))
  try {
    assert.equal(sql.query({ type: "totals" }).totals.requests, 0, "legacy files are excluded from fresh totals")
    if (usage) {
      const context = { scope: path.join(temp, "seed-project"), root: "seed-root", session: "seed-root",
        permission: "seed-permission", review: "seed-review", category: "bash", configuredModel: "fixture",
        provider: "https://fixture.invalid/v1" }
      sql.apply("fixture-seed", 1, encodeEvent({ type: "attemptDispatched", context, at: 1, attempt: "seed-post", retry: "initial" }))
      sql.apply("fixture-seed", 2, encodeEvent({ type: "attemptFinalized", context, at: 2, attempt: "seed-post", usage }))
    }
  } finally { sql.close() }
}

export function readLifetime(temp) {
  const db = new DatabaseSync(file(temp), { readOnly: true })
  try { return JSON.parse(db.prepare("SELECT totals FROM meta WHERE id=1").get().totals) }
  finally { db.close() }
}

export async function assertLegacyUntouched(temp) {
  for (const version of [1, 2, 3, 4]) {
    const directory = path.join(path.dirname(file(temp)), `usage-v${version}`)
    assert.deepEqual(await readdir(directory), [legacyName], "no dual writes to legacy directories")
    assert.equal(await readFile(path.join(directory, legacyName), "utf8"), legacyText(version))
  }
}
