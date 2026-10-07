# Implementation plan: streaming reviews and session controls

## Scope and decisions

Implement against OpenCode 1.18.35, local Linux TUI, using public APIs. Model
selection remains configurable. OpenRouter and DeepSeek Flash are optimization
examples, not requirements. No paid model calls, release commits, tags, pushes,
publication, or installation are required for this task.

- Add `stream: false` by default. The switch controls both transport and display.
- Keep Chat Completions HTTP. Streaming uses SSE; measure connection reuse rather
  than adding an unsupported WebSocket or speculative client pool.
- Display a parsed rating early, then incremental Markdown explanation. Keep
  provisional data separate from the validated assessment and approval eligibility.
- Loading is the existing scanner plus `Evaluating`. A format retry clears the
  provisional report and shows the scanner plus `Retrying`.
- Existing native approval controls and auto-approval cancellation semantics stay.
  Only a completed, validated, rendered Safe assessment can start its full countdown.
- Add `/reviewer-enable` and `/reviewer-disable` and matching palette actions.
  Scope is the current root conversation and all descendants. Persist on resume.
  Other conversations and configured review-kind switches remain independent.
- Disabling aborts analysis/countdowns, hides reports, and leaves native requests
  pending. Enabling freshly reviews pending requests, preserving manual-only
  cancellation history for interrupted countdowns.
- Count every valid received cost once, including invalid assessments and
  interrupted attempts. Preserve old history. No billing follow-up calls or
  retry-specific user-facing accounting. Missing cost remains unknown.
- Efficiency changes must preserve evidence and judgment semantics. No assessment
  reuse, lossy summarization, speculative model calls, or automatic POST retries.

## Architecture

### Transport, parsing, and progress

Retain non-streaming compatibility. Add bounded SSE framing and a bounded
incremental JSON assessment parser. Decode UTF-8 incrementally, handle comments,
CRLF, multiline data, terminal markers, usage-only frames and repeated terminal
finish metadata. Reject malformed API events, error chunks, refusals, tool calls,
unsuccessful finish reasons and incomplete transport. Do not finalize at the first
closing brace or first finish frame: consume usage and the terminal protocol.

Track JSON lexical state, expose only complete boolean values and decoded string
prefixes, and hold unfinished escapes/surrogates. Reject duplicate fields in both
streamed and non-streamed assessments. Final contract remains exactly `safe` and
nonempty `desc`. Request `safe` first without making field order mandatory.

Use separate assessment, SSE event, wire-byte and event-count limits. All attempts
share the existing deadline. Keepalives never extend it. Release readers on every
exit and do not reconnect or retry ambiguous transport failures.

Progress events carry attempt identity and evaluating/streaming/retrying phases.
Controller guards events by entry identity, generation, mode and abort state.
Coalesce Markdown updates near the existing 40 ms animation cadence, flush final
text immediately, sanitize every displayed prefix, retain scrolling, and reset
failed-attempt content on retry. Final rendering/highlighting gates the countdown.

### Session mode

Use a versioned atomic plugin-owned store under the public state directory, keyed
by root-session identity within the host scope. Serialize updates; acknowledge
persistence failures honestly. Resolve ancestry with bounded public metadata reads.
Load saved mode before enrichment/model work. Unknown ancestry must not accidentally
bypass a disabled root. Runtime changes apply immediately in this instance and
persist for resume; live cross-instance synchronization is outside initial scope.
Commands are local actions, not assistant prompts. No session means no applicable
action. Retain minimal pending identity/order while disabled and recover via fresh
revision-guarded snapshots on enable. Preserve cancellation tombstones until native
resolution. Persist no partial model text or evidence.

### Accounting

Normalize usage independently of assessment success. For the exact OpenRouter
endpoint, prefer finite nonnegative `usage.cost` even without token counts; never
also add upstream inference cost or a catalog estimate. Generic endpoints retain
catalog estimation. Observe each attempt once, including a usage frame received
before later failure/cancellation. Repeated cumulative frames must not double count.
Token and cost availability are independent. Read legacy snapshots without
reinterpreting their numbers; version new storage if needed. Preserve atomic
per-instance snapshots and disposal flush. UI exposes aggregate history, not an
attempt ledger. Document missing charges and legacy estimate provenance.

### Efficiency and observability

Measure dispatch, headers, first content, first rating, final validation, host
context/verification timings and request counts using content-free fixture data.
Verify warm HTTP reuse in the real runtime. Stable system prefixes and compact
evidence already exist; retain these and remove only demonstrated redundancy.
Measure cache usage when reported. Avoid extra network requests to fetch pricing,
warm caches, reconcile billing, or benchmark paid providers without authorization.

## Files to read before implementation

Read these existing files in full (and additional touched files before editing):

