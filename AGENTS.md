# Maintainer guide

## Writing style

- NEVER use em dashes.

## Scope and integration

- Target OpenCode **1.18.35**, local Linux terminal TUI. Other clients, remote
  workspaces and OpenCode 2 are unverified.
- The plugin is advisory by default. Explicit `autoApprove: true` may reply
  `once` to an enabled, visible, completed, validated and rendered Safe review
  after its countdown or a footer click. Never send `always`/`reject`, change permission rules, directly
  execute commands or directly apply edits. Use public `@opencode-ai/plugin/tui`
  APIs and public TUI slots; do not patch the native approval dialog.
- Register the plugin and options in `tui.json`; permissions belong in
  `opencode.json`. Source changes require rebuilding; plugin/config changes require
  restarting OpenCode. Keep `README.md` focused on installation and user behavior.
- Package name and exported plugin ID are `opencode-reviewer`. OpenCode 1.18.35
  loads the default `{ id, tui }` module and package `exports["./tui"]`; package
  installs also check `engines.opencode`. No separate description manifest is
  required. Keep package description/repository/homepage/bugs metadata current.

## Development and verification

Requires Node.js 22+ and npm. Run commands from the repository root:

```sh
npm ci --ignore-scripts
npm run check          # typecheck -> node:test via tsx -> build
npm run test:runtime   # requires an up-to-date dist/tui.js; does NOT build
npm run test:runtime-cleanup # fast tmux interruption/isolation checks, no model or build
npm run check:package  # builds twice, compares hashes, checks exact package contents
```

- Focused tests: `npx tsx --test test/context.test.ts`; select by name with
  `npx tsx --test --test-name-pattern='missing invocation path' test/context.test.ts`.
  Streaming coverage lives in `test/sse.test.ts`, `test/streaming-assessment.test.ts`,
  `test/reviewer.test.ts` and `test/streaming-controller.test.ts`. Mode/command races,
  accounting and observer isolation are covered in `test/session-mode.test.ts`,
  `test/controller.test.ts`, `test/usage.test.ts`, `test/lifetime.test.ts` and
  `test/diagnostics.test.ts`. Run fixture-measurement tests separately with
  `node --test test/smoke-measurements.test.mjs`; `npm run check` selects `.test.ts`.
- Runtime/UI or host-integration changes warrant real-TUI fixtures after a build.
  Run one with `node scripts/smoke.mjs external`; other scenarios are `correction`,
  `cancel`, `error`, `edit`, `write`, `patch`, `edit-cancel`, and `edit-config-error`.
  `stalled-file` injects a stalled evidence open through the bundle's read-only
  `withFileAccess` adapter factory and verifies palette responsiveness plus a
  bounded omission in the real host. It does not patch host filesystem globals.
  Review-switch scenarios are `edit-disabled`, `bash-disabled`, and `external-disabled`.
  Auto-mode scenarios are `auto-shell`, `auto-edit`, `auto-external`, `auto-zero`,
  `auto-immediate`, `auto-manual`, `auto-unsafe`, `auto-error`, `auto-cancel`,
  `auto-hide`, `auto-dialog`, `auto-fullscreen`, `auto-narrow`,
  `auto-initially-hidden`, and `auto-scroll`.
  `scripts/smoke-permissions.mjs` covers `mcp`, `mcp-resource`, `custom`,
  `custom-bash`, `external-read`, `external-search`, `external-edit`, and `external-patch`.
  `external-patch` verifies a deletion summary before directory-only approval with
  native edit permission already allowed.
  Flags include `--auto`, `--disabled`, `--cancel`, `--unsafe`, `--error`,
  `--correction`, `--held`, `--no-usage`, `--missing-usage`, `--unpriced`,
  `--storage-error`, `--native-bash-enabled`, `--resource-whitespace`, `--stream`,
  and `--stats`. `npm run test:runtime-permissions` runs a
  focused matrix. Seeded lifetime assertions verify the real rendered UI.
  Requires Linux, Git, Python 3, tmux and `opencode` on PATH;
  `OPENCODE_BIN` selects another binary.
