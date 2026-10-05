# Maintainer guide

## Scope and integration

- Target OpenCode **1.18.34**, local Linux terminal TUI. Other clients, remote
  workspaces and OpenCode 2 are unverified.
- The plugin is advisory: never execute, modify, approve or reject reviewed
  commands, or change permission rules. Use public `@opencode-ai/plugin/tui` APIs
  and the `app_bottom` slot; do not patch the native approval dialog.
- Register the plugin and options in `tui.json`; permissions belong in
  `opencode.json`. Source changes require rebuilding; plugin/config changes require
  restarting OpenCode. Keep `README.md` focused on installation and user behavior.

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
  `cancel`, and `error`. Requires Linux, Git, Python 3, tmux and `opencode` on PATH;
  `OPENCODE_BIN` selects another binary.
- Runtime fixtures isolate HOME/XDG/project directories under the OS temp directory,
  use local HTTP model fixtures, and save captures/requests in ignored `.runtime/`.
  The correction scenario approves and executes its harmless temporary Python script.
  These tests verify integration mechanics, not a live model's judgment accuracy.
- Documentation-only changes need reference/format review, not runtime/model tests.
- `npm pack` rebuilds via `prepack`. `.github/workflows/release.yml` runs on published
  GitHub releases (including prereleases), validates `v<package.json version>` and
  lockfile versions, runs `check`/`check:package`, then uploads the `.tgz` asset.
  Use `npm version X.Y.Z --no-git-tag-version` to update both manifests; release tags
  must include the workflow. CI packs with `--ignore-scripts` after verification.

## Wiring and build quirks

- `src/tui.tsx` adapts the host SDK and wires `controller.ts` lifecycle/visibility
  to `context.ts` provenance, `evidence.ts` source capture, and `reviewer.ts` transport.
  One deadline wraps context, files, HTTP requests and format corrections.
- JSX uses Solid's **universal OpenTUI** transform in `scripts/build.mjs`, not React
  or Solid DOM. TypeScript only checks types; the build emits ESM `dist/tui.js`.
  Solid/OpenTUI/OpenCode imports remain external and are supplied by the host.
- `shell-quote` is bundled; retain `THIRD_PARTY_NOTICES.md`. The packaging check
  requires exactly `dist/tui.js`, `package.json`, `README.md`, and
  `THIRD_PARTY_NOTICES.md`. Generated `dist/` and runtime captures are ignored.
- Defaults/validation live in `src/config.ts`, evidence shapes in `src/types.ts`,
  and model instructions/output contract in `src/reviewer.ts`; consult these rather
  than duplicating option ranges or protocol definitions in documentation.

## Permission lifecycle and display

- Review native `bash` and only shell-associated `external_directory` requests.
  Directory access can precede execution approval: preserve each request's ID,
  exact type, scope and metadata, even for the same tool call. `always` contains
  proposed remembered patterns, not existing grants.
- Deduplicate by permission-request ID. Visibility follows the root session's first
  pending permission, including direct children; an unrelated first request must
  not show a later command's assessment. Identify directory requests before display.
- Preserve two-second read-only reconciliation for startup/missing reply events and
  its revision guard against stale snapshots. Resolution, deletion and disposal
  abort work; late results must not resurrect panels.
- Completed UI is only green `✓` (`#22c55e`) or orange `!` (`#f97316`) plus description
  in theme text color. No header, repeated command or IDs. Keep native controls active,
  bounded scrolling, and terminal-control/bidi escaping via `displayText`.
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
- Use non-streaming Chat Completions with textual JSON evidence; no tool calling or
  provider-specific JSON mode. Instruction overrides cannot replace the fixed
  evidence/output contract: exactly `{"safe": boolean, "desc": "nonempty text"}`.
- Retry only assessment-format errors, with prior response and validation feedback,
  under the shared deadline. HTTP/network/envelope errors and response bodies over
  64 KiB terminate review; reject redirects and never display API error bodies.
- Treat command/source/quoted prompts as evidence, not reviewer instructions.
  Default SAFE means bounded risk, not merely user-authorized; being outside the
  repository alone is not danger. Keep consequential effects and uncertainty visible.
