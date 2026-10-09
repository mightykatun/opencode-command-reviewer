# Maintainer guide

## Writing style

- NEVER use em dashes.
- Keep fixed user-facing interface copy in `src/ui-text.ts`: review labels,
  approval controls, palette titles, toasts, usage summaries and desktop banners.
  Use named strings and typed formatters rather than assembling sentences in views.
  Edit values while retaining keys and formatter parameters; run `npm run build`
  and restart OpenCode to use a rebuilt plugin. This is source-level customization,
  not a `tui.json` option. Keep labels short enough for the 42-column sidebar.
  Model prompts/contracts, model-generated reports, host-owned controls and
  technical diagnostics retain their own sources. Keep behavioral tests' expected
  wording independent of the catalog so accidental display changes are detectable.

## Scope and integration

- Target OpenCode **1.18.35**, local Linux terminal TUI. Other clients, remote
  workspaces and OpenCode 2 are unverified.
- The plugin is advisory by default. Explicit `autoApprove: true` may reply
  `once` to an enabled, visible (or covered only by production history), completed,
  validated and rendered Safe review
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

Development uses Node.js 24.15.0+ within 24.x (recommended), or 22.22.2+ within
22.x, and npm. These floors satisfy the pinned SDK's transitive `ini` requirement;
the distributed plugin's Node runtime engine remains separate. Run commands from
the repository root:

```sh
npm ci --ignore-scripts
npm run check          # typecheck -> node:test via tsx -> pure helpers -> build
npm run test:helpers   # pure .mjs checks; no build, tmux or OpenCode
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
  `test/diagnostics.test.ts`. `scripts/helper-tests.json` is the shared pure `.mjs`
  inventory used by `npm run test:helpers`, `npm run check` and active release-policy
  validation. Keep tmux cleanup and built-package smoke tests separate. Read-only
  pull-request CI tests the supported Node floors, package reproducibility and
  isolated tmux cleanup; its checkout/setup actions use remotely verified SHAs.
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
  Native and reviewed stages share `scripts/smoke-stages.mjs`. For `external-edit`,
  `--disabled` disables directory review while the independently enabled edit
  reviewer remains active. Combine `--disabled --auto --held` to manually allow
  the directory, release the held edit assessment and observe its own countdown.
  `--held` belongs only to the first enabled review, never a disabled native stage.
  `--plan` prints the stage plan without a host, bundle, model or tmux session;
  it is also supported by `scripts/smoke.mjs`.
  Flags include `--auto`, `--disabled`, `--cancel`, `--unsafe`, `--error`,
  `--correction`, `--held`, `--no-usage`, `--missing-usage`, `--unpriced`,
  `--storage-error`, `--native-bash-enabled`, `--resource-whitespace`, `--stream`,
  `--stats`, and `--no-extra-careful`. The latter verifies omitted extra-careful
  guidance while keeping auto-approval enabled. `npm run test:runtime-permissions` runs a
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
    `truncated --static` exercises a configured 4,096-token limit, a provisional
    Safe stream ending with `length`, preview clearing, exact request regeneration,
    terminal usage consumption and final-only approval.
  - `node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats`
    and `node scripts/smoke-permissions.mjs external-edit --auto --stream --stats`
    cover streamed category integration, terminal usage and cumulative-frame accounting.
    Streamed usage fixtures include synthetic cache read/write counts automatically;
    there is no separate cache-usage switch.
  - `node scripts/smoke.mjs external --measure-reuse` checks a fresh reviewer-only
    origin followed by a warm request on the same TCP connection. Shared helpers in
    `scripts/smoke-reviewer.mjs` audit compact JSON, stable system prefixes, exact
    correction history and one POST per planned attempt.
  - `node scripts/smoke.mjs auto-shell --network-retry --notifications` injects
    HTTP 429 then 503 with Retry-After, audits byte-identical retry bodies, and
    verifies one final countdown/approval with incomplete report-usage coverage.
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
  Tmux starts with `-f /dev/null` and fixture-local HOME/XDG state, a controlled
  shell/locale, explicit truecolor support and an environment that excludes inherited tmux identities,
  shell startup hooks and credentials. Tmux's own private pane variables remain.
  A detached IPC supervisor owns session startup and cleans up on owner exit,
  including SIGINT, SIGTERM and SIGKILL. Always create/restart sessions through
  the supervisor so a late startup cannot race cleanup. Never kill shared/default
  tmux servers or discover cleanup targets by broad process-name matching.
  The interruption regression uses a real tmux `wait-for` barrier after the pane
  program has started but before launch acknowledgement. It kills the owner,
  releases startup, verifies complete cleanup and keeps an independent survivor
  server and pane alive. It does not infer startup coverage from a delay alone.
  Run `npm audit --json` and `npm why glob` when assessing deprecation notices.
  The current audit reports no vulnerabilities; deprecated `glob@9.3.5` is a dev
  dependency of the pinned OpenTUI Babel resolver and uses `minimatch@8.0.7`.
  Retain that compatible tree while the audit is clear; do not force a major glob
  override or change the supported host SDK/OpenTUI pins solely for deprecation.
- Documentation-only changes need reference/format review, not runtime/model tests.
- `npm pack` rebuilds via `prepack`. `.github/workflows/release.yml` runs on pushed
  `v*` tags or manual dispatch with an existing `tag`. Manual dispatch must use the
  default branch. Checkout and validation verify the exact tag commit, canonical
  npm-compatible version and matching package/lockfile versions. Build metadata
  (`+...`), normalization-changing versions and npm SemVer bounds violations are
  rejected before packing or publication. Package manifests must have no top-level
  `tag`; `publishConfig` contains exactly public `access` and the npm `registry`.
  Package-wide concurrency serializes
  releases. The `contents: read` validation job installs dependencies, runs checks
  and `check:package` (two builds plus actual archive inspection), and uploads one
  archive plus a strict manifest. The separate OIDC/write publish job downloads the
  immutable artifact ID and checks its tag, commit, workflow commit, run, validation
  attempt, byte count, SHA-512 and exactly five regular package files. Publication
  helpers come from a sparse checkout of `github.workflow_sha`, never the artifact
  or a historical tag. The publish job installs only npm 12.2.0 globally and does
  not install project dependencies, build, test or execute package code. Policy
  helpers inspect the validated regular-file USTAR archive without extracting it.
  npm's supported CLI may internally unpack those validated regular files to read
  the manifest, including during dry-run. This is an explicit exception to the
  original no-extraction policy: its cache is isolated in a fresh mode-0700
  directory under the publish job's runner temp directory. The archive remains
  the artifact of record and the same verified bytes are published and attached.
  Registry reads use unique
  query parameters to bypass cached 404s and reject redirects. Header/body transport
  failures retry reads under the original deadline; complete malformed JSON or
  mismatched archives fail. Verification polls for at most ten minutes. Uploads
  never retry, including inside npm (`--fetch-retries=0`).
  An unverified publication fails with a clear processing/availability error.
  Reruns reuse the release and refresh its asset. Stable versions advance GitHub
  latest and npm `latest` only by SemVer precedence; prereleases advance only npm
  `next` and remain GitHub prereleases. New historical versions use npm `archive`. Existing
  versions verify their immutable archive independently of current channel ownership
  and never retag. Failed-publish-only reruns may reuse the successful validation
  artifact, bound to that validation attempt and the same workflow run and digest.
  Publishing uses GitHub OIDC with `id-token: write` and npm 12.2.0, with optional
  `NPM_TOKEN` secret fallback. Configure npm trusted publishing for GitHub owner
  `mightykatun`, repository `opencode-reviewer`, workflow `release.yml`, no environment,
  and direct publish permission. First publication may require authenticated local
  bootstrap before npm permits trust setup; never put credentials in the repository.
  Use `npm version X.Y.Z --no-git-tag-version` to update both manifests; release tags
  must include the workflow. CI packs with `--ignore-scripts` after verification.
  Manually publishing a GitHub release is no longer a trigger. Run release checks
  with `node --test test/publish-release.test.mjs test/release-version.test.mjs test/npm-publication.test.mjs test/release-artifact.test.mjs test/release-workflow.test.mjs`.
  After building, `node --test test/release-artifact-smoke.test.mjs` verifies real
  packing and the artifact handoff without publishing. With npm 12.2.0 installed,
  `node --test test/npm-cli-smoke.test.mjs` separately checks actual CLI dry-run,
  private-cache extraction, npm's bundled tag/version semantics and USTAR parsing.
  It performs no registry publication or OIDC exchange. All workflow actions are
  pinned to remotely verified commit SHAs.
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
  integer 0–3600. Only completed, validated Safe assessments are eligible.
  Positive countdowns add a one-second initial hold while displaying no more than
  the configured starting number; zero delay has no hold.
  Provisional ratings never populate `assessment` or enable footer approval. Partial evidence
  is not an additional veto. Each request needs its own full visible countdown. Cancel or
  visibility loss after starting permanently makes that request manual for the
  running controller, including across remounts; scrolling must not cancel it.
- Fresh pending identity/scope and visibility are rechecked before each once-only
  write. Preserve single-flight submission, stale-snapshot guards, aborts and no
  automatic write retries. Native resolution removes/aborts the review view
  immediately. A dispatched POST's acknowledgement may finish under the remaining
  original five-second deadline to establish notification attribution; never send
  a new write, resurrect its view or report a failure after resolution.
  Deletion/disposal still abort that acknowledgement. On uncertain
  outcome keep any remaining request manual, preserve its rating, and reconcile.
- Preserve two-second read-only reconciliation for startup/missing reply events and
  its revision guard against stale snapshots. `pending-refresh.ts` reconciles only
  after bounded reads succeed, with lifecycle/generation checks outside the deadline
  callback. Resolution, deletion and disposal
  abort work; late results must not resurrect panels.
- The overlay shows a **Permission analysis** heading, then `✓ Safe`/`✗ Unsafe`
  using the active theme's success/error colors; `! Analysis unavailable` uses
  warning with the same typography. Use its conversation Markdown
  and syntax colors for `desc`; escape terminal-control/bidi characters via
  `displayText` first. Keep strict outer JSON and native approval controls active.
- Loading uses an eight-cell, 40 ms block scanner in the theme's muted color with
  `Evaluating`, or `Retrying` at the start of a format correction. Keep the indicator
  visible while the rating is unknown, including description-first previews; hide
  its label and spinner immediately when either provisional rating arrives. Format
  retries clear the rating and restore the indicator. Hiding it never makes the
  assessment final or starts approval early. Honor
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
  Production history is the sole normal-plugin physical-cover exception. Keep one
  stable app-slot root containing keyed live/history siblings: returning a changing
  fragment makes the host replace the live render tree. History must be mounted in
  the current browser/route/sidebar session and own both stable hit probes, including
  the public ScrollBox viewport in footerless states. `history-cover.ts` retains only
  the exact proven hit pair through a same-frame child replacement/close; the next
  live frame clears that handoff. No logical-open or caller-provided cover can grant
  this exception in the normal plugin. Final live Markdown must still match the
  validated result, finish highlighting, and paint before eligibility. Diagnostic
  first-display/final-render remain physical claims, separate from readiness.
- Invalid configuration or review failure shows `Analysis unavailable`, never a
  fabricated rating or permission decision.

## Linux notifications

- `notify` and `notifySound` default true. Desktop settings are independently
  parsed; invalid notification options disable notification work without changing
  review. `notificationSoundDirectory` is an absolute optional path.
- Policy, public host events/scope, process ownership, Linux delivery, terminal
  activation and audio/codec live in separate `src/notification-*.ts` modules.
  Keep TUI/controller wiring narrow and notifications off approval critical paths.
- Track visited roots and descendants, with root titles only. Event births establish
  eligibility; startup snapshots/backlogs do not replay. Final validated assessments
  gate attention, and final Safe reviews get one second to start their countdown.
  Manual-wait episodes deduplicate but can renew after canceled automation.
- Countdowns send no desktop banner or audio; confirmed automatic success uses approval audio
  for positive/zero delays. Approval sounds are limited to one per two seconds.
  Native/manual footer approvals are not automatic successes. Unreviewed requests
  and disabled conversations still notify. Errors and root-turn completion are
  distinct from retries, questions, tool steps, children and user interruption.
- Linux uses owned fixed-purpose `notify-send`, `gdbus`, `paplay`/`pw-play` calls,
  never a shell or the command under review. Normal transient banners request
  line-buffered `notify-send` output via `stdbuf`, so its delivery ID reaches audio
  immediately instead of at banner dismissal. The wrapper execs the owned process.
  Banners request
  desktop-default expiry and suppress duplicate desktop sound. GNOME activation
  uses service/screen identity, never guessed window titles or a new terminal.
  GNOME requires Terminal desktop-entry attribution to issue an activation token;
  libnotify's bounded debug output supplies it in memory. Pass it through GTK
  platform data before presenting the exact screen. Never log/persist tokens.
  Dialogs prevent navigation, not terminal activation. Other terminals degrade.
- WAV then MP3 then bundled fallback; capture at most 4 MiB and decode at most
  ten seconds of mono/stereo audio. Bundled mpg123 WASM avoids FFmpeg/runtime
  downloads. Normalize to -20 dBFS RMS subject to -3 dBFS peak before private PCM
  playback. Cooperatively yield; bound preparations/processes and retain actual
  transaction ownership through late cleanup. Sound originals are unchanged.
- `sounds/*.mp3` and decoder are embedded in `dist/tui.js`; preserve exactly five
  package files and third-party notices. Build trims unused decoder worker exports.
  `withNotifications` and `withNotificationProcesses` are opt-in fixture/embedding
  seams, not configuration. Generic fixtures explicitly use `notify: false`.
- `node scripts/smoke.mjs auto-shell --notifications` records real host
  notification delivery and normalized bundled audio using isolated process I/O.
  Supported existing scenarios also include `auto-zero`, `auto-unsafe`,
  `auto-error`, `auto-cancel`, `auto-hide`, `bash-disabled`, and `correction`.
  `node scripts/smoke-notification-events.mjs question` covers a native question
  and completed root response; `error`, `ended`, and `cancel` cover other outcomes.
  These do not prove desktop focus; test real GNOME clicks separately.
  `npx tsx scripts/smoke-notification-desktop.ts --sounds` exercises actual local
  playback. `--click` waits ten seconds before banners for manual cross-workspace
  and terminal-tab acceptance; `--critical` is a diagnostic-only test override.

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
  cache to 4,096 entries and retain distances so warmed suffixes do not bypass the
  16-edge limit. Load saved mode with a separate five-second bound before
  enrichment/model work. Reads are single-flight per root and capped at two actual
  transactions per instance, retaining capacity through late settlement/cleanup.
  Unknown ancestry or unreadable mode suspends work rather than assuming enabled.
  Revision-current reconciliation retries unavailable state without repeatedly
  loading a known disabled setting. A missing record defaults to enabled.
- Store version 1 records under `opencode-reviewer/session-mode-v1/` in the public
  host state directory. Filename is SHA-256 of the host-directory/root-ID pair;
  contents are only `{ version: 1, enabled: boolean }`, capped at 1 KiB on read.
  Serialize writes, use exclusive temporary files, sync and atomic rename, and
  flush on disposal. Do not persist evidence, model text or cancellation history.
- Apply a local switch immediately and show the success confirmation only after
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
  `shell-discovery.ts` owns cursor-based handlers and one shared nested-discovery
  work allowance: 16 MiB UTF-8, 65,536 tokens, 16,384 references/expansions,
  262,144 parser steps, 256 notices and 500 ms. Preserve completed references with
  an explicit limitation on optional discovery exhaustion. Unsupported unquoted
  whitespace cannot split literal filenames. Only bare or exact conventional
  `/bin`/`/usr/bin` program spellings infer standard utility/interpreter operands;
  other explicit executable paths qualify their own source. In-process shell-state
  uncertainty invalidates cwd rather than selecting a decoy from the invocation path.
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
  Normalize known data fields without cloning unrestricted host metadata. Native
  headers/scope have a separate 16 MiB and 16,384-entry bound; diff measurement
  work is shared. Optional omitted-diff counts share 16 MiB/65,536 lines/250 ms,
  falling back only to valid host counts. Capture admitted shell files before later
  candidate canonicalization can exhaust their capture allowance.
  Never guess operations/paths from aggregate labels or synthesize a safety rating.
- Omitted files carry JSON-quoted `[!]` warnings; omitted edits carry numeric
  `[Δ]` line counts only from validated unified-diff hunks or valid host counts.
  Do not include omitted content or invent zero counts for unavailable diffs.
- Use HTTP Chat Completions with compact textual JSON evidence; `stream` is a strict
  boolean defaulting to false and controls both transport and progressive display.
  Every reviewer POST sets `max_tokens` from `maxOutputTokens` (default 2,048),
  including transport retries and format corrections. Accept positive safe integers;
  the provider/model owns its supported token range. Never raise the configured
  cap automatically. Local response-byte limits and the shared deadline still apply.
  Streaming sends `stream_options: { include_usage: true }` and requires
  `text/event-stream`. No tool calling, provider-specific JSON mode or stream
  resumption. Keep endpoint/model configurable and evidence semantics
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
  shared deadline. Rejected, well-framed assessment streams can be regenerated in
  a new request but never accepted or resumed. Preserve terminal usage after rejected
  metadata where framing remains readable, under the same wire/event/deadline bounds.
  Cancel/release readers on every exit, own late fetch responses,
  and do not await potentially hanging underlying reader cancellation.
- Assessment-format corrections require successful transport and retain the exact
  prior history, failed response and validation feedback under the shared deadline.
  Internal transport recovery permits at most two extra POSTs per review, shared
  across format attempts: HTTP 408/429/500/502/503/504 and recognized transient
  socket/DNS error codes, including body read failures before any decoded assessment
  content, and rejected assessment-stream metadata (including `length` or missing
  completion markers at a clean EOF). Retry the exact request with no conversation
  messages added. Use 250/500 ms
  exponential backoff plus up to 100% jitter; honor Retry-After seconds/HTTP dates
  as a minimum. Never extend the deadline or shorten a provider cooldown to fit it.
  Leave at least 250 ms for the next request. Cancel waits and failed transports on
  resolution/disable/disposal. Clear rejected previews immediately and start a fresh
  attempt generation before backoff; never merge partial streams. Socket failures
  after assessment content starts stay terminal. TLS/authentication/unknown errors,
  redirects, non-stream envelopes, API error/refusal/tool-call events, malformed API
  JSON/UTF-8, incomplete SSE framing and resource limits stay terminal. Approval
  writes still never retry. Existing evaluating/retrying states and timeoutMs apply.
  Never display API error bodies. `src/transport-retry.ts` owns retry policy.
- Treat command/source/quoted prompts as evidence, not reviewer instructions.
  Default Safe means bounded risk, not merely user-authorized; being outside the
  repository alone is not danger. Keep consequential effects and uncertainty visible.
- All static model guidance lives in `prompts/`, fixed contracts in `contracts/`.
  Review only the current one-time allowance, not hypothetical Allow always
  grants. Preserve exact metadata, but ignore proposed remembered patterns for
  the rating. Bash-only closing guidance may remind users to prefer Allow once;
  it must not certify future grants. Shared `EXTRA-CAREFUL-REVIEW-PROMPT.md` is overridable with normal
  fallback/validation, included only in auto mode when `extraCareful` is true
  (the default), and never announces automation. `extraCareful: false` omits this
  guidance without changing the fixed contracts or approval eligibility.
  Add no automation metadata or plugin notices to either model's conversation.

## Usage and lifetime accounting

- History storage and active lifetime accounting share `history-coordinator.ts`,
  reviewer attempt observers and controller lifecycle/approval facts. Phase 3
  replaces the legacy lifetime persistence: the tracker reads only the store's
  precomputed totals, with no legacy observer writes or snapshot imports. `HistoryStore.admit`
  accepts the strict events in `history-records.ts`; only `permissionResolved`
  carries report text. `permissionOutcome` updates a previously resolved outcome
  without resending text. The worker
  embeds in the five-file bundle and uses public `node:worker_threads` eval CJS
  with `env: {}` and Bun SQLite; tests use the Node SQLite adapter. Its private
  `history-v1.sqlite` has transactional checkpoints, opaque contribution/tombstone
  keys and precomputed totals. It does not import legacy usage snapshots.
- `HistoryStore.query` returns snapshot history navigation, totals or bounded
  session maintenance pages, single-session stored ownership or data-only shared
  resolution facts. Its optional `settled` promise retains actual worker
  ownership after a bounded caller timeout. Commit/failure subscriptions and
  `HistoryRefresh` support future integration. Disposal drains against a supplied
  monotonic lifecycle-abort timestamp with a 3.5-second deadline. Run
  `npx tsx --test test/history*.test.ts` and, after building,
  `node scripts/smoke-history-storage.mjs` for the packed production adapter in
  OpenCode 1.18.35. `node scripts/smoke-history-lifecycle.mjs auto-shell` runs
  the existing real-host approval fixture and verifies its production database.
  Other scenarios are `auto-immediate` (manual footer), `auto-manual` (unattributed
  native once) and `auto-cancel` (cancellation followed by explicit rejection).
  Phase 4 history UI uses this store. The existing lifetime presentation also uses it.
  `scripts/smoke-lifetime.mjs` seeds isolated fixtures through production SQL events
  using the Node adapter, with consistent review/POST identity. It also places
  large legacy seeds in all four old directories and verifies they remain untouched
  and excluded, with no new legacy snapshots. The host uses the Bun adapter.
  Lifetime regressions include `npx tsx --test test/lifetime*.test.ts`,
  `node scripts/smoke.mjs correction --seed-lifetime`, `node scripts/smoke.mjs edit`
  (including host restart), and `node scripts/smoke-streaming.mjs complete --stats`
  or `truncated --static --stats`. Permission stats fixtures also cover `--no-usage`,
  `--correction --missing-usage`, `--unpriced` and `--storage-error`.
- Capture category from actual evidence and scope from the invocation host and
  `modes.root`, never a target directory or a history-browsing mode load. Each
  execution and POST has a separate UUID. Keep the latest completed candidate
  through disabled mode and failed replacement; unresolved text remains memory-only.
  Native once events have no submitting-client identity. The public keymap trace
  lacks request/selected-option identity, so do not infer manual attribution from
  it or from no local dispatch. Explicit always/reject and confirmed reviewer writes
  are usable. A linked assistant `MessageAbortedError` plus permission removal can
  qualify as cancellation; generic idle/error cannot. Check shared observed dispatch
  uncertainty before cancellation admission. At most 128 removed candidates await
  shared confirmation for 6.5 seconds, polling every two seconds. Expiry/unavailable
  attribution omits the body; it never proves absence of remote writes. Disposal
  drops candidates immediately, allows real transport finalizers to enqueue usage,
  and drains/terminates storage within 3.5 seconds of lifecycle abort. Live deletion
  invalidates candidates immediately, with bounded stored-ownership fallback for
  deleted children. `history-maintenance.ts` reconciles missed offline deletions
  and saturated/unavailable live deletion ownership reads as described below.

- Maintenance uses indexed stored ownership pages of at most 100 in the exact
  invocation host scope. One row runs per two-second turn, checking its root first
  even if only descendants have stored rows. A turn has a five-second budget;
  each public `session.get` has a 1.5-second abort bound. Keep one actual maintenance
  transaction through host settlement and `HistoryRead.settled`, including after
  timeout/disposal. No replacement probes or scans while that work still owns its
  slot. Stop scheduling and publication on lifecycle abort. Never initialize an
  instance in a stored target directory or use session-list omissions as absence.
- The pinned `api.client.session.get` uses HTTP 404 with exactly
  `{ name: "NotFoundError", data: { message: "Session not found: <requested ID>" } }`.
  Validate the status, shape and requested identity. Generic missing data, another
  error/404 shape, 403, cancellation, timeout and transport failures never delete.
  Unknown roots prevent child probing; an absent root removes all its descendant
  details, while an absent child removes only its own. Existing opaque tombstones
  and contribution keys prevent resurrection/double counting; totals never decrease.
- Live deletion immediately invalidates candidates and the browser. Before any
  ownership read, mark one revisioned scope-wide maintenance-dirty bit, also used
  for offline verified absence and failed deletion admission. It is not a missed-ID
  queue or a lost-metrics estimate. Gate local history publication until a complete
  healthy scan with the same dirty revision and an empty write queue reconciles it.
  A new deletion restarts the scan; failed/inaccessible rows retry on later passes.
  The conservative gate covers the current invocation scope, including unknown child
  ownership, and uses existing Loading history copy. Lifetime reads remain separate.
  Other instances learn deletion after durable commits through normal refresh.
  Additive v1 indexes cover cascading session/review/attempt deletion lookups.
- Run `npx tsx --test test/history-maintenance.test.ts` for actual two-client SQLite,
  paging, outage recovery, dirty UI gating and retained transaction ownership. After
  building, `node scripts/smoke-history-maintenance.mjs` loads the npm-packed plugin,
  stops its TUI host, deletes native root/child sessions through an isolated public
  API host, stops that host, and resumes the TUI. It proves native root cascading,
  the actual NotFound response, transient 403 preservation/recovery, unchanged totals,
  other-scope retention, rendered survivors and zero model/permission calls. Captures
  live in `.runtime/history-maintenance/`. The 403 injection is fixture-local public
  client adaptation, not a host-global patch. Synthetic nonexistent session IDs in
  older fixtures can now be legitimately removed by maintenance.

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
  estimate, including unchanged counts with invalid cache metadata. Explicit null,
  primitive and array cache-detail containers invalidate estimates; omission may use
  zero cache counts. Consume rejected asynchronous accounting/progress observers
  without awaiting them. OpenRouter cost
  is independent of token validity. No valid received component means no entry.
- Sum report components across all POSTs, including transport and format attempts,
  independently: tokens or cost
  appear only if that component covers the entire chain. Cost-only and token-only
  reports are valid. Render stats in theme textMuted inside the report scrollbox.
  Inline lifetime belongs only in this completed valid-request-usage block, never
  alone while loading, failed or missing all report usage. The lifetime palette
  command remains independent. Unknown costs are not free; label partial coverage.
- Lifetime totals come exclusively from `HistoryStore.query({ type: "totals" })`,
  the transactional precomputed aggregate in `history-v1.sqlite`. First initialization
  starts at zero; later instances resume and share these totals across host scopes.
  Leave `usage-v1/` through `usage-v4/` untouched and excluded. Never scan/import them,
  dual-write snapshots or reconstruct totals from detailed review/attempt rows.
  `lifetime.ts` retains pure validation, weighted aggregation and exact presentation
  helpers. Received-request, token/pricing coverage, accepted ratings and activity
  remain separate. No checkout or native session-accounting writes.
- Count ratings at controller acceptance of each completed, validated review,
  independently of received usage. Previews, transport/format attempts, errors,
  stale/aborted results and repeated display updates never count. A fresh accepted
  review after re-enable counts again. Correlated lifecycle events carry accepted
  identity and timing; exceptions/rejected promises cannot affect review or approval.
  Persist counts and their earliest timestamp transactionally through those events,
  never separate legacy increment callbacks. Old snapshots contribute nothing.
  Display counts alongside inline lifetime cost only in the
  existing completed-report usage block, and always in the lifetime palette.
- The compact lifetime dialog shows Reviews, Retries, Tokens, Cost, Safe, Unsafe,
  Auto-approved and average time to the full report and rating. Reviews means
  accepted final assessments; percentages use those recorded reviews. Count retries
  when extra reviewer POSTs are dispatched, including format and transport attempts,
  never just when a backoff is scheduled. Count only confirmed automatic approvals,
  independently of notification settings. Manual approvals and uncertain writes do
  not count. Metrics observers cannot affect review or approval.
- Measure monotonic durations from evaluation start after the mode gate through
  evidence/retries to final controller acceptance and the accepted attempt's first
  parsed rating. Clear the rating timestamp on format/transport retry. Non-streaming
  ratings use completion time. Exclude rendering and countdown time. Persist only
  sample counts and online means in the aggregate; combine means by sample weight.
  Detailed accepted-review timing fields are separately retained by history storage.
  Never store timing arrays. Legacy snapshots contribute no metrics or partial-history
  warning. Preserve received-only token/pricing coverage and show unavailable averages
  before the first measured review.
- Accounting and persistence failures cannot change review outcomes. Abort and
  await actual review workers/finalizers within the existing history drain deadline
  on disposal. Failed saves/reads report unavailable without resetting totals;
  recovery shows committed totals without a new warning, including after overflow.
  `lifetime-view.tsx` uses `HistoryRefresh`: local commits and palette open request
  immediate reads, with two-second shared polling. Coalesce to one actual query and
  one follow-up, retaining `HistoryRead.settled` ownership through timeout/cleanup.
  Write failures invalidate older results. Stop publication/polling on lifecycle
  abort; async results never replace or resurrect a dismissed dialog. Inline lifetime
  still requires the existing completed, valid report-usage block. Preserve exact
  labels, formatting, received-only coverage and mixed reported/estimated costs.

## Report history UI (Phase 4)

- `history-controller.ts` owns logical open state, the selected indexed snapshot,
  generation guards and the actual scroll offset. Resolve ancestry through
  `HistoryCoordinator.root`, never the review-mode load gate. Disabled conversations
  and invalid reviewer configuration can still browse committed history.
- `/reviewer-history` and `Reviewer: Report history` open the newest entry; repeat
  refreshes newest and resets scroll. Close/Escape close; route changes close even
  within one root. Hidden/narrow sidebars and dialogs retain logical state without
  forcing layout. Native child routes have no sidebar and can arm history invisibly.
- Use `HistoryRefresh` and one indexed selection, not an in-memory history list.
  Retain entry identity and scroll on insertions/count/outcome refreshes. A new report
  payload resets scroll. Save the bounded `(completed,tie,id)` order cursor so deletion
  falls forward to the nearest newer survivor, then backward, rather than to newest.
  Durable root tombstones close the panel. Locally deleted selections suppress stale
  precommit snapshots, including unreadable payloads. Maintenance-dirty scope gating
  also suppresses reopened/late snapshots until deletion reconciliation completes.
- `history-view.tsx` uses the public app slot above the still-mounted live view.
  The 42-column panel has fixed heading/Close and outcome/navigation footer. Reuse
  `review-description.tsx` for sanitized Markdown and theme syntax. History metadata
  is original report usage, model, then provider, always muted and without lifetime.
  Exact strings live in `ui-text.ts`; `history-layout.ts` owns balanced `..` shortening
  and exact-count one/two/three-row overflow. Invalid payloads have a warning/bold
  placeholder and navigation, without a rating or outcome badge.
- Unmodified history keys use a public base-mode layer at priority 100, native dialog
  checks, and actual heading/stable-footer hit probes. Autocomplete/dialogs retain
  their keys; end navigation is consumed. Restore stored scroll only after Markdown
  readiness and a stable measured scroll extent, including remounts after hiding.
- Phase 5 keeps live readiness and an existing countdown behind production history,
  including empty/loading/error states. History opening/closing/navigation does not
  reset the keyed live request or its deadline. All native visibility, ordering,
  mode and manual/uncertain tombstone gates remain. A native palette dialog cancels
  an active countdown; choosing history afterward cannot revive it. Public direct
  dispatch of the registered history command has no dialog and preserves countdowns.
  History controls never approve; committed background reports update counts without
  jumping a current selection. History never creates notification births or sounds.
- `node scripts/smoke-history-auto.mjs covered` uses the actual production HistoryView,
  public command dispatch and `/reviewer-history`, the packed bundle, and real host
  permission/SQLite operations. Other scenarios are `countdown`, `navigation`,
  `error`, `zero`, `dialog`, `fullscreen`, `hide`, `narrow`, `manual`, and `mode`.
  It shares Phase 0 transport/render assertions, but supplies no synthetic cover.
  `withHistoryObservations` supplies read-only render/diagnostic observations plus
  notification backend I/O, not configuration or readiness overrides. Assertions
  retain the existing one-second render grace, silent countdown, confirmed approval
  audio, and root completion notification. Captures/results/metrics are under
  `.runtime/history-auto-<scenario>/`. Offline maintenance has its separate packed
  fixture described above.
- Focused tests: `npx tsx --test test/history-browser.test.ts test/history-storage.test.ts`.
  After building, run `node scripts/smoke-history.mjs browse`; other implemented
  scenarios are `scroll`, `empty-error`, `resume`, `shared`, `delete`, `visibility`,
  and `disabled-invalid`. These use `smokeRuntime`, the actual bundle, production SQL
  event seeds and public host session operations. They assert rendered results,
  unchanged model requests and no permission replies. Limit hosts to two concurrently.
  Exact Phase 4 runs and captures are recorded in `REVIEWER_HISTORY_PLAN.md`.

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