- New focused fixtures require an up-to-date bundle and run separately from the
  existing npm runtime matrices:
  - `node scripts/smoke-session-mode.mjs`: local slash/palette actions, in-flight
    abort, interrupted-countdown history, persisted disabled root and host resume.
    Descendant inheritance, independent roots and store failures have unit coverage.
  - `node scripts/smoke-streaming.mjs complete`: delayed rating/text/terminal phases,
    scrolling and final-render-only countdown. Other scenarios are `retry`,
    `nonstream`, `cancel`, `manual`, `disable`, `hidden`, `dialog`, `narrow`,
    `fullscreen` and `error`. `--static` checks animation-disabled labels;
    `--observer-throws` checks diagnostic isolation. Example combinations are
    `retry --static` and `nonstream --observer-throws`.
  - `node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats`
    and `node scripts/smoke-permissions.mjs external-edit --auto --stream --stats`
    cover streamed category integration, terminal usage and cumulative-frame accounting.
    Streamed usage fixtures include synthetic cache read/write counts automatically;
    there is no separate cache-usage switch.
  - `node scripts/smoke.mjs external --measure-reuse` checks a fresh reviewer-only
    origin followed by a warm request on the same TCP connection. Shared helpers in
    `scripts/smoke-reviewer.mjs` audit compact JSON, stable system prefixes, exact
    correction history and one POST per planned attempt.
  Limit real-host verification concurrency to two; higher contention has caused
  highlighting timeouts. Report exact runs, not inferred full-matrix coverage.
- Runtime fixtures isolate HOME/XDG/project directories under the OS temp directory,
  use local HTTP model fixtures, and save captures/requests in ignored `.runtime/`.
  The correction scenario approves and executes its harmless temporary Python script;
  the edit scenario approves a harmless temporary text replacement. Auto-mode
  fixtures likewise authorize only their isolated harmless commands/edits.
  These tests verify integration mechanics, not live-model judgment or provider
  latency/cache performance. Loopback socket reuse is not a measured DNS/TLS setup
  speedup. Injected file stalls do not establish live NFS/SSHFS behavior.
- Runtime fixtures use a private tmux socket inside each isolated temp directory.
  A detached IPC supervisor owns session startup and cleans up on owner exit,
  including SIGINT, SIGTERM and SIGKILL. Always create/restart sessions through
  the supervisor so a late startup cannot race cleanup. Never kill shared/default
  tmux servers or discover cleanup targets by broad process-name matching.
- Documentation-only changes need reference/format review, not runtime/model tests.
- `npm pack` rebuilds via `prepack`. `.github/workflows/release.yml` runs on pushed
  `v*` tags or manual dispatch with an existing `tag`. Manual dispatch must use the
  default branch. Checkout and validation verify the exact tag commit, semantic
  version and matching package/lockfile versions. CI runs typecheck/tests and
  `check:package` (two builds), publishes to npm, and verifies version metadata,
  the expected dist-tag and downloaded archive integrity before creating a GitHub
  release with generated notes and the same archive. Registry reads use unique
  query parameters to bypass cached 404s; npm upload acceptance is not publication
  completion. Verification polls for at most ten minutes and never retries a POST.
  An unverified publication fails with a clear processing/availability error.
  Reruns reuse the release and refresh its asset. Stable versions use GitHub latest and npm `latest`;
  semantic prerelease versions use GitHub prerelease and npm `next`, without replacing
  GitHub latest. Existing npm versions must match archive integrity on rerun.
  Publishing uses GitHub OIDC with `id-token: write` and npm 12.2.0, with optional
  `NPM_TOKEN` secret fallback. Configure npm trusted publishing for GitHub owner
  `mightykatun`, repository `opencode-reviewer`, workflow `release.yml`, no environment,
  and direct publish permission. First publication may require authenticated local
  bootstrap before npm permits trust setup; never put credentials in the repository.
  Use `npm version X.Y.Z --no-git-tag-version` to update both manifests; release tags
  must include the workflow. CI packs with `--ignore-scripts` after verification.
  Manually publishing a GitHub release is no longer a trigger. Run publishing and
  version validation tests with `node --test test/publish-release.test.mjs test/release-version.test.mjs test/npm-publication.test.mjs`.