- `AGENTS.md`, `README.md`, `RELEASE_NOTES.md`
- `package.json`, `package-lock.json`, `tsconfig.json`
- `src/config.ts`, `src/types.ts`, `src/reviewer.ts`, `src/controller.ts`
- `src/tui.tsx`, `src/appearance.ts`, `src/approval.ts`, `src/deadline.ts`
- `src/evaluate.ts`, `src/context.ts`, `src/usage.ts`
- `src/lifetime.ts`, `src/lifetime-view.tsx`, `src/prompts.ts`, `src/prompt-files.json`
- `contracts/PERMISSION-REVIEW-CONTRACT.md`, `contracts/PERMISSION-REVIEW-CORRECTION.md`
- Every Markdown file inventoried in `src/prompt-files.json`
- `scripts/build.mjs`, `scripts/check-package.mjs`, `scripts/smoke.mjs`
- `scripts/smoke-permissions.mjs`, `scripts/smoke-runtime.mjs`
- `test/reviewer.test.ts`, `test/controller.test.ts`, `test/approval.test.ts`
- `test/prompts.test.ts`, `test/usage.test.ts`, `test/lifetime.test.ts`
- `.github/workflows/release.yml`

Proposed new modules are `src/sse.ts`, `src/streaming-assessment.ts` and session-mode
store/resolution helpers. Split transport only if it clarifies shared behavior.
Add focused tests and runtime fixtures alongside existing suites.

## Milestones and acceptance gates

### 1. Compatibility and baseline

- [x] Read source inventory and inspect worktree before further changes.
- [x] Pin plugin SDK/engine to OpenCode 1.18.35 and inspect relevant public APIs.
- [x] Establish unit/typecheck/build baseline and a representative real-TUI run.
- [x] Add content-free request/timing measurements and establish fixture baseline.

Success: existing tests pass; real host loads bundle; measured request count and
timings distinguish model output waiting from evidence and transport work.

### 2. Accounting foundation

- [x] Normalize OpenRouter reported cost independently from token availability.
- [x] Preserve generic pricing and legacy history; version storage as required.
- [x] Add attempt observation/deduplication and preserve received usage on failure.
- [x] Verify zero, cost-only, invalid, interrupted, repeated and correction cases.

Success: each received billable observation contributes once, old totals survive,
missing reports create no invented cost, and accounting cannot change review results.

### 3. Session controls

- [x] Implement bounded ancestry resolution and persistent root-conversation mode.
- [x] Register slash and palette actions through public keymap APIs.
- [x] Gate initial/recovered work, abort disabled work, and reconcile on enable.
- [x] Preserve countdown cancellation history and guard stale async callbacks.
- [x] Verify independent conversations, descendants, restart/resume, and failures.

Success: commands do not call models or write conversation messages; disabled trees
produce no enrichment/model calls; resume honors mode; enable reviews pending IDs
once and never revives canceled automation.

### 4. Streaming transport

- [x] Add the strict `stream` setting with false default.
- [x] Implement bounded SSE and assessment preview parsing.
- [x] Integrate stream/non-stream transport, progress, accounting and corrections.
- [x] Make final validation consistent and consume terminal usage frames.
- [x] Verify chunk boundaries, malformed input, cancellation and resource cleanup.

Success: progressive fields are correct across arbitrary chunks; incomplete or
failed streams never produce a completed assessment; deadlines and memory stay
bounded; transport errors never create automatic duplicate POSTs.

### 5. Streaming UI

- [x] Wire generation-guarded progress into controller and TUI state.
- [x] Show early rating and coalesced sanitized streaming Markdown.
- [x] Add exact Evaluating/Retrying labels and clean failed-attempt reset.
- [x] Preserve controls, scrolling, visibility and final-render countdown gate.
- [x] Verify delayed streams and interruptions in real TUI fixtures.

Success: first rating precedes final output; native controls stay responsive;
no approval is possible from a preview; retries clear old text; scrolling and
animation-disabled behavior pass.

### 6. Efficiency tuning

- [x] Compare measured cold/warm requests and demonstrate real-runtime reuse.
- [x] Audit static prefixes and exact duplication; implement justified lossless wins.
- [x] Surface cache observations only in measurement/accounting paths as appropriate.
- [x] Record measured outcomes and limitations without claiming live model results.

Success: fixture request counts remain one per attempt, no speculative traffic,
and optimizations have reproducible evidence or are explicitly deferred for lack
of benefit. Model/provider choices remain configurable.

### 7. Release preparation

- [x] Update README, maintainer guide and release notes for behavior/migration.
- [x] Run `npm run check`, cleanup checks and focused runtime coverage.
- [x] Run `npm run check:package` and whitespace/diff review.
- [x] Record exact verification results and remaining limitations here.

Success: reproducible five-file package, compatible history and settings,
opt-in streaming default, no unrequested release operations.

## Test matrix

