# Maintainer guide

## Scope and integration

- Target OpenCode **1.18.34**, local Linux terminal TUI. Other clients, remote
  workspaces and OpenCode 2 are unverified.
- The plugin is advisory by default. Explicit `autoApprove: true` may reply
  `once` to an enabled, visible, completed Safe review after its countdown or a
  footer click. Never send `always`/`reject`, change permission rules, directly
  execute commands or directly apply edits. Use public `@opencode-ai/plugin/tui`
  APIs and public TUI slots; do not patch the native approval dialog.
- Register the plugin and options in `tui.json`; permissions belong in
  `opencode.json`. Source changes require rebuilding; plugin/config changes require
  restarting OpenCode. Keep `README.md` focused on installation and user behavior.
- Package name and exported plugin ID are `opencode-reviewer`. OpenCode 1.18.34
  loads the default `{ id, tui }` module and package `exports["./tui"]`; package
  installs also check `engines.opencode`. No separate description manifest is
  required. Keep package description/repository/homepage/bugs metadata current.

## Development and verification

Requires Node.js 22+ and npm. Run commands from the repository root:

```sh
npm ci --ignore-scripts
npm run check          # typecheck -> node:test via tsx -> build
npm run test:runtime   # requires an up-to-date dist/tui.js; does NOT build
npm run check:package  # builds twice, compares hashes, checks exact package contents
```

- Focused tests: `npx tsx --test test/context.test.ts`; select by name with
  `npx tsx --test --test-name-pattern='missing invocation path' test/context.test.ts`.
- Runtime/UI or host-integration changes warrant real-TUI fixtures after a build.
  Run one with `node scripts/smoke.mjs external`; other scenarios are `correction`,
  `cancel`, `error`, `edit`, `write`, `patch`, `edit-cancel`, and `edit-config-error`.
  Review-switch scenarios are `edit-disabled`, `bash-disabled`, and `external-disabled`.
  Auto-mode scenarios are `auto-shell`, `auto-edit`, `auto-external`, `auto-zero`,
  `auto-immediate`, `auto-manual`, `auto-unsafe`, `auto-error`, `auto-cancel`,
  `auto-hide`, `auto-dialog`, `auto-fullscreen`, `auto-narrow`,
  `auto-initially-hidden`, and `auto-scroll`.
  Requires Linux, Git, Python 3, tmux and `opencode` on PATH;
  `OPENCODE_BIN` selects another binary.
- Runtime fixtures isolate HOME/XDG/project directories under the OS temp directory,
  use local HTTP model fixtures, and save captures/requests in ignored `.runtime/`.
  The correction scenario approves and executes its harmless temporary Python script;
  the edit scenario approves a harmless temporary text replacement. Auto-mode
  fixtures likewise authorize only their isolated harmless commands/edits.
  These tests verify integration mechanics, not a live model's judgment accuracy.
- Documentation-only changes need reference/format review, not runtime/model tests.
- `npm pack` rebuilds via `prepack`. `.github/workflows/release.yml` runs on published
  GitHub releases (including prereleases), validates `v<package.json version>` and
  lockfile versions, runs typecheck/tests and `check:package` (two builds), then
  uploads the `.tgz` asset.
  Use `npm version X.Y.Z --no-git-tag-version` to update both manifests; release tags
  must include the workflow. CI packs with `--ignore-scripts` after verification.

## Wiring and build quirks

- `src/tui.tsx` adapts the host SDK and wires `controller.ts` lifecycle/visibility
  to `context.ts` provenance, `evidence.ts` source capture, and `reviewer.ts` transport.
  One deadline wraps context, files, HTTP requests and format corrections.
  `approval.ts` narrows the host writer to `once` in the invocation host instance,
  never the command workdir. Controller verification/reply share five seconds;
  read-only recovery has its own five-second bound, separate from model timeout.
- JSX uses Solid's **universal OpenTUI** transform in `scripts/build.mjs`, not React
  or Solid DOM. TypeScript only checks types; the build emits ESM `dist/tui.js`.
  Solid/OpenTUI/OpenCode imports remain external and are supplied by the host.
- `shell-quote` is bundled; retain `THIRD_PARTY_NOTICES.md`. The packaging check
  requires exactly `dist/tui.js`, `package.json`, `README.md`, and
  `THIRD_PARTY_NOTICES.md`. Generated `dist/` and runtime captures are ignored.