- User installation is the npm package specifier in `tui.json` (e.g.
  `opencode-reviewer@latest`), resolved by OpenCode. Keep README to one full config
  example, installation and essential behavior. Omit migration instructions and
  release history; GitHub generates release notes. Isolated fixture
  bundle copies remain development mechanisms, not user installation instructions.

## Wiring and build quirks

- `src/tui.tsx` adapts the host SDK and wires `controller.ts` lifecycle/visibility
  to `evaluate.ts` dispatch, `classification.ts` origin checks, `context.ts`
  provenance, the evidence collectors, and `reviewer.ts` transport.
  One deadline wraps context, files, HTTP requests and format corrections.
  `approval.ts` narrows the host writer to `once` in the invocation host instance,
  never the command workdir. Controller verification/reply share five seconds;
  read-only recovery has its own five-second bound, separate from model timeout.
  `session-mode.ts` gates work before evidence enrichment; `session-mode-commands.ts`
  registers local controls. `sse.ts` frames streaming transport and
  `streaming-assessment.ts` validates both transport modes and exposes previews.
- JSX uses Solid's **universal OpenTUI** transform in `scripts/build.mjs`, not React
  or Solid DOM. TypeScript only checks types; the build emits ESM `dist/tui.js`.
  Solid/OpenTUI/OpenCode imports remain external and are supplied by the host.
- `shell-quote` is bundled; retain `THIRD_PARTY_NOTICES.md`. The packaging check
  requires exactly `dist/tui.js`, `package.json`, `README.md`, `LICENSE`, and
  `THIRD_PARTY_NOTICES.md`. Generated `dist/` and runtime captures are ignored.
- Defaults/validation live in `src/config.ts`, evidence shapes in `src/types.ts`,
  overridable prompt text in `prompts/`, fixed contract in `contracts/`, and response validation in
  `src/reviewer.ts`; consult these rather than duplicating contracts in documentation.
- `src/prompt-files.json` is the shared source/build inventory. `src/prompts.ts`
  reads its Markdown in source tests; `scripts/build.mjs` embeds it in the bundle.
  Built-in prompt edits require rebuilding and restarting.
  `instructions` is an absolute custom prompt-directory path, loaded once at startup
  with per-file fallback, a 64 KiB/file cap and the configured timeout. Custom files
  need only a restart. Both evidence/output and correction contracts are fixed;
  retain `{{validationError}}` in `contracts/PERMISSION-REVIEW-CORRECTION.md`.
  Reject legacy correction overrides with migration filenames. Runtime fixtures
  load an isolated copy of the bundle.

## Permission lifecycle and display

- Review native `bash` and native `edit`/`write`/`apply_patch` changes; independently
  enabled kinds include MCP, registered custom-tool permission checks, and all
  linked `external_directory` requests. Each kind has its own prompt. Directory
  checks, including edit preflight, get separate reviews from operation approvals.
  Directory approval may resume the tool without another prompt; do not assume
  an operation-specific check is guaranteed. Preserve each request's ID,
  exact type, scope and metadata, even for the same tool call. `always` contains
  proposed remembered patterns, not existing grants.
- Deduplicate by permission-request ID. Visibility follows the root session's first
  pending permission, including direct children; an unrelated first request must
  not show a later command's assessment. Identify every request's origin and enabled
  category before display; a native-looking permission string is insufficient.
- `reviewBash` and `reviewEdits` default true. `reviewMcp`, `reviewCustomTools`, and
  `reviewExternalDirectories` default false. The latter owns every directory
  request independently of the operation switches. Disabled kinds remain hidden
  ordering blockers and skip enrichment/model work; unknown origins may require
  a minimal invocation/registry lookup to identify their category. If all candidate
  kinds are disabled, skip even that lookup. These switches do not grant access.
- MCP classification cross-checks linked running invocations, registry exclusion,
  connected-server identity, and the host's exact permission shape. Do not split
  tool names at underscores to guess server identity. Resource server names and
  URIs are matched verbatim; only absent/null/empty optional server values are omitted.
  Collisions/ambiguous origins
  remain manual. MCP resource operations can request `read`. Custom tools may ask
  arbitrary or native-like permissions from inside execution; earlier code may
  already have run. Never treat a custom `bash` permission as a native command.
