# Reviewer history: implementation handoff

Status: Phases 0 through 6 implemented and verified. Exact checks are recorded below.
Maintenance and final user documentation (Phase 6) remain open.

Prepared on 2026-10-09 against repository commit
`983e888d0bb7f31e4169b30ceb436046c1003a52`, package version `0.7.0`,
OpenCode `1.18.35`, and OpenTUI `0.4.5`.

This document consolidates the recursive requirements interview, the proposed
implementation, and the subsequent accuracy audit. Later audit decisions recorded
here supersede conflicting statements in the earlier conversational plan. It is
the product specification and implementation record. Phase-specific evidence below
distinguishes completed checks from the original proposed verification matrix.

### Navigation

- [Audit corrections](#11-corrections-from-the-accuracy-audit)
- [Commands](#2-commands-and-availability)
- [Scope and retention](#3-scope-identity-and-retention)
- [Exact UI contract](#4-exact-ui-contract)
- [Ordering and interaction](#5-ordering-and-interaction-state-machine)
- [Capture and outcomes](#6-capture-and-outcome-state-machine)
- [Background approval](#7-live-review-auto-approval-and-notifications)
- [Persistence](#8-persistence-design)
- [Accounting](#9-accounting-semantics-and-fresh-start)
- [Failures and shutdown](#10-failures-queueing-and-shutdown)
- [Cross-instance refresh](#11-cross-instance-refresh-and-deletion-protection)
- [Implementation phases](#12-implementation-phases-and-file-map)
- [Verification](#13-verification-plan)
- [Completion checklist](#14-completion-checklist)
- [References](#15-references-and-verified-implementation-facts)

## 1. Goal and implementation boundaries

Add `/reviewer-history` to browse persisted, resolved permission-analysis reports
in the sidebar. Preserve the existing report rendering. Add outcome and history
navigation controls, and move lifetime accounting to transactional records with
precomputed shared totals.

Product requirements are settled below. Technical module names and schema details
are the proposed implementation design. Phase 0 must prove runtime compatibility
before adopting the SQLite worker architecture. A failed compatibility check is a
technical blocker to resolve explicitly, not permission to silently change the
product behavior, supported host, package contents, or persistence guarantees.

Implementation must continue to use public plugin APIs and public TUI slots.
The only permission writer remains the existing one-time `once` writer. History
cannot execute tools, apply edits, change permission rules, resend approval writes,
or generate conversation messages/model requests.

### 1.1 Corrections from the accuracy audit

1. **Shutdown is bounded.** OpenCode 1.18.35 gives a plugin a total five-second
   disposal budget, aborts its lifecycle signal before cleanup, and invokes
   registered cleanup callbacks in reverse registration order. The earlier promise
   to wait indefinitely for storage recovery was incorrect. The user approved
   bounded draining within the remaining host budget and possible loss of the
   uncommitted remainder. See sections 10 and 15.
2. **Overflow does not add a warning.** After the approved outage queue saturates,
   recovered analytics shows the recorded totals without new warning text. Do not
   keep analytics permanently unavailable or invent a partial-history notice for
   this case. Existing received-usage coverage semantics still apply.
3. **The latest completed report wins across windows.** If one window's earlier
   Safe report causes automatic approval and another window has a newer Unsafe
   report, history shows the newer report with `Auto approved`. The rating/report
   and permission outcome describe different facts. This behavior was explicitly
   approved during the audit.
4. **A confirmed interruption can be Cancelled.** A conclusively linked user stop
   plus permission removal qualifies even without a prior automation cancellation.
   A generic error, idle event, or unexplained disappearance does not.
5. **Slash and palette visibility are coupled.** Both history command surfaces are
   required. Existing enable/disable commands remain on both surfaces. Hiding their
   palette entries is not an acceptable implementation of slash-only commands.
6. **The database worker is not already proven.** Built-in SQLite availability,
   embedded worker loading, cleanup, and reproducible packaging must be verified
   in the pinned host. The public lifecycle types alone do not prove these facts.
7. **No hidden pending report bodies on disk.** Full report text is persisted only
   after a qualifying permission resolution. Per-attempt accounting can still be
   persisted before resolution. These are separate requirements.
8. **Cancellation is not proof of operation rejection.** The approved `Cancelled`
   rule also covers a disappeared permission after recorded auto-cancellation.
   Document it as the user's display policy, not as proof that the underlying tool
   never ran. Approval/rejection facts take precedence.
9. **The footer has an approved absolute-width fallback.** Shorten the status first.
   Only if the minimum badge and exact index still cannot fit, allow additional
   footer rows. Reuse the same labels and preserve exact counts.

## 2. Commands and availability

Register through `api.keymap.registerLayer`:

| Field | Value |
| --- | --- |
| Internal command name | `opencode-reviewer.history` |
| Namespace | `palette` |
| Slash name | `reviewer-history` |
| Palette title | `Reviewer: Report history` |
| Slash suggestion descriptor | `Reviewer: Report history` |
| Category | Existing `Reviewer` |

Use the title as the slash descriptor; do not introduce separate descriptive copy.

- First invocation opens history and selects the newest eligible saved report.
- Repeating the command while open refreshes and selects the newest report,
  resetting its scroll to the top.
- Close and Escape close history. Repeating the command does not toggle it closed.
- The command resolves the selected session at invocation.
- On the home screen, the command is unavailable and performs no action.
- Existing history is available when conversation review is disabled, when a
  review-kind switch is disabled, and when current reviewer configuration is
  invalid. History reading must not call the review-mode load gate.
- History recording is enabled by default. There is no new configuration switch.
- Retain `/reviewer-enable`, `/reviewer-disable`, their existing palette titles,
  and the existing lifetime usage palette command.
- Commands remain local: no assistant prompts, conversation entries, or model work.

## 3. Scope, identity, and retention

### 3.1 Scope

A history is keyed by the invocation host directory and the **root OpenCode
conversation ID**, not by project folder alone, process, terminal window, or model.

- It includes the root and all resolvable descendant/subagent sessions.
- Opening from a child accesses that child's root history.
- Different root IDs in the same folder have separate histories.
- Two windows viewing the same root in the same host scope share history.
- A new/forked root ID is a different history; copied conversation messages do not
  copy stored reviewer history.
- Lifetime totals are shared across all roots/host directories using the same
  OpenCode state directory.

Use existing public ancestry semantics: five-second bound, at most 16 parent
edges, cycle/missing-record rejection, and bounded cache. Do not guess ownership
from directory names or bypass the depth limit with warmed cache suffixes.
Unavailable ancestry maps to the approved history read-error state and retries.

This broader history scope does not broaden live panel or auto-approval scope.
`visibleReview` continues to select root requests/direct children according to
native ordering, including hidden ordering blockers.

### 3.2 Identity

Use separate identities for:

1. Plugin writer instance and ordered storage operations.
2. Actual review execution, including a fresh review after re-enable.
3. Actual reviewer POST attempt within a review.
4. Native permission request within the invocation host scope.
5. Root history and originating session.

One canonical history entry exists per scoped permission request. The entry has a
stable identity even if a newer eligible completed review replaces its payload.
Separate external-directory and operation requests remain separate entries even
when linked to the same tool call.

### 3.3 Retention and deletion

- Keep committed history indefinitely, without automatic age/count expiry.
- Root deletion removes its full report history and detailed review/attempt data,
  including descendants.
- Child deletion removes details belonging to the deleted child. Process descendant
  deletion events and definitive absence checks individually as appropriate to the
  host's deletion behavior.
- Lifetime totals are not decremented by either deletion.
- Keep only minimal opaque replay/deletion bookkeeping needed to prevent duplicate
  totals or resurrection; do not retain deleted report bodies in bookkeeping.
- Process live `session.deleted` events immediately.
- Run bounded, resumable maintenance for deletions missed while the plugin was not
  running. Only a definitive missing/deleted result from the public API in the
  correct invocation scope permits deletion.
- A missing cached session, incomplete list page, timeout, transient error, or
  inaccessible host scope does not prove deletion.
- Maintenance must not initialize host instances in other command-target folders.
  Check another stored host scope when an appropriate instance can verify it.

Deletion means logical removal from plugin records. Do not claim forensic erasure
from SQLite pages, WAL files, filesystem snapshots, or backups.

## 4. Exact UI contract

### 4.1 Panel structure

```text
Analysis history                 [Close]

<existing Safe or Unsafe rating>

<original report rendered as today>

<available original review token/cost lines>
model: <historical model>
provider: <historical provider base URL>

--------------------------------------
[<disabled outcome>] [<] x/y [>]
```

Angle-bracket descriptions in this illustration are explanatory placeholders,
not literal UI text. The divider uses the existing theme border treatment; the
button brackets illustrate existing button shapes rather than additional label
characters.

- Full-height 42-column overlay with existing panel padding/background.
- Header and Close fixed at the top; Close is right-aligned.
- Rating keeps the existing typography, theme success/error colors, and labels.
- Report uses the same Markdown and syntax rendering as live review.
- Footer is fixed outside the scrollbox, with the existing divider treatment.
- Outcome badge is left-aligned; navigation and index form a right-aligned group.
- No timestamps, categories, extra report titles, or new explanatory text.
- Live reports retain their current appearance and inline lifetime block.

### 4.2 Approved fixed copy and formatters

| Purpose | Exact value |
| --- | --- |
| History heading | `Analysis history` |
| Close label | `Close` |
| Automatic outcome | `Auto approved` |
| Manual outcome | `Manually approved` |
| Cancellation outcome | `Cancelled` |
| Rejection outcome | `Rejected` |
| Older control | `<` |
| Newer control | `>` |
| Index | `${x}/${y}` |
| Empty body | `No history entries` |
| Loading body | `Loading history` |
| Whole-history read failure | `History could not be read` |
| Individual unreadable body | `! Unreadable entry` |
| Model metadata | `model: ${model}` |
| Provider metadata | `provider: ${providerBaseURL}` |
| Palette title/slash descriptor | `Reviewer: Report history` |

Reuse existing `✓ Safe`, `✗ Unsafe`, usage formatters, command category, and
analytics loading/unavailable strings from `src/ui-text.ts`.

Put all new fixed copy and typed formatters in that catalog. Tests must assert
literal expected wording independently. Do not introduce toasts, tooltips, helper
text, empty-state actions, or accessibility labels with invented visible wording.
If another visible string becomes necessary, obtain its exact wording first.

### 4.3 Metadata block

Inside the report scroll area, show these in order:

1. The original report.
2. That review's available token/cost components using existing `usageText` rules.
3. The model line.
4. The provider line.

All metadata uses the current muted usage styling. The model/provider lines are
always present for readable history entries, even without usage, and wrap within
the scroll area. Insert the same report-to-metadata margin as live usage today.

- Model: final successful response's model identifier, with configured model as
  fallback when absent/unusable. Store configured and reported identifiers
  separately; do not use a model from an earlier failed attempt for the display.
- Provider: normalized configured reviewer base URL, not the main assistant's
  provider, not an inferred upstream OpenRouter vendor, and not `/chat/completions`.
- Use the existing base URL validation, which excludes credentials, query, and
  fragment. Never store API keys or request headers.
- Metadata is historical and does not follow subsequent config changes.
- Sanitize all rendered stored strings through `displayText`, including metadata.
- History has no lifetime cost line or lifetime Safe/Unsafe count line.

### 4.4 Controls and overflow

- Outcome badge is always disabled, muted, and non-interactive.
- Enabled Close/arrows use normal theme text and the existing hover highlight.
- Disabled arrows use muted text and do not respond to click or navigation keys.
- No wrapping from oldest to newest or vice versa.
- The index uses exact decimal integers, no grouping, and no spaces around `/`.
- Adjacent footer controls have one space between them. Flex alignment can occupy
  the remaining space between the left badge and right navigation group.
- Keep the normal single-row footer.
- If needed, middle-shorten the outcome using exactly two ASCII dots, balanced
  retained ends, and a minimum of three characters at each end. For an odd retained
  character count, keep the extra character on the left. Never shorten a label
  that already fits.
- Minimum short forms: `Aut..ved`, `Man..ved`, `Can..led`, `Rej..ted`.
- Do not abbreviate counts or drop controls. If an extreme index cannot fit even
  with the minimum badge and existing button padding, use the approved last-resort
  additional rows: status first, right-aligned navigation group second. Restore
  the full status if it fits its separate row.
- If the navigation group alone is too wide, place the exact index on its own
  right-aligned row above the arrow-control row. This handles the maximum safe
  integer widths within the 38-column padded interior. Add no text.
- Include synthetic boundary tests for one-, two-, and three-row layouts. Additional
  rows remain fixed footer content outside the report scrollbox.

### 4.5 Empty, loading, and invalid records

- Empty/loading/whole-view error: heading and Close remain; no rating or footer.
- One readable report: outcome badge, disabled `<`, `1/1`, disabled `>`.
- Individual invalid record: retain its index, show only `! Unreadable entry` in
  the same warning color and bold typography as live unavailable status, omit
  report/rating/outcome, and retain navigation.
- Only construct a placeholder when a valid index/identity can establish an entry.
  Corruption preventing reliable enumeration is a whole-history read failure.
- Retry read errors every two seconds. Revalidate the selected invalid payload even
  if the normal change revision has not changed, so a repair can be detected.
- Do not flash Loading or reset scroll for successful periodic background refreshes.

## 5. Ordering and interaction state machine

### 5.1 Ordering

Order by controller acceptance/completion timestamp, not permission resolution,
database insertion time, or approval time. Use a stable review-ID tie-breaker for
equal timestamps. Monotonic durations remain separate from persisted wall-clock
ordering timestamps; do not compare `performance.now()` values across processes.

- Oldest entry is `1/y`; newest is `y/y`.
- `<`/Left selects the adjacent older entry; `>`/Right selects the adjacent newer.
- A newly resolved older report is inserted at its completion-order position.
- Preserve selected entry identity when insertion/replacement changes its index.
- All four eligible outcomes enter an open history, including background outcomes.
- New entries update the index/total and are reachable immediately after commit.
- Do not jump to new entries if there is already a selection.
- The first entry automatically replaces an open empty state and selects `1/1`.

### 5.2 Scrolling and keyboard

- Opening, repeating the command, and changing selection start at report top.
- Ordinary refreshes and updates to counts/status preserve selected report scroll.
- A selected entry whose actual report payload is replaced by a newer completed
  review resets to the top as new report content, while retaining entry identity.
- Left/Right navigate; Up/Down and PageUp/PageDown scroll; Escape closes.
- Consume those unmodified keys only while history can actually accept input.
- At an end, navigation is a consumed no-op, not prompt cursor movement.
- Ordinary typing and other host shortcuts continue to reach their normal owners.
- Public host mode/dialog state and actual covering surfaces take precedence,
  including slash autocomplete. Do not intercept their navigation or Escape.
- Mouse wheel/scrollbar operate on history, not the covered live report.
- Disabled badge/arrows never invoke an approval or mutate live controller state.

### 5.3 Open/hidden/closed state

Keep logical open state separate from mounted/actually visible state.

- Hidden/narrow sidebar or covering native dialog/fullscreen makes history
  temporarily hidden without forgetting its selection/scroll.
- Invoking in that state silently arms history for later display.
- Do not force sidebar opening or persist layout changes.
- Close/Escape while interactive closes it.
- A session route change closes it, even between members of the same root.
- Home navigation or root deletion closes it.
- If deletion removes the selected child report, select the next newer survivor,
  then the nearest older survivor, then the empty state.
- Guard all async loads with open-generation, root, selection, and lifecycle
  identity so late results never reopen a closed panel or another root's history.

## 6. Capture and outcome state machine

### 6.1 Eligible report

Capture only controller-accepted, completed, validated assessments. Streaming
previews, stale completions, failed analyses, and interrupted new assessments are
not history candidates. Preserve the latest completed candidate in memory when a
mode change clears the live view or starts a fresh assessment for that permission.

An earlier completed candidate remains eligible if its replacement never completes.
A later completed candidate replaces it. Lifetime accepted-review accounting
counts both completed reviews independently.

Do not serialize unresolved report bodies into the database, a spool, diagnostics,
or a worker message that becomes a durable hidden candidate. On restart such
in-memory candidates are lost; startup must not reconstruct them from old prompts,
host conversations, model calls, or tool output.

### 6.2 Resolution facts and precedence

Capture reply properties before `Controller.replied()` deletes the entry. The
current call site passes only request ID and discards the native reply kind.
Capture the latest accepted candidate before both reply and reconciliation cleanup.

| Observed facts | Eligible outcome |
| --- | --- |
| Matching confirmed automatic reviewer write | `Auto approved` |
| Matching confirmed user-clicked reviewer footer write | `Manually approved` |
| Unambiguously native/manual `once` or `always` reply | `Manually approved` |
| Explicit native `reject` reply | `Rejected` |
| Conclusively linked user interruption and permission removal | `Cancelled` |
| Removed request, known prior automation cancellation, no later known approval/reject | `Cancelled` |
| Removed request without a qualifying fact | Omit |
| Dispatched approval with uncertain attribution | Omit until attribution is resolved |

Precedence rules:

1. Deletion prevents insertion and removes existing detail; it is not a report
   outcome. Disposal alone also does not establish an outcome.
2. A known final approval/rejection supersedes earlier cancellation.
3. A dispatch is not success. While its original bounded acknowledgement is
   outstanding, defer classification that would label the same action manual.
4. A lost acknowledgement cannot be converted into automatic success based on an
   empty pending list, idle event, or a native `once` reply alone.
5. A known unconfirmed dispatched write remains ambiguous; prior cancellation
   cannot be used to bypass that ambiguity and label it `Cancelled`.
6. An explicit reject is a known rejection, subject to resolving contradictory
   stale/identity facts rather than guessing a different permission's outcome.

Automation cancellations include explicit Cancel, sidebar/dialog/fullscreen loss,
and mode-related cancellation actually recorded by the controller. Do not invent
an automation cancellation merely because an unstarted countdown was ineligible.

A confirmed user interruption requires a public event/tool link attributable to
the relevant session/request and a current disappearance check. Do not use a
root's generic idle/error event to label all descendant requests cancelled.

### 6.3 Cross-window outcomes

Native reply events do not identify the submitting client. Absence of a local
automatic dispatch does not by itself prove another window did not dispatch one.

Use shared, bounded ownership/outcome observations where available and preserve
conservative omission when attribution remains uncertain. Do not add a mandatory
database commit before approval merely to simplify this race. Storage is not an
approval gate. Test delayed, unavailable, and reordered cross-window observations.

The selected history report is still the latest completed one, even if a different
report caused the confirmed automatic approval. Store the approving review's
identity separately when known; do not substitute it into the displayed payload.

Exactly-once database processing prevents duplicate accounting of the same local
event. It does not deduplicate distinct model requests made by separate windows:
those are real requests and each contributes received usage.

## 7. Live review, auto-approval, and notifications

History has no effect on the timing or notification policy of background analysis.
The history layer alone is an explicit exception to live-panel occlusion rules.

### 7.1 Required behavior

- Keep the live report mounted beneath history when it otherwise belongs there.
- A final Safe assessment can become ready and begin its countdown behind history.
- An existing countdown keeps its deadline when history opens/closes/navigates.
- Preserve the positive-delay initial one-second hold and zero-delay behavior.
- Never derive approval eligibility from the historical report's rating.
- Resolution immediately removes the live request even while history stays open.
- Completed background outcomes can enter history after their storage commits.

All other existing gates remain, including category/origin, root mode, request
ordering, current identity/scope, final validation, final Markdown readiness,
hidden/narrow/sidebar state, dialogs/fullscreen, and no previous manual-only
cancellation or uncertain dispatch. Opening history cannot revive automation.

### 7.2 Presentation refactor

Separate these concepts explicitly:

1. Live assessment identity and final-render readiness.
2. Live candidate selection/order for the active native session.
3. Physical hit-test ownership/covering surface.
4. Approval eligibility under a known history-only cover.

The exception requires the same final highlighted, non-streaming live content to
be ready under a valid frame/generation. It is not permission to skip rendering
because history is open. Confirm the renderer actually performs the required
underlying work in the Phase 0 fixture.

Use public hit testing at stable panel positions. Coverage by this plugin's history
panel may qualify; coverage by an unrelated host surface may not. History empty,
loading, and error variants need stable ownership probes too, even without footers.
Do not probe transient arrow/button hit targets for live approval eligibility.

Keep diagnostics truthful: an obscured report must not generate a physical
`first-display` claim merely because its approval readiness gate passed. Review
existing diagnostic phase definitions before changing their interpretation.

### 7.3 Notifications

Continue using current review snapshots and approval facts. History opening,
browsing, refresh, and replay of saved data never create notification births,
attention episodes, new review counts, or approval sounds. Existing countdown
suppression and confirmed-success audio apply to approvals behind history.

## 8. Persistence design

### 8.1 Location and runtime

Proposed database path:

```text
<api.state.path.state>/opencode-reviewer/history-v1.sqlite
```

The filename is a technical implementation choice, not user-facing copy or a new
setting. The database is plugin-owned and separate from native OpenCode databases.

Proposed execution:

- One dedicated storage worker per plugin instance.
- Bun's public `bun:sqlite` in the pinned host.
- A thin adapter using `node:sqlite` for supported Node test environments.
- Embed a separately bundled worker source into `dist/tui.js` during build.
- No runtime source checkout dependency, native-addon installation, downloaded
  executable, separate worker package file, or third-party daemon.
- Preserve exactly `dist/tui.js`, `package.json`, `README.md`, `LICENSE`, and
  `THIRD_PARTY_NOTICES.md` in the npm archive.

Verify worker creation/termination and SQLite imports in the actual compiled host.
Do not assume a Bun API supported by current online documentation exists in the
host's embedded runtime. Keep the Node adapter on the declared development floors;
do not silently raise package runtime engines to solve test-only compatibility.

### 8.2 Database settings and ownership

- Use transactions, foreign keys where appropriate, validated schema versions,
  indexed root/session/permission lookup, and durable commits.
- Prefer WAL with `synchronous=FULL` on the supported local Linux filesystem.
- Treat checkpointing and database initialization as owned worker work.
- Private state directory permissions and database/WAL/SHM permissions must protect
  report text. Never change the process-wide umask to achieve this.
- Do not follow an unexpected database symlink, recreate a corrupt database, or
  silently reset an unsupported schema to empty totals.
- A checksum or payload validation can detect application-level invalid entries;
  do not claim it makes arbitrary SQLite corruption individually recoverable.
- Schema installation/migration must serialize safely across two starting instances.

### 8.3 Logical tables

Exact SQL names may follow existing conventions; preserve these responsibilities:

| Table area | Required contents and purpose |
| --- | --- |
| Schema metadata | Version, initialization state, aggregate revision |
| Sessions/roots | Scoped IDs, stored parent/root ownership, detail deletion state |
| Reviews | Unique execution ID, request/session/root keys, category, configured model/provider, accepted rating/timestamps/timing when available; no pending report body |
| Attempts | Unique `(review, attempt)` identity, dispatched retry kind, available reported model, finalized received usage and validity components |
| History index | One row per scoped permission, selected latest completed review, completion-order key, resolution/outcome, payload identity/version |
| History payload | Full resolved report, validated rating, original report usage, final model/provider; bounded and independently validated |
| Lifetime totals | Current aggregate counters, coverage counts, totals, timestamps and weighted online means |
| Writer checkpoints | Per-writer contiguous committed operation sequence for safe replay |
| Change revisions | Root/global revisions for refresh without scanning report bodies |
| Deletion tombstones | Minimal opaque identities preventing late detail resurrection |

Separate a valid entry index from its payload so a malformed payload can retain a
stable navigation placeholder. A corrupt ownership/index record cannot be used to
invent which conversation owns a report.

Index history by `(scope, root, completedAt, reviewTieBreak, entryID)` and by
`(scope, permissionID)`. Selection is by entry ID. Queries for a page, selected
payload, neighbor, rank, and total must see one consistent database snapshot.

Keep only bounded pages/selected bodies in UI memory. Indefinite on-disk retention
does not justify loading every report into a JavaScript array. A count/rank query
for history navigation is separate from lifetime analytics, which reads a single
precomputed aggregate and never sums historical rows on open.

### 8.4 Stored data and validation

Approved data includes:

- Root, originating session, permission, review and attempt identities.
- Review kind and invocation host scope needed for partitioning.
- Completion/resolution timestamps and outcome facts.
- Per-review timing measurements and aggregate sample counts/means.
- Configured reviewer model, reported reviewer model, normalized reviewer base URL.
- Received attempt tokens/cost, validity/coverage and retry classification.
- Full final report after qualifying resolution and its original report usage.

Do not copy raw permission metadata, tool arguments, commands, evidence, prompts,
source files, main-assistant model/provider, credentials, headers, provider error
bodies, or whole API envelopes into storage. Report text itself can contain private
material, as accepted by the user.

Keep the existing assessment text bound. Validate loaded data as untrusted, with
finite nonnegative costs/timings, safe integer counts, valid enums, and bounded
string/JSON decoding. Do not silently truncate accepted report text or fabricate
zero token/cost values. Keep parsing limits outside the model's response contract.

### 8.5 Event/transaction protocol

Storage observers must receive the correlation information the current callbacks
lack. Do not misuse the privacy-restricted diagnostic observer for this purpose.

Proposed operations:

1. `attemptDispatched`: stable review/attempt identity and retry classification.
2. `attemptFinalized`: received final usage/model metadata, including no-usage fact.
3. `reviewAccepted`: final boolean, completion time, timing, and model identity,
   without pending report text.
4. `approvalConfirmed`: confirmed automatic count and outcome attribution.
5. `permissionResolved`: latest in-memory completed report plus resolved facts,
   making an eligible history payload writable for the first time.
6. `sessionDeleted`: remove details and establish anti-resurrection state.

For each admitted operation:

- Assign writer identity and monotonic sequence before sending it to the worker.
- Keep it owned by the bounded queue until a successful commit acknowledgement.
- In one transaction, validate sequence, apply row changes, apply only new aggregate
  deltas, update the checkpoint and relevant revisions, then commit.
- A repeated already-committed sequence is acknowledged without applying deltas.
- Detect sequence gaps rather than accepting out-of-order partial accounting.
- Do not assign an admitted sequence to operations rejected by queue saturation.
- Lost worker acknowledgements may replay this database operation, never HTTP
  reviewer calls or permission approval writes.

Make admitted lifecycle operations self-contained enough to validate their scope
and create a minimal parent/attempt row when an earlier operation was dropped
during saturation. Such an upsert does not synthesize a missing dispatch, retry,
accepted-review count, or usage component. Track whether each metric contribution
was actually applied rather than inferring it from the existence of a detail row.
Test a dropped dispatch followed by a later admitted finalizer, and a dropped
acceptance event followed by a later admitted resolved history entry.

Transactions for different events can commit at different lifecycle stages.
Atomicity means each event's record and aggregate effect commit together; it does
not mean the complete network review and permission resolution are one transaction.

Do not increment reviews again when inserting a history payload, replacing the
canonical report, displaying a record, refreshing, or receiving a duplicate event.

## 9. Accounting semantics and fresh start

### 9.1 Fresh storage

- New analytics starts at zero on first initialization of this store.
- Leave legacy `usage-v1` through `usage-v4` files untouched and excluded.
- Do not dual-write new events to the old store.
- Restarting the new plugin resumes its new totals; it does not reset again.
- Old plugin versions may continue maintaining their old files. Their writes are
  not imported or combined with this new store.
- History has no recoverable pre-feature reports.

### 9.2 Preserve existing metric meaning

- Reviews: controller-accepted final assessments, including those without usage.
- Safe/Unsafe: accepted final ratings, not history entry counts.
- Retries: extra POSTs actually dispatched, including transport and format retries.
- Received usage: finalized observations from any POST, including failed,
  interrupted, and later-rejected attempts.
- Tokens: valid input/output pair; cost is independently available.
- OpenRouter: exact normalized endpoint's finite nonnegative reported `usage.cost`,
  including cost-only and zero reports. No inference-cost addition or estimate.
- Generic endpoints: existing exact catalog matching, cache rules, context tiers,
  and estimated-cost invalidation.
- Report usage: each component shown only when it covers the entire POST chain.
- Auto-approved: only confirmed automatic success; manual footer/native approval
  and uncertain writes do not contribute.
- Timings: existing monotonic boundaries and accepted-attempt first rating; retries
  reset the rating timestamp; final acceptance excludes rendering/countdown.
- Means: update online using sample weights, never average per-instance averages
  without their weights.

Attempt rows may exist without received usage. Their existence must not change
the current `requests`/token/pricing coverage denominator into all dispatched POSTs.
Preserve the distinction between internal attempt inventory and current
received-usage accounting semantics.

### 9.3 Existing presentation

Retain exact analytics dialog labels, number formatting, percentages, ordering,
loading and unavailable wording. Retain live inline lifetime presentation. History
uses its own metadata block without inline lifetime figures.

Opening analytics reads the precomputed aggregate row and performs only presentation
formatting. It never scans old instance snapshots, review records, or attempts to
reconstruct totals. Data deletion never triggers subtraction or a rebuild.

While saves/reads are unhealthy, show the existing unavailable state. Once storage
recovers, show the recorded totals, including after queue overflow, **with no new
warning**. Do not abuse token/pricing partial-coverage flags to imply knowledge of
events that were dropped. Unknown provider usage still follows existing flags.
An internal loss marker may support tests/diagnostics without adding UI text.

## 10. Failures, queueing, and shutdown

### 10.1 Outage policy

- Only persistence waits. Analysis, countdowns, approvals and notifications proceed.
- Retry failed saves on a two-second schedule while the instance runs.
- Retain admitted unsaved operations up to 64 MiB.
- Measure retained serialized payload bytes plus a fixed per-operation bookkeeping
  allowance; include in-flight/unacknowledged operations. Avoid unbounded IPC message
  queues and duplicate retained report buffers. Verify actual memory stays bounded
  to a constant multiple of that fixed budget.
- At saturation, preserve queued operations and stop admitting new history and
  accounting operations until capacity recovers. Do not evict older operations.
- Omitted events may be unrecoverable. Do not later invent their usage or ratings.
- A report is browsable only after its history transaction commits. There is no
  current-instance unsaved-history fallback and no save-failure toast.
- Readable previously committed history remains usable when only writes fail.
- Distinguish temporary storage failure from invalid input/schema errors; never
  repair by silently deleting/resetting the store or poisoning every retry with
  an unchecked invalid operation.

Keep the last completed report candidate per currently pending request separate
from the outage queue. Drop candidates on resolution/deletion/disposal after their
admission decision. Do not retain resolved-but-unadmitted reports outside the queue
as an unbounded backdoor around the approved limit.

### 10.2 Worker deadlines and actual ownership

- Use bounded database lock waits and bounded read requests.
- One actual worker operation must retain ownership through its real settlement;
  a caller timeout does not authorize starting unlimited replacement work.
- Coalesce refreshes to one actual read and at most one follow-up, preserving the
   stale-result/write-failure protections now shared by `HistoryRefresh`.
- Schedule saves, interactive reads, polling and maintenance fairly. A failed write
  waiting for its next retry must not block all readable committed history.
- Kill/restart a failed worker only with known ownership/exit handling. Replay
  admitted operations by checkpoint after an uncertain commit.
- No UI callback, notification, or permission write is executed by the worker.

### 10.3 Bounded shutdown

The host's five-second budget covers the plugin's complete cleanup list. It is
not a fresh five seconds for each subsystem or for the final database flush.

1. On lifecycle abort, record the local disposal start and immediately disable UI
   publication, commands, polling, and new ordinary work.
2. Start notification cleanup and review/approval aborts without unnecessary serial
   waits. Preserve the current obligation to let real review finalizers enqueue
   their received usage while time remains.
3. Drain the admitted storage queue and session-mode writes within the remaining
   cleanup budget, reserving time to close/terminate owned worker resources.
4. Use a plugin-owned deadline below the host limit, proposed four seconds from
   lifecycle abort, leaving approximately one second for remaining host callbacks.
   Test actual registration order and adjust downward if needed.
5. Stop retries at that deadline. Request worker close and bound cleanup. Late
   callbacks cannot publish or start new work. Do not leave a background retry loop
   alive after plugin deactivation.
6. Committed records remain durable. Uncommitted/uncertain remaining events can be
   lost when the host exits; a commit whose acknowledgement was lost may already
   exist and must not be duplicated on any later replay.

Do not intercept host exit, manipulate private disposal timeouts, or introduce a
detached persistence daemon to simulate the previously rejected indefinite wait.

## 11. Cross-instance refresh and deletion protection

- Local successful commits immediately invalidate/update local views.
- Poll every two seconds for revisions affecting an open root history or shared
  analytics, and fetch latest committed state on opening either surface.
- The two-second requirement is the healthy-storage polling cadence, not a promise
  to overcome locked/stalled storage or a stopped process within two seconds.
- If a read fails, keep the approved error behavior and retry on that cadence.
- Maintain consistent count, selected index and neighbors in each snapshot.
- Increment root revisions for insertion, replacement, payload repair and deletion;
  increment aggregate revision only when its state changes.
- A stale response must not overwrite a newer write-failure state, root switch,
  deletion, or dismissed dialog.

Deletion transactions suppress detail writes that arrive late from either window.
Lifetime deltas from genuine already-started work still follow accounting policy,
but must not recreate deleted detail rows. Minimal replay cursors/tombstones can
remain after deletion so duplicate messages cannot double-count totals.

Do not let queue saturation silently disable deletion maintenance. If a deletion
transaction cannot yet be admitted, invalidate affected local UI/candidates and
retain a bounded maintenance-dirty signal so verified-session scanning retries the
deletion after recovery. Give deletion reconciliation priority before publishing
recovered details for an affected scope. Do not promise cross-instance deletion
visibility during an unavailable database; apply the normal revision refresh after
its durable tombstone commits.

## 12. Implementation phases and file map

### Phase 0: prove host compatibility and freeze contracts

Before committing to the storage implementation:

- Verify the pinned host can load the embedded worker and import public SQLite.
- Verify worker messaging, transaction commit acknowledgement, data-only protocol,
  no inherited model credentials sent in worker payloads, and bounded disposal.
- Verify the archive still contains exactly five files and builds reproducibly.
- Verify final live Markdown still becomes ready when covered by the history
  overlay, without falsely reporting physical display or starting approval early.
- Verify public keymap modes can give history keys priority over prompt movement
  while yielding to native dialogs/autocomplete.
- Capture results in focused fixtures. If a proof fails, resolve that technical
  blocker before implementing dependent phases; report any required product change.

Update relevant maintainer-guide rules alongside their implemented replacement,
not in advance as if the feature already existed. The prior visible-only approval
contract, no-report persistence descriptions, and usage-v4 architecture need
explicitly scoped replacements for this feature.

### Phase 1: typed events and storage core

- [x] Typed events, transactional storage, bounded worker/queue, refresh and
  production-adapter verification complete. Integration remains in later phases.

Proposed additions:

| File | Responsibility |
| --- | --- |
| `src/history-records.ts` | Bounded record/event types, stable identities and validation |
| `src/history-schema.ts` | Versioned SQL schema, statements, aggregates and migrations |
| `src/history-storage-worker.ts` | Worker protocol and runtime-specific SQLite adapter |
| `src/history-store.ts` | Queue admission, retry, correlation, replay and disposal |
| `src/history-refresh.ts` | Coalesced root/aggregate reads and revision guards |

The storage protocol should be data-only and independently testable. Persist no
unresolved report bodies. Test transaction faults and two real database clients
before connecting the TUI.

### Phase 2: reviewer/controller lifecycle integration

- [x] Correlated reviewer/controller events, in-memory candidate coordination and
  TUI lifecycle wiring implemented. Legacy lifetime callbacks were retained during
  Phase 2 and have now been removed from active wiring by Phase 3.
- Native `once` attribution is conservative: the public keymap trace does not
  carry the selected option/request identity. Neither it nor absence of a local
  dispatch proves a manual reply. Confirmed footer/automatic acknowledgements and
  explicit native `always`/`reject` are used. Linked assistant-message abortion
  plus removal can qualify as cancellation, without generic idle attribution.
- The existing schema gains bounded data-only `resolution` and `session` queries,
  plus `permissionOutcome` updates for late explicit outcomes on resolved records.
  No table migration or unresolved body event is introduced. Up to 128 removed
  candidates can await shared confirmation in memory for 6.5 seconds; checks retain
  actual read ownership and run at two-second cadence. Unavailable/late attribution
  is conservatively omitted. A later confirmation can still update an already
  committed entry independently of its latest report. No storage commit gates
  permission approval. Offline maintenance/dirty-deletion replay remain Phase 6.

- `src/types.ts`: carry endpoint/model result metadata outside `Assessment` and its
  strict model JSON; define storage-facing events separately from diagnostics.
- `src/reviewer.ts`: capture configured/final response model, per-dispatch retry
  kind, and exactly-once attempt finalization without changing POST bytes or retry
  behavior.
- `src/usage.ts`: preserve existing parsers/coverage rules; expose needed normalized
  received components without adding billing requests or storing raw envelopes.
- `src/controller.ts`: expose accepted-review identity/timing, actual cancellation,
  resolution reason, and existing dispatched/confirmed/settled facts. Retain
  stale-snapshot checks and single-flight approval behavior.
- New `src/history-coordinator.ts`: own latest completed in-memory candidates,
  scoped ancestry, outcome attribution, replacement rules and persistence admission.
- `src/tui.tsx`: forward full public reply events before cleanup; wire deletion and
  confirmed interruption facts; keep orchestration narrow.

Observers remain non-blocking and exception/rejection-isolated. A storage event
cannot turn a valid assessment into an error, change a rating, extend a model
deadline, or cause a permission write.

### Phase 3: lifetime storage replacement

- [x] `src/lifetime.ts` retains pure metric validation, weighted aggregation and
  exact presentation helpers. Removed the per-instance snapshot writer/scanner.
- [x] `src/lifetime-view.tsx` reads `HistoryStore` precomputed totals through
  `HistoryRefresh`; removed the redundant `lifetime-refresh.ts`. Local commits and
  palette open refresh immediately; shared totals poll every two seconds. Read
  cleanup retains actual ownership; write failures invalidate stale reads; abort
  stops polling/publication and late results never replace dismissed dialogs.
- [x] `src/tui.tsx` constructs the store before the tracker and uses only the
  correlated history lifecycle/POST events for writes. Legacy usage/rating/retry/
  auto-approval callbacks are disconnected; no replacement increment events.
- [x] Fresh zero totals, restart/resume, two actual worker clients, duplicate
  correlation replay, independent received usage and weighted metrics are tested.
  Legacy `usage-v1` through `usage-v4` stay untouched and excluded.
- [x] Shared isolated `scripts/smoke-lifetime.mjs` seeds production SQL events via
  the Node adapter with consistent review/POST identities. All three existing
  fixture families verify large legacy seeds remain unchanged and receive no writes.
  Storage-error injection now targets the new database. Real-host reads use Bun.
- [x] Existing lifetime labels, formatting and inline eligibility are preserved.
  Stats fixtures verify recorded-only totals and no new partial-history warning.

### Phase 4: history UI and command state

- [x] `history-controller.ts` implements logically open/root/selection state through
  `history.root`, independently of mode loading and configuration validity. Indexed
  selection snapshots and `HistoryRefresh` preserve identity on insertions and reset
  on replacement/repeat/navigation. Reads and ancestry are generation guarded.
- [x] The query includes a validated saved order cursor for bounded deletion fallback
  to next newer, then nearest older. Root tombstones close the view. Selected-session
  identity remains available with invalid payloads for local deletion invalidation.
- [x] `history-view.tsx`, `history-layout.ts` and shared `review-description.tsx`
  implement the approved copy, 42-column layout, disabled outcomes, navigation,
  overflow and sanitized metadata, without historical lifetime lines. Scroll offset
  is controller-owned and restored after Markdown and measured layout readiness.
- [x] `history-commands.ts` registers both local command surfaces and unmodified
  base-mode keys at priority 100. Actual heading/footer ownership and native dialogs
  gate input. Normal typing and native autocomplete continue to work.
- [x] Public app-slot wiring keeps the live report as a separate mounted sibling.
  Phase 5 below adds its narrowly scoped cover exception. Phase 6 maintenance
  remains separate.

Implemented additions:

- `src/history-controller.ts`: open/root/selection state, indexed ordering, refreshing,
  scroll reset signals, keyboard eligibility and deletion fallback.
- `src/history-view.tsx`: header, shared report rendering, metadata, placeholders,
  fixed outcome/navigation footer and exact status shortening.
- `src/history-commands.ts`: local slash/palette action and scoped keymap bindings.

Extract shared report rendering from `src/tui.tsx` only as needed. Preserve the
live `ReviewDescription`, theme ownership, `displayText`, scroll behavior and
render-readiness semantics. Do not add historical fields to the live metadata
block. Add all approved fixed copy to `src/ui-text.ts`.

### Phase 5: history-only approval cover exception

- [x] Production `HistoryView` registers actual mounted ownership with the narrow
  `history-cover.ts` helper. Current browser/route/sidebar session and both stable
  heading/lower-interior hit probes are required. Footerless empty/loading/error
  states include the public ScrollBox viewport hierarchy. No normal-plugin caller
  can nominate another cover.
- [x] A stable app-slot box contains the separate keyed live and history siblings.
  The host replaces a changing fragment's live child; using a stable root prevents
  that replacement and its spurious cancellation. Proven hit identities bridge only
  the current paint during close/child replacement and clear on the next live frame.
- [x] Live assessment identity, exact sanitized Markdown, completed non-streaming
  highlighting and its painted frame still precede approval eligibility. Physical
  first-display/final-render diagnostics remain separate and truthful. History
  ratings never participate in the live decision.
- [x] Existing deadlines survive history open/close/navigation. Native dialog,
  fullscreen, hidden/narrow sidebar, session/order/mode and durable cancellation/
  uncertain-write gates remain. History controls never submit an approval.
- [x] Actual-host fixtures use public direct dispatch of the registered history
  command while a countdown runs, plus the literal slash command after resolution.
  Native palette opening itself cancels an ongoing countdown, as required by the
  native-dialog gate. Selecting Report history from that palette does not revive it.
  This is distinct from non-modal dispatch, not a product mismatch.
- [x] Committed background reports update counts without changing the current
  selection and are navigable afterward. Notifications retain the existing final
  render grace, countdown suppression and confirmed-success sound. Replaying history
  adds no notification birth, sound, model request or permission reply.
- [x] Focused tests and actual production-history fixtures include loading/error,
  retained render identity, native negative gates and manual/mode tombstones.
  Exact executed checks and artifact locations are recorded below.

### Phase 6: cleanup, packaging, and documentation

- [x] Maintenance component implemented after `c8cb4b3`: bounded public-API
  deletion scanning, dirty-deletion recovery, publication gating and existing
  transactional late-write protection.
- [x] Final integration audit, README/metadata/maintainer updates, package checks,
  supported Node-floor checks and targeted final-host regressions completed.
- `src/history-maintenance.ts` retains at most one indexed ownership page (100 rows),
  checks one row per two-second turn in the invocation scope, and checks root before
  child. Turns have a five-second budget and host probes a 1.5-second abort bound.
  Aborted/timed-out host and database work retains its single-flight slot through
  actual settlement. No other host scope is initialized or scanned.
- Definitive absence requires the pinned public `session.get` HTTP 404 and exact
  `NotFoundError` envelope with `Session not found: <requested ID>`. The packed real
  host fixture verified this shape, including native root deletion cascading.
  Partial listings, missing data, other 404 shapes, 403 and transient/aborted reads
  do not delete. Unknown root results prevent child deletion checks.
- Live deletion marks a revisioned scope-wide dirty signal before asynchronous
  ownership lookup. Unknown/saturated lookups retain no missed-ID queue. The local
  browser and store suppress stale/reopened history while dirty; a complete healthy
  same-revision pass and drained admitted writes release the gate. Lifetime metrics
  remain independent. New dirty revisions restart scanning; failed rows retry on
  subsequent passes. Other clients observe committed tombstones via normal refresh.
- Additive v1 indexes support scoped root and cascading detail deletion. Existing
  tombstones/contribution replay keys retain anti-resurrection/exactly-once behavior;
  deletion does not subtract or reconstruct precomputed lifetime totals.
- Maintenance verification on Node 24.21.0 and OpenCode 1.18.35:
  - `npx tsx --test test/history*.test.ts`: 108 passed.
  - Final focused rerun after the last code adjustment:
    `npx tsx --test test/history-maintenance.test.ts test/history-store.test.ts test/history-browser.test.ts test/history-coordinator.test.ts test/history-storage.test.ts`:
    82 passed, including 11 new maintenance tests.
  - `npm run typecheck` and `npm run build`: passed.
  - `node scripts/smoke-history-maintenance.mjs`: passed against the actual npm
    archive's bundle after rebuild. Plugin TUI stopped during public root/child
    deletion; API host then stopped before TUI resume. An injected 403 preserved
    details for two failed probes; recovery removed deleted details, retained the
    other scope, rendered `2/2` survivors, and preserved all aggregate values.
    Zero model calls and zero permission replies. Artifacts:
    `.runtime/history-maintenance/{before,transient,after}.txt` and `results.json`.
  - `node scripts/smoke-history.mjs browse`: passed, two unchanged model calls.
  - Earlier fixture development runs exposed npm 12's object-shaped pack JSON and
    the empty resumed session ignoring an initial prompt; the fixture was corrected.
    One development run timed out before bounded fixture fetches were added.
- Limits: dirty recovery conservatively gates the entire local invocation scope,
  not only the selected root. An unavailable/never-settling host can defer cleanup
  indefinitely without spawning replacement work. Maintenance is logical deletion,
  not forensic erasure. This subtask does not claim the full runtime matrix,
  package reproducibility review, or Node-floor matrix. Older fixtures with synthetic
  nonexistent sessions may now trigger legitimate cleanup and need real host seeds.
- [x] Deterministic worker source is embedded by `scripts/build.mjs`.
- [x] The existing decoder-specific literal exclusion still passes alongside a
  positive embedded-storage-worker assertion in `scripts/check-package.mjs`.
- [x] Third-party notices and host/SDK/OpenTUI pins are preserved.
- [x] README documents history scope, retention/deletion, outcome attribution and
  background approval, with one installation configuration example. Package
  description includes report history.
- [x] `AGENTS.md` documents persistence, fresh analytics, timing, history interactions,
  cleanup bounds, maintenance and exact fixture commands.
- [x] New pure tests use the existing TypeScript test inventory; real-host `.mjs`
  fixtures remain separate from helpers and publication policy.

## 13. Verification plan

### 13.1 Unit and storage integration tests

Add focused test files following existing conventions. Required assertions:

| Area | Cases |
| --- | --- |
| Capture | Accepted final only; previews/errors/stale results excluded; no unresolved text persisted |
| Re-review | Latest completed wins; interrupted replacement keeps previous candidate; both accepted ratings counted |
| Outcomes | Auto, footer-manual, native once/always, reject, every actual auto-cancel source, confirmed stop without auto-cancel |
| Ambiguity | Lost acknowledgement, event-before-ack, conflicting stale facts, unexplained disappearance omitted; no write retry |
| Concurrency | Same root shared, different roots isolated, two actual POSTs counted, latest Unsafe plus earlier automatic approval displayed as agreed |
| Ordering | Completion rather than resolution order, stable ties, late insertions and selected identity |
| Interaction | Ends, repeat command, Escape, arrow capture, autocomplete priority, scroll resets and preservation |
| Rendering | Exact copy, metadata fallback/wrapping, history excludes lifetime, live display unchanged, disabled status |
| Invalid data | Individual payload placeholder versus unreadable index/database; no guessed owner/rating/status |
| Transactions | Crash/throw before commit, committed-but-unacknowledged replay, sequence gaps, duplicate events, concurrent schema creation |
| Metrics | Current token/cost parsers, missing usage, retry timing, final-only ratings, weighted means, received-only denominators |
| Fresh start | Legacy files untouched/excluded, empty new totals once, resumed new totals preserved |
| Outage | Readable committed history on write failure, no unsaved display/toast, two-second retry, bounded queue/in-flight ownership |
| Overflow | No old-event eviction, no unbounded side buffer, no new recovered-analytics warning, no fabricated lost totals |
| Deletion | Root/child details removed, totals retained, late writes suppressed, offline definitive absence, transient failures never delete |
| Lifetime | Close/dispose invalidates async UI work, real finalizers drain within host bound, no retry timer after disposal |

Use deterministic barriers/clocks rather than timing sleeps for races. Test actual
SQLite transactions with isolated temporary state in addition to pure fake-store
tests. Run equivalent adapter semantics on supported Node floors and the pinned
host runtime where their implementations differ.

### 13.2 Real-TUI fixtures to add

Proposed fixture: `scripts/smoke-history.mjs`, using the existing private tmux
supervisor, isolated HOME/XDG/project/state and local HTTP model fixtures.
Suggested scenario names are implementation tasks, not commands already present:

| Scenario | What it establishes |
| --- | --- |
| `browse` | Slash/palette, newest, mouse/arrows, Escape, repeat command, index and exact footer |
| `scroll` | Long report paging/wheel, selection reset, no reset on background arrivals |
| `outcomes` | All statuses, native once/always, footer approval, cancellation/rejection precedence |
| `background` | Existing countdown survives history; newly completed Safe report starts behind it; final-render-only eligibility |
| `visibility` | Dialog/fullscreen/sidebar/narrow/route changes retain their non-history behavior |
| `empty-error` | Empty-to-first, loading, whole read failure, individual unreadable placeholder, recovery |
| `resume` | Committed history survives restart; unresolved text was not persisted |
| `shared` | Two host instances share root history and global totals without mixing different roots |
| `delete` | Selected child removal fallback, root closure, totals unchanged |
| `storage` | Failed/stalled worker stays off the approval path; bounded shutdown inside host budget |
| `notifications` | Normal background approval notification/audio policy; history replay creates none |

Each fixture should check the rendered text and model/approval request counts,
not merely internal state. Limit real-host concurrency to two. Report exact runs.

### 13.3 Existing checks and regressions

After implementation, from repository root:

```sh
npm run check
npm run check:package
npm run test:runtime-cleanup
```

Run the new fixture scenarios after a current build. Also run these focused existing
fixtures, adding more only for changed paths or failures:

```sh
node scripts/smoke.mjs auto-shell --notifications
node scripts/smoke.mjs auto-cancel
node scripts/smoke.mjs auto-hide
node scripts/smoke.mjs auto-dialog
node scripts/smoke.mjs auto-fullscreen
node scripts/smoke.mjs auto-narrow
node scripts/smoke.mjs auto-scroll
node scripts/smoke.mjs auto-zero
node scripts/smoke.mjs auto-immediate
node scripts/smoke-session-mode.mjs
node scripts/smoke-streaming.mjs complete
node scripts/smoke-streaming.mjs truncated --static
node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats
node scripts/smoke-permissions.mjs external-edit --auto --stream --stats
```

`npm run check:package` rebuilds and inspects actual archive contents; a TypeScript
pass alone does not verify worker bundling or host module resolution. Maintain
read-only CI coverage of the supported Node development floors.

The initial planning-only change received document/reference review. Implementation
verification and final audit results are recorded in section 15.

## 14. Completion checklist

- [x] Phase 0 proofs pass inside OpenCode 1.18.35 and the packaged artifact.
- [x] Every approved string, interaction and visibility rule is implemented.
- [x] History contains only committed, resolved, eligible reports with stable scope.
- [x] Latest completed report and permission outcome are correctly independent.
- [x] Live display and notification semantics pass regression checks.
- [x] Only the history layer receives the new approval-occlusion exception.
- [x] No pending body persistence or inferred/retried approval occurs.
- [x] Transactional event replay cannot duplicate aggregate contributions.
- [x] Analytics opens from precomputed totals, starts fresh, and preserves current metric meaning.
- [x] Retention, root/child deletion, offline cleanup and anti-resurrection work.
- [x] Worker/queue/read work is bounded and does not stall the TUI/approval path.
- [x] Disposal finishes within the real host cleanup budget under storage failure.
- [x] Package remains reproducible with exactly five files.
- [x] README and maintainer rules match implemented behavior.
- [x] Exact checks/captures are reported; no inferred full-matrix claims.

## 15. References and verified implementation facts

### Execution evidence

Phase 0 (2026-10-09):

- `node scripts/smoke-history-phase0.mjs` passed against the packed five-file
  archive: embedded worker SQLite commit/rollback/reopen, empty worker environment,
  stalled-worker termination and native autocomplete/dialog key priority.
- `node scripts/smoke-history-render.mjs covered`, `countdown`, `dialog`, and
  `fullscreen` passed: actual final Markdown highlighting beneath an opaque app-slot
  cover, unchanged running countdown, native coverage gates, one reviewer POST,
  one `once` reply and one isolated harmless execution per scenario.
- `node scripts/smoke-streaming.mjs complete` and
  `node scripts/smoke.mjs auto-fullscreen` passed.
- Controller/diagnostics tests: 71 passed. Typecheck, reproducible package check
  (exactly five files), and whitespace validation passed.
- Captures and observations: `.runtime/history-phase0/` and
  `.runtime/history-render-{covered,countdown,dialog,fullscreen}/`.
- Public `app` slot layering is required: direct renderer-root covers can incorrectly
  cover native fullscreen. Production integration must retain app-slot ordering.
- Pinned-source audit additionally confirmed native `always`/`reject` events can
  cascade to other requests in the same session. Outcome events do not imply a
  separate user gesture on each request. The host cleanup deadline starts after
  synchronous abort listeners return; four seconds from abort remains conservative.

### Source references

Phase 1 verification (2026-10-09): 31 storage/queue/refresh tests passed after
independent audit fixes for watchdog ownership, immutable query snapshots,
polling starvation, symlink ancestors, deletion/approval identity and plain-data
validation. The earlier combined storage/lifetime/usage run passed 52 tests.
Typecheck, build and packed production adapter smoke passed; the package check
proved reproducibility and exactly five files. Runtime artifacts are under
`.runtime/history-storage/`. No controller or legacy-accounting integration is
claimed by this storage-only phase.

Phase 2 verification (2026-10-09, working tree after `f8ee971`):

- `npm run check` passed: typecheck, 743 TypeScript tests, 74 pure helper tests,
  and build. After final resolution-query validation and three more storage tests,
  typecheck and the focused history/diagnostics suite passed all 91 tests.
- `npm run check:package` passed on the final source: reproducible bundle and
  exactly five archive files. `npm run test:runtime-cleanup` passed all six checks.
- `node scripts/smoke-history-storage.mjs` passed on the final packed bundle in
  OpenCode 1.18.35, including two-client Bun SQLite and bounded disposal.
- `node scripts/smoke.mjs auto-shell --notifications` and
  `node scripts/smoke-streaming.mjs complete` passed. The new
  `scripts/smoke-history-lifecycle.mjs` passed `auto-shell`, `auto-immediate`,
  `auto-manual`, and `auto-cancel`, inspecting committed production accounting and
  outcomes after the existing real-host approval fixtures. `auto-shell` was also
  rerun on the final bundle. Captures/accounting assertions are in
  `.runtime/history-lifecycle/`, `.runtime/history-storage/` and the existing
  per-scenario capture files. These are integration proofs, not live-model tests.
- Phase 3 persistence/presentation replacement and history UI were not implemented.

Phase 3 verification (2026-10-09, uncommitted working tree after `bfdf74f`):

- `npm run check` passed: typecheck, 715 TypeScript tests, 74 pure helper tests,
  and build. Obsolete snapshot/migration and duplicate refresh tests were replaced
  with pure metric tests, real-worker fresh/resumed/shared accounting tests and
  tracker tests against the common `HistoryRefresh` ownership/health contract.
- `npm run check:package` passed: reproducible bundle SHA-256
  `9e4831acc65e2ea81ac5903e0f50fb3d84c44346e9d928c0376bf7c620ecd850`,
  exactly five archive files, 653,278 bytes unpacked.
- These exact real-host runs passed, with at most two concurrent hosts:

  ```sh
  node scripts/smoke.mjs correction --seed-lifetime
  node scripts/smoke.mjs edit
  node scripts/smoke.mjs auto-shell --notifications
  node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats
  node scripts/smoke-permissions.mjs mcp --auto --stats --no-usage
  node scripts/smoke-permissions.mjs mcp --auto --correction --stats --missing-usage
  node scripts/smoke-permissions.mjs mcp --auto --stats --unpriced
  node scripts/smoke-permissions.mjs mcp --auto --stats --storage-error
  node scripts/smoke-permissions.mjs external-edit --auto --stream --stats
  node scripts/smoke-streaming.mjs complete --stats
  node scripts/smoke-streaming.mjs truncated --static --stats
  ```

- `edit` verifies rendered lifetime metrics before and after an actual host restart,
  including unchanged timing means and no additional reviewer POST. Stats fixtures
  inspect current SQL totals as well as rendered labels, check received-only counts,
  and exclude the 999-request/rating/cost legacy seeds in all four old directories.
- Captures and measurements are in the existing `.runtime/` per-scenario files,
  including `edit-lifetime-{dialog,restarted}.txt`, `permission-*-lifetime-dialog.txt`,
  and `streaming-*-lifetime-dialog.txt`. This establishes local fixture integration,
  not live-provider behavior or a full runtime matrix.
- Initial checks exposed and fixed fixture-only issues: a static SQL helper import
  broke dependency-free sparse `--plan` execution, and correction scrolling stopped
  at the lifetime cost before its final rating row. Dynamic imports after planning
  and scrolling through the rating row fixed both; affected checks/runs passed.
  The new test setup also corrected private directory mode and UUID fixture identity.
  No unresolved verification failure remains from the Phase 3 runs above.
- Phase 4 UI/commands and later history-only approval-cover behavior are not implemented.

Phase 4 verification (2026-10-09, uncommitted working tree after `44583b0`):

- Confirmed the clean starting HEAD was Phase 3 commit
  `44583b05b0e62e9cc1784c25480e60a8b57790a0`. No commit was created for Phase 4.
- `npm run check` passed: typecheck, 729 TypeScript tests, 74 pure helper tests,
  and build. The existing Phase 2 controller lifecycle tests are retained; new
  browser tests live separately in `test/history-browser.test.ts`.
- After the final selected-session/deletion invalidation refinement, typecheck and
  `npx tsx --test test/history-browser.test.ts test/history-storage.test.ts` passed
  all 37 tests. This includes actual missing/cyclic/over-depth ancestry, no mode
  load, two-second ancestry recovery, late-root/read races, local precommit deletion
  suppression, metadata sanitization, exact strings and footer overflow boundaries.
- Final `npm run check:package` passed: reproducible bundle SHA-256
  `db57bfc1f07f8a02277bf9f2e4354034eff947ae771d6a502b1c3cc5a26c0d75`,
  exactly five files, 675,148 bytes unpacked. `npm run test:runtime-cleanup` passed
  all six isolated supervisor checks.
- All implemented new real-host scenarios passed. Final verification uses at most
  two hosts concurrently; the final two-host `shared` run was performed alone:

  ```sh
  node scripts/smoke-history.mjs browse
  node scripts/smoke-history.mjs scroll
  node scripts/smoke-history.mjs empty-error
  node scripts/smoke-history.mjs resume
  node scripts/smoke-history.mjs shared
  node scripts/smoke-history.mjs delete
  node scripts/smoke-history.mjs visibility
  node scripts/smoke-history.mjs disabled-invalid
  ```

  `browse` verifies all four outcomes, both command surfaces, mouse arrows/Close,
  end-key consumption while normal typing works, Escape and native autocomplete/
  dialog priority. `scroll` verifies paging/wheel, insertion identity, repeat and
  selection resets, payload replacement, and exact saved offset after dialog,
  narrow and hidden-sidebar remounts. `empty-error` verifies rendered empty-to-first,
  corrupt individual payload versus index failure, and repairs without changing the
  revision. `resume` restarts the actual host. `shared` uses two host instances and
  checks a newly created independent root is empty. `delete` proves next-newer
  rather than newest, nearest-older fallback, real public root deletion/closure and
  unchanged totals. `disabled-invalid` combines disabled mode and invalid reviewer
  config; a native child route silently arms history without forcing a sidebar,
  and returning to the parent closes it before reopening committed root history.
  Every scenario checks rendered results and unchanged model-request counts (two
  host startup/title calls), with zero observed permission requests/replies.
  `empty-error` and `delete` were rerun after the final deletion refinement.
- These focused existing real-host regression runs passed:

  ```sh
  node scripts/smoke.mjs auto-shell --notifications
  node scripts/smoke.mjs auto-hide
  node scripts/smoke.mjs auto-scroll
  node scripts/smoke.mjs auto-fullscreen
  node scripts/smoke.mjs auto-dialog
  node scripts/smoke-streaming.mjs complete
  ```

- Captures and results are under `.runtime/history-{browse,scroll,empty-error,
  resume,shared,delete,visibility,disabled-invalid}/`; existing regression captures
  retain their usual `.runtime/` names. These are local deterministic integration
  checks, not live-model judgment or a full runtime matrix.
- Verification caught and fixed premature scroll restoration between Markdown
  readiness and scrollbar measurement. Fixture checks now wait for the rendered
  saved viewport. Fixture-only corrections included exact native sidebar controls,
  legal public command IDs and the host's sidebar-free child route behavior.
- The live component remains a separate mounted sibling below history. Its current
  hit-test/visibility gates are unchanged; the Phase 5 history-only approval-cover
  exception and Phase 6 offline maintenance remain unimplemented.

Phase 5 verification (2026-10-09, uncommitted working tree after `384e6e6`):

- Started from a clean Phase 4 checkout. Implemented only Phase 5; no commits or
  Phase 6 maintenance changes were made.
- Final `npm run check` passed: typecheck, 733 TypeScript tests, 74 pure helper
  tests, and build. Final focused invocation passed all 221 tests:

  ```sh
  npx tsx --test test/history-cover.test.ts test/history-browser.test.ts test/approval.test.ts test/controller.test.ts test/streaming-controller.test.ts test/notification-policy.test.ts test/diagnostics.test.ts
  ```

  New controller/clock tests exercise navigation and close between painted frames,
  retaining the original countdown deadline, and reject a foreign hit pair without
  reviving a cancelled countdown. Existing uncertain-write/mode tests remain intact.
- Final `npm run check:package` passed: reproducible bundle SHA-256
  `4779dec755fc4a4ed56862b2e9fa8c6e6c40b41f1f5c5a54d655491634451cda`,
  exactly five archive files, 678,316 bytes unpacked. The complete final check and
  package stdout was captured by the harness at
  `/home/user/.local/share/opencode/tool-output/tool_1217a068d001IjiZ4XjIP2pBXC`.
  `npm run test:runtime-cleanup` passed all six checks; `git diff --check` passed.
- These exact production-history commands passed on the final bundle, with at most
  two real hosts running concurrently:

  ```sh
  node scripts/smoke-history-auto.mjs covered
  node scripts/smoke-history-auto.mjs countdown
  node scripts/smoke-history-auto.mjs navigation
  node scripts/smoke-history-auto.mjs error
  node scripts/smoke-history-auto.mjs zero
  node scripts/smoke-history-auto.mjs dialog
  node scripts/smoke-history-auto.mjs fullscreen
  node scripts/smoke-history-auto.mjs hide
  node scripts/smoke-history-auto.mjs narrow
  node scripts/smoke-history-auto.mjs manual
  node scripts/smoke-history-auto.mjs mode
  ```

  The fixture shares Phase 0 transport/render assertions but mounts only production
  HistoryView. `covered` starts from empty history; `countdown` observes an actual
  footerless loading frame and navigation while preserving panel/Markdown identity
  and nonincreasing seconds through open/close. `error` uses a corrupted isolated
  SQL index, then repairs it. `navigation` retains `Saved history 1` as its index
  changes from `1/2` to `1/3` after background commit, then navigates to the new report.
  `zero` retains final-only approval without the positive-delay hold. Negative runs
  exercise actual native UI and wait beyond the original deadline with zero replies
  and executions. `mode` re-enables, receives a second final Safe review, and retains
  the manual tombstone. Positive runs each assert exactly one native `once` reply
  and harmless execution, final validation/highlighting/paint before readiness,
  truthful physical diagnostics, approval audio and root-completion notification.
  Literal `/reviewer-history`, arrow and Close/Escape replay creates no new model
  request, reply, notification birth or sound.
- Exact artifacts: `.runtime/history-auto-<scenario>/results.json` contains render
  identities/readiness, diagnostics, native replies and notification observations;
  `metrics.json` records `passed` and HTTP counts; named `.txt`/`.ansi` captures
  include `complete-json-held-terminal`, `countdown-started`, `ongoing-navigation`,
  `committed-no-jump`, `cancelled-after-native-gate`, `manual-tombstone`, and `resolved`
  where applicable. Earlier development failure captures can coexist; final
  `results.json` and `metrics.json` record the successful run.
- All section 13.3 real-host regressions were also executed and passed during this
  phase, plus the two existing history regressions below:

  ```sh
  node scripts/smoke.mjs auto-shell --notifications
  node scripts/smoke.mjs auto-cancel
  node scripts/smoke.mjs auto-hide
  node scripts/smoke.mjs auto-dialog
  node scripts/smoke.mjs auto-fullscreen
  node scripts/smoke.mjs auto-narrow
  node scripts/smoke.mjs auto-scroll
  node scripts/smoke.mjs auto-zero
  node scripts/smoke.mjs auto-immediate
  node scripts/smoke-session-mode.mjs
  node scripts/smoke-streaming.mjs complete
  node scripts/smoke-streaming.mjs truncated --static
  node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats
  node scripts/smoke-permissions.mjs external-edit --auto --stream --stats
  node scripts/smoke-history.mjs browse
  node scripts/smoke-history.mjs visibility
  ```

  Their usual `.runtime/auto-*-metrics.json`, `permission-*-metrics.json`, streaming,
  session-mode and history capture files retain evidence. These are isolated local
  fixture checks, not live-provider judgment, desktop-focus proof or a full matrix.
- Verification found and fixed the changing-fragment remount and missing ScrollBox
  viewport ownership. Review also moved hit-proof expiry to the start of the next
  live frame, retaining the newly proven pair for between-frame timer checks.
  Fixture refinements await root-completion notification before replay comparisons,
  avoid a redundant async history reset racing navigation after SQL repair, and
  assert the actual existing notification grace policy: slow highlighting may
  generate attention after one second before countdown, never during countdown.
  Cancellation can then create its normal renewed manual-wait episode. No product
  policy change or unresolved verification failure remains.

Phase 6 final audit and verification (2026-10-09):

- Fixed two integration defects with regressions: temporary loading/error/dirty
  states could overwrite saved scroll, and valid assessment text containing decoded
  NUL was incorrectly rejected by history's identifier validator. Stored report text
  now preserves the valid bounded assessment verbatim and display still escapes it.
- `npm run check` passed on Node 24.21.0: 746 TypeScript tests, 74 helpers,
  typecheck and build. `npm run test:runtime-cleanup`: six passed.
- Actual Node 22.22.2 ran `node --import tsx --test test/*.test.ts`: 746 passed.
  Actual Node 24.15.0 ran
  `node --import tsx --test test/history*.test.ts test/lifetime*.test.ts`: 119 passed.
  Binaries were installed as `node-linux-x64` under `/tmp/opencode/node22-floor`
  and `/tmp/opencode/node24-floor` and invoked by absolute path. Initial `npx`
  attempts unexpectedly used Node 24.21.0 and are not counted as floor checks.
- `npm run check:package` passed: SHA-256
  `22cac6204191a6dac6bcff8cab183517dac69ad0f04f1aebf12bb8eab668dd6d`,
  exactly five files, 687,079 bytes unpacked.
- Final audit reran history `scroll` and `empty-error` successfully. After the final
  build/package check, these exact real-host commands also passed:

  ```sh
  node scripts/smoke-history-auto.mjs covered
  node scripts/smoke-history-auto.mjs countdown
  node scripts/smoke-history-auto.mjs dialog
  node scripts/smoke-history-maintenance.mjs
  node scripts/smoke-history-storage.mjs
  ```

  At most two hosts ran concurrently. These reruns cover the final integration
  changes; earlier full scenario runs remain recorded under their respective phases.
- No live provider was contacted by the runtime fixtures. No publication is claimed.

Local references below reflect the current implementation, including Phase 6:

- [Controller lifecycle and visibility](src/controller.ts): `presented`, `eligible`,
  accepted-review observer, `replied`, `reconcile`, `dispose`, `visibleReview`.
- [TUI wiring and report rendering](src/tui.tsx): full reply events reach history;
  public sidebar mount token; final Markdown and hit-test gating; bounded cleanup.
- [Lifetime metric helpers](src/lifetime.ts): pure invariants, weighted aggregation
  and exact display formatters; no filesystem persistence or legacy reads.
- [Lifetime view](src/lifetime-view.tsx) and
  [refresh coordinator](src/history-refresh.ts): totals queries, commit/failure
  subscriptions, open refresh, shared polling and actual transaction ownership.
- [Reviewer transport](src/reviewer.ts) and [usage parsing](src/usage.ts): per-POST
  finalization and report-wide component coverage.
- [Ancestry/mode gate](src/session-mode.ts): depth/time/cache bounds and scope key.
- [Local commands](src/session-mode-commands.ts): public command registration.
- [Exact UI catalog](src/ui-text.ts), [build](scripts/build.mjs),
  [package checks](scripts/check-package.mjs), [package metadata](package.json),
  and [maintainer guide](AGENTS.md).

Pinned upstream source at OpenCode commit
`53d1eabb61e21162157817bf677da0a4ad3332e3` (tag `v1.18.35`), inspected read-only:

- [Plugin runtime](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/plugin/tui/runtime.ts):
  `DISPOSE_TIMEOUT_MS = 5000`; `createPluginScope.dispose` aborts first, processes
  reverse-ordered callbacks against one shared deadline, and stops waiting on timeout.
- [Keymap slash enumeration](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/tui/src/keymap.tsx):
  `useCommandSlashes` reads visible commands in namespace `palette`.
- [Command palette](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/tui/src/component/command-palette.tsx):
  shares the namespace and hidden-command filter with slash enumeration.
- [Permission service](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/permission/index.ts):
  reply events contain session/request/reply kind, not submitting client identity;
  removal can also occur without a reply through deferred cleanup.

Upstream source inspection establishes host behavior; it is not permission to
import private host modules or patch host controls. Worker compatibility is backed
by the packed Phase 0 and production-storage runtime evidence recorded above.
