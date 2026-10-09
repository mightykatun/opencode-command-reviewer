import { add, empty, validate } from "./lifetime.js"
import type { LifetimeTotals } from "./lifetime.js"
import { count, decodeEvent, entryID, HistoryInvalid, opaque, reviewID, rootID, sessionID, validatePayload, validateQuery, validateReview, validateScope } from "./history-records.js"
import type { HistoryEvent, HistoryOutcome, HistoryPayload, HistoryQuery, HistoryReview } from "./history-records.js"

type Row = Record<string, any>
export interface HistoryDatabase {
  exec(sql: string): unknown
  prepare(sql: string): { run(...args: any[]): unknown; get(...args: any[]): any; all(...args: any[]): any[] }
  close(): void
}
export interface HistorySelection {
  revision: number; total: number; rank: number; entry?: string; older?: string; newer?: string
  record?: { context: HistoryReview; payload: HistoryPayload; outcome: HistoryOutcome; approvingReview?: string }
  unreadable?: boolean
}
export interface HistoryTotals { revision: number; totals: LifetimeTotals }
export interface HistorySessions { sessions: { scope: string; root: string; session: string }[]; after?: string }
export type HistoryResult = HistorySelection | HistoryTotals | HistorySessions

const schema = `
CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, revision INTEGER NOT NULL, totals TEXT NOT NULL);
CREATE TABLE writers (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
CREATE TABLE contributions (id TEXT PRIMARY KEY);
CREATE TABLE tombstones (id TEXT PRIMARY KEY);
CREATE TABLE roots (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, scope TEXT NOT NULL, root TEXT NOT NULL, session TEXT NOT NULL);
CREATE INDEX sessions_scope ON sessions(scope,id);
CREATE TABLE reviews (id TEXT PRIMARY KEY, entry TEXT NOT NULL, root TEXT NOT NULL, session TEXT NOT NULL, context TEXT NOT NULL, accepted TEXT);
CREATE INDEX reviews_root ON reviews(root);
CREATE INDEX reviews_session ON reviews(session);
CREATE INDEX reviews_entry ON reviews(entry);
CREATE TABLE attempts (id TEXT PRIMARY KEY, review TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, dispatched TEXT, finalized TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, entry TEXT NOT NULL, root TEXT NOT NULL, session TEXT NOT NULL, review TEXT NOT NULL, state TEXT NOT NULL, automatic INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX approvals_entry ON approvals(entry);
CREATE TABLE history (id TEXT PRIMARY KEY, scope TEXT NOT NULL, root TEXT NOT NULL, session TEXT NOT NULL, permission TEXT NOT NULL,
  completed INTEGER NOT NULL, tie TEXT NOT NULL, review TEXT NOT NULL, outcome TEXT, resolution TEXT NOT NULL, approving TEXT, resolvedAt INTEGER NOT NULL,
  UNIQUE(scope,permission));
CREATE INDEX history_order ON history(scope,root,completed,tie,id);
CREATE INDEX history_session ON history(session);
CREATE TABLE payloads (id TEXT PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE, body TEXT NOT NULL);
`