- `autoApprove` defaults false; `autoApproveDelaySeconds` defaults 15 and accepts
  integer 0–3600. Only completed, validated Safe assessments are eligible; provisional
  ratings never populate `assessment` or enable footer approval. Partial evidence
  is not an additional veto. Each request needs its own full visible countdown. Cancel or
  visibility loss after starting permanently makes that request manual for the
  running controller, including across remounts; scrolling must not cancel it.
- Fresh pending identity/scope and visibility are rechecked before each once-only
  write. Preserve single-flight submission, stale-snapshot guards, aborts and no
  automatic write retries. Native resolution may abort our HTTP acknowledgement;
  never resurrect its view or report a failure after resolution. On uncertain
  outcome keep any remaining request manual, preserve its rating, and reconcile.
- Preserve two-second read-only reconciliation for startup/missing reply events and
  its revision guard against stale snapshots. Resolution, deletion and disposal
  abort work; late results must not resurrect panels.
- The overlay shows a **Permission analysis** heading, then `✓ Safe`/`✗ Unsafe`
  using the active theme's success/error colors; `! Analysis unavailable` uses
  warning with the same typography. Use its conversation Markdown
  and syntax colors for `desc`; escape terminal-control/bidi characters via
  `displayText` first. Keep strict outer JSON and native approval controls active.
- Loading uses an eight-cell, 40 ms block scanner in the theme's muted color with
  `Evaluating`, or `Retrying` at the start of a format correction. Keep the indicator
  visible alongside provisional ratings/text until final completion. Honor
  `animations_enabled` through the public KV API, use `[⋯]` plus the same label when
  disabled, and stop the timer on unmount. `src/appearance.ts` holds theme scopes
  and scanner frames; do not import private OpenCode theme/spinner helpers.
- `ReviewProgress` carries attempt identity, evaluating/streaming/retrying phase
  and an optional preview. Guard updates by entry identity, mode, abort state,
  attempt and generation. Publish rating changes immediately; coalesce description
  updates at 40 ms and publish final results immediately. Sanitize every decoded
  prefix through `displayText`. Clear previews and reset scrolling on format retry;
  preserve scrolling through same-attempt updates and final rendering. Errors,
  resolution, disable and disposal must invalidate pending progress callbacks.
- Observe sidebar mounts through `sidebar_content`, using the slot's `session_id`
  and a mount token. Render the temporary full-height, 42-column overlay via `app`,
  covering the sidebar title, sections and footer without changing them. Hide it
  while native dialogs are open, and remove it on resolution/disposal. Keep its
  analysis scrollable. Respect hidden/narrow sidebar state; do not force it open,
  persist layout changes, or restore a bottom-bar fallback.
- Auto controls sit in a fixed sidebar footer outside the scrollbox. Key the
  panel by request ID, not changing view objects, to retain scrolling across
  ticks and streamed updates. Wait for final, non-streaming Markdown highlighting
  and a rendered frame matching the validated assessment before starting. Public
  hit testing of the heading and stable footer interior detects
  covering native fullscreen portals; outer padding rows do not. Avoid transient
  button hit targets during submission. Do not inspect private host UI.
  Native Always/rejection internal forms are not public dialogs: document explicit
  Cancel before deliberating there. Once dispatched, approval cannot be unsent.
- Invalid configuration or review failure shows `Analysis unavailable`, never a
  fabricated rating or permission decision.

## Root-conversation mode

- Register `/reviewer-enable` and `/reviewer-disable` with matching
  `Reviewer: Enable for conversation` / `Reviewer: Disable for conversation` palette
  actions through public `keymap.registerLayer` (`namespace: "palette"`, `slashName`).
  Resolve the selected session at invocation; no session means no action. Commands
  are local and must not create assistant prompts, conversation messages or model calls.