- SSE: UTF-8 splits, CRLF, comments, multiline events, accounting frames, repeated
  terminal metadata, missing DONE, transport disconnect/error, bounded buffers.
- JSON: boolean token boundaries, arbitrary order, escapes and surrogate splits,
  duplicates, additional keys, malformed prefixes, empty description, trailing text.
- Lifecycle: abort during read/retry, disable/countdown/verification races, stale
  progress after resolution, restored disabled root and inherited child mode.
- Accounting: cost-only/zero, bad counts, duplicate usage, correction chain,
  cancellation after usage, legacy snapshots, failed persistence, disposal flush.
- UI: early rating, progressive Markdown, retry clear, non-stream spinner, native
  manual approval/rejection, final-frame countdown, scroll/dialog/hidden/narrow,
  fullscreen overlay and animations disabled.

## Execution record

### Phase 1 verified

- SDK and engine pinned to 1.18.35; installed host is 1.18.35.
- Full source inventory read by lead and delegated agents.
- `npm run check`: typecheck, 348 tests, and build passed.
- `npm run test:runtime-cleanup`: 4 tests passed.
- Real TUI `external` and `mcp --auto --correction` passed.
- `.runtime/external-metrics.json`: 2 distinct reviewer requests on the same TCP
  socket, alongside 2 main-fixture requests. Server response times 0.648/0.491 ms;
  response-to-observed-panel 243.673/123.861 ms (100 ms polling resolution).
- MCP correction reused its socket; response-to-correction interval 2.692 ms.
- These are local fixture-server/UI observations, not client phase timings or
  paid-model latency measurements. No cold/warm comparison is claimed yet.
- Use the available patch tool for plan edits; this harness has no separate Edit.

### Phase 2 verified

- `npm run check`: typecheck, 361 tests and build passed; focused accounting tests
  102 passed. Attempt accumulator finalizes once even on failure.
- Real MCP auto/correction, MCP missing-usage/stats and custom unpriced/stats passed.
- Legacy v1 seed retained; MCP total $0.0101 with 2/2 priced, custom total $0.0100
  with 1/2 priced. Both retain 1970-01-01 seed date and exact token coverage.
- New per-instance snapshots use usage-v2; usage-v1 read without modification.
- Controller disposal must await finalizers before lifetime flush in phase 3.

### Phase 3 verified

- `npm run check`: typecheck, 388 tests and build passed; cleanup 4/4 passed.
- Real `smoke-session-mode.mjs` verified palette/slash actions, HTTP abort,
  canceled-countdown history, restart/resume disabled mode and fresh enable review.
  Exactly four reviewer requests, captured in `.runtime/session-mode-results.json`.
- Real `auto-cancel` preserved native pending permission beyond the canceled deadline.
- Descendant inheritance, independent roots, read failures and command races are
  unit-tested; runtime session-mode fixture exercises root controls and resume.
- Controller disposal now drains review/accounting finalizers before usage flush.
- Cancellation tombstones remain controller-local; saved mode persists on resume.

### Phase 4 verified

- `npm run check`: typecheck, 452 tests and build passed.
- SSE parser and shared assessment lexer cover arbitrary byte splits, UTF-8,
  escaped duplicate keys, surrogate boundaries, usage/terminal frames, limits,
  cancellation and hanging reader cleanup. Local HTTP exact-64-KiB stream passed.
- Generic streaming requests ask for usage using standard stream_options; usage
  observation stays independent of preview and final validation.
- Real MCP auto/correction fixture passed with exactly two reviewer attempts.
- `ReviewProgress` provides attempt, phase and optional preview; TUI integration
  follows in phase 5. No preview can populate a completed assessment yet.

### Phase 5 verified

- `npm run check`: 465 tests passed before audit correction; 473 after correction.
- Ten real streaming scenarios passed: complete, retry --static, cancel, manual,
  disable, error, hidden, dialog, narrow, fullscreen. Existing auto-scroll and
  session-mode persistence/resume fixtures also passed, cleanup 4/4.
- Fixtures pause at rating-only, partial text, and complete JSON/finish without
  terminal completion; no auto-approval occurs. Full rendered completion starts
  the complete countdown. Progress uses 40 ms coalescing and guarded attempts.
- Five simultaneous real hosts caused highlighting timeouts under contention;
  reruns with at most two hosts passed. Limit verification concurrency to two.
- Streaming runtime coverage is native shell; edit/MCP stream combinations await
  final focused coverage. Unit transport/evidence handling is category-independent.

### Independent transport audit and correction

- Audit ran 100,000 mutated assessment cases against JSON/schema reference and
  identified one reproducible accounting bug: a newer unpriceable generic token
  snapshot retained an older estimate. Fixed in usageAttempt, including unchanged
  token counts with invalid cache metadata. OpenRouter reported cost stays independent.