/** All mutation and its replay cursor share one durable transaction. */
export class HistorySQL {
  private statements = new Map<string, ReturnType<HistoryDatabase["prepare"]>>()
  constructor(readonly db: HistoryDatabase) {
    db.exec("PRAGMA busy_timeout=250; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256")
    this.transaction(() => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      if (!tables.length) {
        db.exec(schema)
        db.prepare("INSERT INTO meta VALUES (1,1,0,?)").run(JSON.stringify(empty()))
      }
      const meta = db.prepare("SELECT version,revision,CASE WHEN length(CAST(totals AS BLOB))<=4096 THEN totals END AS totals FROM meta WHERE id=1").get()
      if (meta?.version !== 1 || !count(meta.revision)) throw new HistoryInvalid("Unsupported history schema")
      this.parseTotals(meta.totals)
    })
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql)
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement) }
    return statement
  }
  private get(sql: string, ...args: any[]): Row | undefined { return this.statement(sql).get(...args) }
  private all(sql: string, ...args: any[]): Row[] { return this.statement(sql).all(...args) }
  private run(sql: string, ...args: any[]) { this.statement(sql).run(...args) }
  private transaction<T>(run: () => T, write = true): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
    try { const result = run(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
  private parseTotals(text: string): LifetimeTotals {
    if (typeof text !== "string" || Buffer.byteLength(text) > 4096) throw new HistoryInvalid("Invalid history totals")
    return validate(JSON.parse(text))
  }
  private revision(root: string) {
    const previous = this.get("SELECT revision FROM roots WHERE id=?", root)?.revision ?? 0
    if (!count(previous) || !count(previous + 1)) throw new HistoryInvalid("History revision overflow")
    this.run("INSERT INTO roots VALUES (?,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1", root)
  }
  apply(writer: string, sequence: number, serialized: string, beforeCommit?: () => void): { replay: boolean } {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(writer) || !count(sequence) || !sequence) throw new HistoryInvalid("Invalid writer sequence")
    const event = decodeEvent(serialized)
    return this.transaction(() => {
      const previous = this.get("SELECT sequence FROM writers WHERE id=?", writer)?.sequence ?? 0
      if (sequence <= previous) return { replay: true }
      if (sequence !== previous + 1) throw new HistoryInvalid("History sequence gap")
      this.event(event)
      this.run("INSERT INTO writers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence", writer, sequence)
      beforeCommit?.()
      return { replay: false }
    })
  }
  private contribute(key: string, delta: LifetimeTotals) {
    if (this.get("SELECT id FROM contributions WHERE id=?", key)) return
    const meta = this.get("SELECT CASE WHEN length(CAST(totals AS BLOB))<=4096 THEN totals END AS totals,revision FROM meta WHERE id=1")!
    const totals = add(this.parseTotals(meta.totals), delta)
    if (!count(meta.revision + 1)) throw new HistoryInvalid("History revision overflow")
    this.run("INSERT INTO contributions VALUES (?)", key)
    if (JSON.stringify(totals) !== meta.totals) this.run("UPDATE meta SET totals=?,revision=revision+1 WHERE id=1", JSON.stringify(totals))
  }
  private event(e: HistoryEvent) {
    const c = e.context, root = rootID(c), session = sessionID(c)
    if (e.type === "sessionDeleted") {
      const owner = this.get("SELECT root FROM sessions WHERE id=?", session)
      if (owner && owner.root !== c.root) throw new HistoryInvalid("Conflicting session ownership")
      const isRoot = c.root === c.session
      this.run("INSERT OR IGNORE INTO tombstones VALUES (?)", isRoot ? root : session)
      // Root and session identities are opaque; details and bodies disappear, totals never do.
      for (const table of ["history", "approvals", "reviews"])
        this.run(`DELETE FROM ${table} WHERE ${isRoot ? "root" : "session"}=?`, isRoot ? root : session)
      if (isRoot) this.run("DELETE FROM sessions WHERE scope=? AND root=?", c.scope, c.root)
      else this.run("DELETE FROM sessions WHERE id=?", session)
      this.revision(root)
      return
    }
    const context = e.context, review = reviewID(context), entry = entryID(context)
    const deleted = this.get("SELECT id FROM tombstones WHERE id IN (?,?) LIMIT 1", root, session)
    if (!deleted) {
      const existingSession = this.get("SELECT root FROM sessions WHERE id=?", session)
      if (existingSession && existingSession.root !== c.root) throw new HistoryInvalid("Conflicting session ownership")
      this.run("INSERT OR IGNORE INTO sessions VALUES (?,?,?,?)", session, c.scope, c.root, c.session)
      const existing = this.get("SELECT context FROM reviews WHERE id=?", review)
      if (existing) {
        const prior = JSON.parse(existing.context)
        if (Object.keys(context).some(key => prior[key] !== context[key as keyof HistoryReview])) throw new HistoryInvalid("Conflicting review identity")
      }
      const owner = this.get("SELECT root,session FROM history WHERE id=?", entry)
      if (owner && (owner.root !== root || owner.session !== session)) throw new HistoryInvalid("Conflicting permission ownership")
      const pendingOwner = this.get("SELECT root,session FROM reviews WHERE entry=? LIMIT 1", entry)
      if (pendingOwner && (pendingOwner.root !== root || pendingOwner.session !== session)) throw new HistoryInvalid("Conflicting permission ownership")
      this.run("INSERT OR IGNORE INTO reviews VALUES (?,?,?,?,?,NULL)", review, entry, root, session, JSON.stringify(context))
    }
    const delta = empty(), activity = delta.activity
    activity.since = e.at
    if (e.type === "attemptDispatched" || e.type === "attemptFinalized") {
      const attempt = opaque(review, e.attempt)
      if (!deleted) {
        this.run("INSERT OR IGNORE INTO attempts VALUES (?,?,NULL,NULL)", attempt, review)
        if (e.type === "attemptDispatched") this.run("UPDATE attempts SET dispatched=COALESCE(dispatched,?) WHERE id=?", JSON.stringify({ at: e.at, retry: e.retry }), attempt)
        else this.run("UPDATE attempts SET finalized=COALESCE(finalized,?) WHERE id=?", JSON.stringify({ at: e.at, usage: e.usage, reportedModel: e.reportedModel }), attempt)
      }
      if (e.type === "attemptDispatched") { if (e.retry !== "initial") activity.retries = 1; else activity.since = null }
      else if (e.usage) {
        delta.requests = activity.usageRequests = 1; delta.since = e.at
        if (e.usage.input !== undefined) { delta.tokenRequests = 1; delta.input = e.usage.input; delta.output = e.usage.output! }
        if (e.usage.cost !== undefined) { delta.priced = 1; delta.cost = e.usage.cost }
      } else activity.since = null
      this.contribute(opaque(e.type, attempt), delta)
    } else if (e.type === "reviewAccepted") {
      if (!deleted) this.run("UPDATE reviews SET accepted=COALESCE(accepted,?) WHERE id=?", JSON.stringify(e.accepted), review)
      delta.safe = e.accepted.safe ? 1 : 0; delta.unsafe = e.accepted.safe ? 0 : 1; delta.ratingsSince = e.accepted.completedAt
      activity.reviews = 1; activity.since = e.accepted.completedAt
      if (e.accepted.timing) { activity.timedReviews = 1; activity.meanFullReportMs = e.accepted.timing.fullReportMs; activity.meanRatingMs = e.accepted.timing.ratingMs }
      this.contribute(opaque(e.type, review), delta)
    } else if (e.type === "approvalConfirmed" || e.type === "approvalDispatched" || e.type === "approvalSettled") {
      const id = opaque(entry, e.approval)
      if (!deleted) {
        const old = this.get("SELECT * FROM approvals WHERE id=?", id)
        if (old && (old.review !== review || ("automatic" in e && old.automatic !== -1 && old.automatic !== Number(e.automatic))))
          throw new HistoryInvalid("Conflicting approval identity")
        const state = e.type === "approvalConfirmed" ? "confirmed" : e.type === "approvalSettled" ? e.result : "pending"
        // A late dispatch cannot undo a settlement/confirmation from another client.
        if (!old || (old.state !== "confirmed" && e.type !== "approvalDispatched")) {
          this.run("INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,automatic=excluded.automatic,at=excluded.at",
            id, entry, root, session, review, state, "automatic" in e ? Number(e.automatic) : old?.automatic ?? -1, e.at)
        } else if (old.automatic === -1 && "automatic" in e)
          this.run("UPDATE approvals SET automatic=? WHERE id=?", Number(e.automatic), id)
        this.outcome(entry); this.revision(root)
      }
      if (e.type === "approvalConfirmed") {
        if (e.automatic) activity.autoApproved = 1; else activity.since = null
        this.contribute(opaque("approvalConfirmed", id), delta)
      }
    } else if (e.type === "permissionResolved" && !deleted) {
      const old = this.get("SELECT * FROM history WHERE id=?", entry)
      const replace = !old || e.payload.completedAt > old.completed || (e.payload.completedAt === old.completed
        && Buffer.compare(Buffer.from(context.review), Buffer.from(old.tie)) >= 0)
      // Outcome and displayed report are independent. A cancellation never downgrades an approval.
      const prior = old?.resolution
      const resolution = !prior || prior === "cancelled" ? e.outcome : e.outcome === "cancelled" ? prior
        : prior === "conflict" || ((prior === "rejected") !== (e.outcome === "rejected")) ? "conflict"
        : prior === "auto" || e.outcome === "auto" ? "auto" : e.outcome
      if (replace) {
        this.run(`INSERT INTO history VALUES (?,?,?,?,?,?,?,?,NULL,?,NULL,?) ON CONFLICT(id) DO UPDATE SET
          completed=excluded.completed,tie=excluded.tie,review=excluded.review,resolution=excluded.resolution,resolvedAt=excluded.resolvedAt`,
        entry, c.scope, root, session, context.permission, e.payload.completedAt, context.review, review, resolution, e.at)
        this.run("INSERT INTO payloads VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", entry, JSON.stringify(e.payload))
      } else this.run("UPDATE history SET resolution=? WHERE id=?", resolution, entry)
      this.outcome(entry); this.revision(root)
    }
  }
  private outcome(entry: string) {
    const row = this.get("SELECT resolution FROM history WHERE id=?", entry)
    if (!row) return
    const auto = this.get("SELECT review FROM approvals WHERE entry=? AND state='confirmed' AND automatic=1 ORDER BY id LIMIT 1", entry)
    const manual = this.get("SELECT review FROM approvals WHERE entry=? AND state='confirmed' AND automatic=0 ORDER BY id LIMIT 1", entry)
    const uncertain = this.get("SELECT id FROM approvals WHERE entry=? AND state IN ('pending','uncertain') LIMIT 1", entry)
    const outcome = row.resolution === "conflict" || (row.resolution === "rejected" && (auto || manual)) ? null
      : row.resolution === "rejected" ? "rejected" : auto ? "auto" : manual ? "manual" : uncertain ? null : row.resolution
    this.run("UPDATE history SET outcome=?,approving=? WHERE id=?", outcome, auto?.review ?? manual?.review ?? null, entry)
  }
  query(q: HistoryQuery): HistoryResult {
    validateQuery(q)
    return this.transaction(() => {
      if (q.type === "totals") {
        const row = this.get("SELECT revision,CASE WHEN length(CAST(totals AS BLOB))<=4096 THEN totals END AS totals FROM meta WHERE id=1")!
        if (!count(row.revision)) throw new HistoryInvalid("Invalid aggregate revision")
        return { revision: row.revision, totals: this.parseTotals(row.totals) }
      }
      if (q.type === "sessions") {
        const rows = this.all(`SELECT CASE WHEN length(id)=64 THEN id END AS id,scope,
          CASE WHEN length(CAST(root AS BLOB))<=4096 THEN root END AS root,
          CASE WHEN length(CAST(session AS BLOB))<=4096 THEN session END AS session
          FROM sessions WHERE scope=? AND id>? ORDER BY id LIMIT ?`, q.scope, q.after ?? "", q.limit ?? 100)
        return { sessions: rows.map(row => {
          validateScope(row as any)
          if (row.id !== sessionID(row as any) || row.scope !== q.scope) throw new HistoryInvalid("Invalid session index")
          return { scope: row.scope, root: row.root, session: row.session }
        }), after: rows.at(-1)?.id }
      }
      const root = rootID(q), revision = this.get("SELECT revision FROM roots WHERE id=?", root)?.revision ?? 0
      const base = "scope=? AND root=? AND outcome IS NOT NULL"
      // Validate indexed scalar types without loading report bodies or all index rows into JS.
      const invalid = this.get(`SELECT id FROM history WHERE scope=? AND root=? AND
        (typeof(completed)!='integer' OR completed<0 OR completed>8640000000000000 OR length(id)!=64 OR length(session)!=64
        OR length(review)!=64 OR typeof(permission)!='text' OR length(CAST(permission AS BLOB))>4096
        OR typeof(tie)!='text' OR length(tie)=0 OR length(CAST(tie AS BLOB))>4096
        OR length(CAST(resolution AS BLOB))>16 OR length(approving)>64
        OR outcome NOT IN ('auto','manual','rejected','cancelled')) LIMIT 1`, q.scope, root)
      const invalidOwner = this.get(`SELECT h.id FROM history h LEFT JOIN reviews r ON r.id=h.review
        LEFT JOIN sessions s ON s.id=h.session WHERE h.scope=? AND h.root=? AND
        (r.id IS NULL OR r.entry!=h.id OR r.root!=h.root OR r.session!=h.session OR s.id IS NULL OR s.scope!=h.scope OR s.root!=?) LIMIT 1`, q.scope, root, q.root)
      if (invalid || invalidOwner || !count(revision)) throw new HistoryInvalid("Invalid history index")
      const total = this.get(`SELECT count(*) AS n FROM history WHERE ${base}`, q.scope, root)!.n
      if (!count(total)) throw new HistoryInvalid("History count overflow")
      let selected = q.entry ? this.get(`SELECT * FROM history WHERE ${base} AND id=?`, q.scope, root, q.entry)
        : this.get(`SELECT * FROM history WHERE ${base} ORDER BY completed DESC,tie DESC,id DESC LIMIT 1`, q.scope, root)
      const adjacent = (row: Row, newer: boolean) => this.get(`SELECT * FROM history WHERE ${base} AND (completed,tie,id) ${newer ? ">" : "<"} (?,?,?)
        ORDER BY completed ${newer ? "ASC" : "DESC"},tie ${newer ? "ASC" : "DESC"},id ${newer ? "ASC" : "DESC"} LIMIT 1`, q.scope, root, row.completed, row.tie, row.id)
      if (selected && q.direction) selected = adjacent(selected, q.direction === "newer") ?? selected
      if (!selected) return { revision, total, rank: 0 }
      const s = selected
      if (s.id !== opaque(q.scope, s.permission) || s.review !== opaque(q.scope, s.tie)) throw new HistoryInvalid("Invalid history ownership")
      const rank = this.get(`SELECT count(*) AS n FROM history WHERE ${base} AND (completed,tie,id)<=(?,?,?)`, q.scope, root, s.completed, s.tie, s.id)!.n
      if (!count(rank) || rank < 1 || rank > total) throw new HistoryInvalid("Invalid history rank")
      const result: HistorySelection = { revision, total, rank, entry: s.id, older: adjacent(s, false)?.id, newer: adjacent(s, true)?.id }
      const contextRow = this.get("SELECT CASE WHEN length(CAST(context AS BLOB))<=262144 THEN context END AS context FROM reviews WHERE id=? AND root=? AND session=?", s.review, root, s.session)
      if (typeof contextRow?.context !== "string") throw new HistoryInvalid("Invalid history ownership")
      const context: HistoryReview = JSON.parse(contextRow.context); validateReview(context)
      if (rootID(context) !== root || sessionID(context) !== s.session || entryID(context) !== s.id || reviewID(context) !== s.review) throw new HistoryInvalid("Invalid history ownership")
      try {
        const body = this.get("SELECT CASE WHEN length(CAST(body AS BLOB))<=524288 THEN body END AS body FROM payloads WHERE id=?", s.id)?.body
        if (typeof body !== "string" || Buffer.byteLength(body) > 512 * 1024) throw new Error()
        const payload = validatePayload(JSON.parse(body))
        if (payload.completedAt !== s.completed) throw new Error()
        result.record = { context, payload, outcome: s.outcome, approvingReview: s.approving ?? undefined }
      } catch { result.unreadable = true }
      return result
    }, false)
  }
  close() { this.db.close() }
}