- Scope is the root conversation and all descendants within the invocation host
  directory. This mode scope does not broaden native panel visibility beyond root
  requests and direct children. Review-kind switches and other roots stay independent.
  Resolve ancestry through public metadata under a five-second bound, up to 16 parent
  edges (17 session records), rejecting cycles/missing metadata. Bound the ancestry
  cache to 4,096 entries. Load saved mode with a separate five-second bound before
  enrichment/model work. Unknown ancestry or unreadable mode suspends work rather
  than assuming enabled. A missing record defaults to enabled.
- Store version 1 records under `opencode-reviewer/session-mode-v1/` in the public
  host state directory. Filename is SHA-256 of the host-directory/root-ID pair;
  contents are only `{ version: 1, enabled: boolean }`, capped at 1 KiB on read.
  Serialize writes, use exclusive temporary files, sync and atomic rename, and
  flush on disposal. Do not persist evidence, model text or cancellation history.
- Apply a local switch immediately and acknowledge `Saved for resume` only after
  persistence succeeds. A failed save reports local application and that resume
  may use the previous setting. Failed ancestry/load reports setting unavailable;
  enabling must not bypass a corrupt saved record. Command order and load revisions
  prevent late reads or older commands from overwriting newer local choices.
  Live cross-instance mode synchronization is not implemented.
- Disable aborts analysis/countdowns and hides reports while retaining pending
  identity/order. Enable uses a fresh revision-guarded permission snapshot and a new
  review. Keep manual-only cancellation/uncertain-write tombstones until native
  resolution within the running controller. Neither re-enable nor late callbacks
  may restart canceled automation or retry an already dispatched approval. Native
  controls and permission rules keep their existing meanings.

## Provenance traps

- Resolve relative tool `workdir` against the assistant invocation's `path.cwd`,
  never the stored session directory. `cwd` is before command-internal `cd`.
  Missing invocation location stays unknown; session origin is not execution scope.
- Match root/current project records by session project ID using registered-project
  reads. Do not initialize a host instance in a command-target directory to discover
  metadata. `path.root` is the invocation worktree; project worktree may be the main
  checkout. Absent VCS with `worktree: "/"` does not imply a Git repository.
- Use the latest genuine **root** user prompt, not a subagent delegation brief.
  Filter synthetic, ignored and attributed text using public metadata. A latest
  attachment-only message must not fall back to an older text ask. Keep ancestry
  and pagination bounded and missing context explicit.

## Evidence and reviewer contract

- `deadline.ts` owns shared remaining time and phase diagnostics. Optional context
  gets at most 5 seconds/one third of remaining time and finishes before the first
  filesystem probe starts its budget. `file-access.ts` gives each
  request a shared 5-second/one-third filesystem budget, 500 ms path probes and
  1.5-second captures; two outstanding evidence transactions per plugin instance.
  Timed-out transactions retain their slots through actual settlement/cleanup.
  Skip saturated work rather than queueing it; close late-opened handles and stop
  aborted continuations. Parent aborts are never converted into optional omissions.
  Kernel I/O is not guaranteed cancellable. In-memory edit diffs survive failed
  canonicalization; unresolved aliases count independently with factual notices.
- New tool/directory evidence has bounded plain JSON, 32 levels and 16,384 values.
  Preserve mandatory arguments and exact permission scope or fail explicitly.
  Omit optional definitions as whole sections with reasons. For native directory
  access, optional metadata may be omitted while exact scope is retained; custom
  permission metadata is mandatory because it can define the operation.
  New variable JSON payloads share `maxEvidenceBytes`; common session/user context
  and generated notices are outside it. Do not use `maxFiles` to limit JSON keys.
- Read definitions only through the invocation host's public catalog. No direct
  MCP calls, resource downloads, custom-module imports, or target file reads to
  enrich MCP/custom/directory reviews. Directory scopes remain host-declared,
  without canonical-target claims. Do not copy host/MCP credentials into evidence.
  User-supplied arguments can contain private data and are documented as sent.