- Defaults/validation live in `src/config.ts`, evidence shapes in `src/types.ts`,
  overridable prompt text in `prompts/`, fixed contract in `contracts/`, and response validation in
  `src/reviewer.ts`; consult these rather than duplicating contracts in documentation.
- `src/prompts.ts` reads built-in Markdown in source tests; `scripts/build.mjs`
  embeds it in the bundle. Built-in prompt edits require rebuilding and restarting.
  `instructions` is an absolute custom prompt-directory path, loaded once at startup
  with per-file fallback, a 64 KiB/file cap and the configured timeout. Custom files
  need only a restart. Keep contracts outside overrides; retain `{{validationError}}`
  in correction templates. Runtime fixtures load an isolated copy of the bundle.

## Permission lifecycle and display

- Review native `bash`, shell-associated `external_directory`, and `edit` requests
  from native `edit`/`write`/`apply_patch` tools. Edit-associated external-directory
  checks stay hidden; actual edit permission provides the host-computed diffs.
  Directory access can precede execution approval: preserve each request's ID,
  exact type, scope and metadata, even for the same tool call. `always` contains
  proposed remembered patterns, not existing grants.
- Deduplicate by permission-request ID. Visibility follows the root session's first
  pending permission, including direct children; an unrelated first request must
  not show a later command's assessment. Identify directory requests before display.
- `reviewBash` and `reviewEdits` default true. Disabled kinds remain hidden ordering
  blockers but never start context/evidence/model work. `reviewBash` also gates
  shell-associated external-directory analysis; these switches do not grant access.
- `autoApprove` defaults false; `autoApproveDelaySeconds` defaults 15 and accepts
  integer 0–3600. Safe is the only rating eligible; partial evidence is not an
  additional veto. Each request needs its own full visible countdown. Cancel or
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
- Loading uses an eight-cell, 40 ms block scanner in the theme's muted color, with
  no redundant text. Honor `animations_enabled` through the public KV API and stop
  its timer on unmount. `src/appearance.ts` holds theme scopes and scanner frames;
  do not import private OpenCode theme/spinner helpers.
- Observe sidebar mounts through `sidebar_content`, using the slot's `session_id`
  and a mount token. Render the temporary full-height, 42-column overlay via `app`,
  covering the sidebar title, sections and footer without changing them. Hide it
  while native dialogs are open, and remove it on resolution/disposal. Keep its
  analysis scrollable. Respect hidden/narrow sidebar state; do not force it open,
  persist layout changes, or restore a bottom-bar fallback.
- Auto controls sit in a fixed sidebar footer outside the scrollbox. Key the
  panel by request ID, not changing view objects, to retain scrolling across
  ticks. Wait for initial Markdown highlighting and a rendered frame before
  starting. Public hit testing of the heading and stable footer interior detects
  covering native fullscreen portals; outer padding rows do not. Avoid transient
  button hit targets during submission. Do not inspect private host UI.
  Native Always/rejection internal forms are not public dialogs: document explicit
  Cancel before deliberating there. Once dispatched, approval cannot be unsent.
- Invalid configuration or review failure shows `Analysis unavailable`, never a
  fabricated rating or permission decision.

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

- Discovery is bounded literal Python/shell tokenization, not shell evaluation.
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
  `maxFiles` caps considered change entries; `maxEvidenceBytes` caps included UTF-8
  diff bytes. Omit whole diffs with reasons, retain scope, and flag partial coverage.
  Never guess operations/paths from aggregate labels or synthesize a safety rating.
- Use non-streaming Chat Completions with textual JSON evidence; no tool calling or
  provider-specific JSON mode. Instruction overrides cannot replace the fixed
  evidence/output contract: exactly `{"safe": boolean, "desc": "nonempty text"}`.
- Retry only assessment-format errors, with prior response and validation feedback,
  under the shared deadline. HTTP/network/envelope errors and response bodies over
  64 KiB terminate review; reject redirects and never display API error bodies.
- Treat command/source/quoted prompts as evidence, not reviewer instructions.
  Default Safe means bounded risk, not merely user-authorized; being outside the
  repository alone is not danger. Keep consequential effects and uncertainty visible.
- All static model guidance lives in `prompts/`, fixed contracts in `contracts/`.
  Review only the current one-time allowance, not hypothetical Allow always
  grants. Preserve exact metadata, but ignore proposed remembered patterns for
  the rating. Shared `EXTRA-CAREFUL-REVIEW-PROMPT.md` is overridable with normal
  fallback/validation, included only in auto mode, and never announces automation.
  Add no automation metadata or plugin notices to either model's conversation.