- Complete SSE regressions verify both report and persisted lifetime accounting.
- Post-fix `npm run check`: typecheck, 473 tests and build passed; focused 164 passed.

### Phase 6 verified

- Reviewer-only origin measurement: first POST on fresh socket request 1, next POST
  on same socket request 2; two origins/two total connections. No warm-up requests.
  Fresh/warm server durations 2.610/0.808 ms, different category payloads, not a
  measured connection-setup speedup or a statistical/live-provider benchmark.
- Compact request/evidence JSON, byte-identical system prefixes and exact correction
  history verified. MCP correction adds 666 bytes; evidence stays 1,300 bytes.
- Real MCP auto/correction/stream/stats and external-edit auto/stream/stats passed.
  Repeated usage frames with synthetic cache read/write counts do not double-count.
- Measurement unit tests 5/5, cleanup 4/4. No pool, prompt padding, evidence reduction,
  provider pinning, speculative calls or model-specific configuration justified.
- Added opt-in withDiagnostics observer for content-free client phases, context,
  verification and rendering. Fixed labels/numeric correlations only; exceptions
  cannot affect review. Runtime artifacts capped at 512 events; no production logs.
- `npm run check`: typecheck, 483 tests and build passed. Diagnostic fixtures
  complete, retry --static and nonstream --observer-throws passed, zero dropped events.
- Complete fixture: headers 13.540 ms after dispatch, content 38.071 ms, rating
  38.730 ms, display 2.975 ms after rating, rendered final frame 22.229 ms after
  validation, approval verification 5.917 ms. Deliberate fixture waits are included;
  client/server clocks are separate. See `.runtime/streaming-*-client-diagnostics.json`.
- Independent mode/UI audit: 185 existing tests and five additional race probes
  passed; no actionable issue reproduced.

### Phase 7 final verification

- `npm run check`: typecheck, 483 unit tests and build passed.
- `node --test test/smoke-measurements.test.mjs`: 5/5 passed.
- `npm run test:runtime-cleanup`: 4/4 passed.
- `npm run check:package`: two identical builds, exactly five packaged files,
  211,784 bytes unpacked. Bundle SHA-256:
  `7f822e160c3602b88d9b840c665dfe3097026ec3c7e46e315b9bdb7e06e64854`.
- `git diff --check` passed. README, AGENTS and unreleased notes updated; prior
  v0.3.0 notes remain explicitly historical. No package version bump or release action.

Final assembly runtime matrix: all 21 runs passed on the first attempt, using
`OPENCODE_BIN=/home/user/.opencode/bin/opencode` (1.18.35), with at most two hosts.
All model responses came from local deterministic fixtures.

| Script | Exact arguments | Reviewer POSTs |
| --- | --- | ---: |
| smoke-streaming.mjs | complete | 1 |
| smoke-streaming.mjs | retry --static | 2 |
| smoke-streaming.mjs | nonstream --observer-throws | 1 |
| smoke-streaming.mjs | cancel | 1 |
| smoke-streaming.mjs | manual | 1 |
| smoke-streaming.mjs | disable | 2 |
| smoke-streaming.mjs | error | 1 |
| smoke-streaming.mjs | hidden | 1 |
| smoke-streaming.mjs | dialog | 1 |
| smoke-streaming.mjs | narrow | 1 |
| smoke-streaming.mjs | fullscreen | 1 |
| smoke-session-mode.mjs | (none) | 4 |
| smoke.mjs | auto-scroll | 1 |
| smoke.mjs | auto-zero | 1 |
| smoke.mjs | auto-unsafe | 1 |
| smoke.mjs | stalled-file | 1 |
| smoke-permissions.mjs | mcp --auto --correction --stream --stats | 2 |
| smoke-permissions.mjs | external-edit --auto --stream --stats | 2 |
| smoke-permissions.mjs | external-patch --auto --correction | 2 |
| smoke-permissions.mjs | mcp-resource --auto --resource-whitespace | 1 |
| smoke-permissions.mjs | custom-bash --disabled --native-bash-enabled --auto | 0 |

Artifacts are under `.runtime/`: scenario metrics, request fixtures, rendered text
and ANSI captures; streaming runs include client-diagnostics JSON. Session controls
have `session-mode-results.json`. Older contention failure artifacts are retained;
none were generated by the final 21 runs.

### Completion and limits

All seven milestones are verified. HTTP reuse and stable compact payloads already
worked, so added measurements rather than an unjustified pool or semantic prompt
change. Streaming improves fixture time-to-visible-rating; no live-model latency,
cache hit-rate, billing-completeness or judgment-quality claim is made. Exact model
selection stays configurable. Live cross-instance mode synchronization and persisted
countdown cancellation history remain outside the agreed scope. New session mode
itself persists on resume. Source is built; using an updated plugin requires restart.