- Native directory patch reviews retain bounded add/update/delete/move header
  summaries and declared move destinations without contents, filesystem resolution,
  or applying hunks. Relative paths stay relative to the invocation directory.
  Scan at most 16 MiB/65,536 lines; missing or oversized mandatory summaries fail
  analysis. Summaries share the JSON budget, not `maxFiles`. Omitted native edit
  bodies set partial coverage; they do not erase the operation being authorized.

- Discovery is bounded literal Python/shell tokenization, not shell evaluation.
  Supported literal `cat`/`head` operands are captured as full bounded snapshots,
  not as emulated command output. Unknown options/expansions stay unresolved.
  Never execute substitutions/helpers, expand `~`, use PATH to find bare scripts,
  or recursively inspect imports/task runners. Flag uncertain paths/control flow
  rather than guessing; keep the original command.
- Capture bounded regular UTF-8 files, following symlinks even outside the project.
  Missing/oversized source becomes factual notices; the model decides the rating.
  The byte budget covers command plus source, not prompt/metadata. An over-budget
  command fails rather than being truncated. Files are review-time snapshots.
- Edit evidence is separate from shell evidence. Use pending host diffs without
  applying edits or reading full targets. Preserve permission identity/scope, normalize
  per-file paths/operations/move destinations, and omit raw input/metadata copies.
  `maxFiles` defaults to 6 and uses shared distinct-file counting for both kinds,
  including unavailable candidates; resolved symlink aliases count once. Each
  permission gets a fresh budget. Repeated edit entries retain their separate
  diffs. `maxEvidenceBytes` defaults to 131072 and caps included UTF-8
  diff bytes. Omit whole diffs with reasons, retain scope, and flag partial coverage.
  Never guess operations/paths from aggregate labels or synthesize a safety rating.
- Omitted files carry JSON-quoted `[!]` warnings; omitted edits carry numeric
  `[Δ]` line counts only from validated unified-diff hunks or valid host counts.
  Do not include omitted content or invent zero counts for unavailable diffs.
- Use HTTP Chat Completions with compact textual JSON evidence; `stream` is a strict
  boolean defaulting to false and controls both transport and progressive display.
  Streaming sends `stream_options: { include_usage: true }` and requires
  `text/event-stream`. No tool calling, provider-specific JSON mode, reconnects or
  automatic POST retries. Keep endpoint/model configurable and evidence semantics
  unchanged; do not add speculative calls, assessment reuse or lossy summarization.
- Instruction overrides cannot replace the fixed evidence/output contract: exactly
  `{"safe": boolean, "desc": "nonempty text"}`. The shared incremental lexer rejects
  duplicate fields, including escaped duplicates, in both modes. The prompt requests
  `safe` first but validation accepts either order. Preview only complete boolean
  tokens and decoded string prefixes; retain incomplete escapes/surrogate pairs.
  Hold syntax errors until `finish()` so terminal usage can still be consumed;
  resource-limit failures terminate immediately.
- Bounds are separate: assessment text 64 KiB UTF-8, non-stream HTTP envelope
  64 KiB, SSE event 64 KiB, SSE wire 4 MiB and 65,536 records. SSE limits include
  comments/unknown fields, and blank records count. Decode UTF-8 incrementally and
  fatally; handle CR/LF/CRLF, comments and multiline data. Reject incomplete final
  events, malformed API events, error/refusal/tool-call chunks, changed response
  identity and unsuccessful finish reasons.
- Streaming completion requires a valid text completion with `stop`, `[DONE]` and
  body EOF before final assessment validation. Do not finalize on a closing brace
  or first finish frame. Accept usage-only frames and repeated empty stop metadata;
  reject content after stop and API data after DONE. Keepalives do not extend the
  shared deadline. Cancel/release readers on every exit, own late fetch responses,
  and do not await potentially hanging underlying reader cancellation.
- Retry only assessment-format errors after successful transport, retaining the
  exact prior history, failed response and validation feedback under the shared
  deadline. HTTP/network/envelope/resource-limit errors terminate review; reject
  redirects and never display API error bodies.
- Treat command/source/quoted prompts as evidence, not reviewer instructions.
  Default Safe means bounded risk, not merely user-authorized; being outside the
  repository alone is not danger. Keep consequential effects and uncertainty visible.
- All static model guidance lives in `prompts/`, fixed contracts in `contracts/`.
  Review only the current one-time allowance, not hypothetical Allow always
  grants. Preserve exact metadata, but ignore proposed remembered patterns for
  the rating. Bash-only closing guidance may remind users to prefer Allow once;
  it must not certify future grants. Shared `EXTRA-CAREFUL-REVIEW-PROMPT.md` is overridable with normal
  fallback/validation, included only in auto mode, and never announces automation.
  Add no automation metadata or plugin notices to either model's conversation.

## Usage and lifetime accounting

- Usage stays outside assessment JSON and model evidence. Tokens are a valid
  input/output pair; cost is independently available. For the normalized exact
  endpoint `https://openrouter.ai/api/v1`, use finite nonnegative `usage.cost`,
  including zero and cost-only reports. Never add upstream inference costs or a
  catalog estimate there; absent reported cost remains unknown. Generic endpoints
  retain public host-catalog estimation with exact endpoint/model matching, cache
  rates and context tiers. Do not make pricing or billing follow-up requests.
- One `usageAttempt` per POST observes decoded envelopes before assessment/envelope
  validation, including usage received before a later failure or cancellation.
  Finalize exactly once in `finally`; repeated cumulative frames replace values,
  not add requests. Preserve the established response model for usage-only frames.
  For generic pricing, a newer unpriceable token snapshot must remove any older
  estimate, including unchanged counts with invalid cache metadata. OpenRouter cost
  is independent of token validity. No valid received component means no entry.
- Sum report components across all format attempts independently: tokens or cost
  appear only if that component covers the entire chain. Cost-only and token-only
  reports are valid. Render stats in theme textMuted inside the report scrollbox.
  Inline lifetime belongs only in this completed valid-request-usage block, never
  alone while loading, failed or missing all report usage. The lifetime palette
  command remains independent. Unknown costs are not free; label partial coverage.
- `LifetimeUsage` writes version 2 per-instance atomic snapshots under
  `opencode-reviewer/usage-v2/` in the public state directory. Read legacy
  `opencode-reviewer/usage-v1/` alongside them without copying/rewriting snapshots
  or reinterpreting original estimates. Keep separate request, token-coverage and
  pricing counts, numeric totals and timestamps only; reads are capped at 1 KiB
  per snapshot. No checkout or native session-accounting writes.
- Accounting and persistence failures cannot change review outcomes. Abort and
  await actual review workers/finalizers before flushing queued lifetime writes on
  disposal. Failed storage reports unavailable without silently resetting history.
  Refresh totals on local usage and palette open; never replace a dismissed dialog
  after async reads. Explain received-only accounting, unknown unreported charges,
  mixed reported/estimated cost and unrecoverable earlier unrecorded usage.

## Diagnostics and measurements

- `withDiagnostics(observer: DiagnosticObserver): TuiPlugin` is an opt-in exported
  embedding/fixture adapter, not a `tui.json` setting. The default plugin has no
  diagnostic logger/store. `src/diagnostics.ts` emits frozen events containing only
  fixed phase labels, monotonic `at`/`duration` milliseconds and local numeric
  `review`/`attempt`/`call` correlations. Never include IDs, prompts, evidence,
  paths, URLs, headers, credentials or model output. Observers are not awaited;
  throws and rejected promises cannot affect review or approval.
- Transport phases are dispatch, headers, first decoded assessment content, first
  parsed rating and final validation, measured relative to attempt dispatch.
  Final validation records `finish()` completion even for rejected format, not
  necessarily success. Host context/approval/pending-read durations are per call;
  display/final-render/countdown durations are relative to the review trace.
  Review ordinal zero denotes instance-wide reads. Keep client/server clocks and
  UI polling resolution distinct when interpreting fixture results.
- Streaming fixtures own capped 512-event diagnostic artifacts in `.runtime/`.
  Server-side measurements/audits record request counts, bytes, connection reuse
  and synthetic cache observations. Do not infer live-provider performance, cache
  hit rates or billing completeness from local fixtures. Preserve compact evidence
  and stable prefixes; efficiency changes require demonstrated, lossless benefit.
