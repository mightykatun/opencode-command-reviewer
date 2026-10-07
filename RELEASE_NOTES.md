# v0.4.1: automatic tag-driven releases

- Release automation now starts on a pushed `v*` tag, matching Speedometer's flow.
  It verifies the tagged version, builds the package, creates the GitHub Release
  automatically and publishes to npm. Manual dispatch supports an existing tag
  from the default branch. Semantic prereleases use GitHub prerelease and npm `next`.
- Release reruns reuse existing GitHub releases and retain the npm archive-integrity
  check. Publishing a GitHub Release manually no longer triggers the workflow.

# v0.4.0: npm distribution, streaming reviews and conversation controls

First npm release: register `opencode-reviewer@0.4.0` with its options in
`tui.json`. OpenCode installs the prebuilt package. Replace any old file-path plugin
entry, preserving its options and state directories, then restart OpenCode.
Published GitHub releases now also publish the verified archive to npm; prereleases
use the `next` dist-tag. The existing v0.3.0 tag was a local unpublished checkpoint
and is preserved without rewriting it.

This release includes the v0.3.0 checkpoint's MCP/custom/directory reviews and all
changes below. See README for every configuration option and the v0.2.x migration.

- Target OpenCode **1.18.35**, local Linux TUI. Optional `stream: true` enables SSE
  transport with early provisional ratings and progressive Markdown; the default
  remains `false`. Pending reviews show **Evaluating** or **Retrying**. Only a
  completed, validated and rendered Safe report can start auto-approval.
- Add local `/reviewer-enable` and `/reviewer-disable` commands and matching palette
  actions for the root conversation and descendants. Mode persists for resume;
  disabling aborts review work and countdowns while native permissions stay pending.
  Re-enabling reviews pending requests afresh without reviving canceled countdowns
  in the running plugin. Native approval controls retain their meanings.
- Use OpenRouter-reported `usage.cost` at its exact endpoint; generic endpoints
  retain catalog estimates. Record received usage once per attempt, including
  interrupted/unsuccessful reviews, with independent token and cost coverage.
  Unreported charges remain unknown. New snapshots use `usage-v2`; legacy `usage-v1`
  history is read without rewriting its original estimates. Mode uses `session-mode-v1`.
- Add bounded SSE/assessment parsers, content-free opt-in diagnostic observers and
  focused streaming, session-mode and HTTP-reuse fixtures. Final checks passed:
  typecheck, 483 unit tests, five measurement tests, four cleanup tests, 21 focused
  real-TUI combinations and reproducible five-file packaging. Exact runs are
  recorded in `IMPLEMENTATION_PLAN.md`. These local fixtures do not establish
  live-provider performance, NFS/SSHFS behavior or a full legacy runtime-matrix rerun.

Update the package specifier and restart OpenCode. Existing configurations keep non-streaming
behavior; add `"stream": true` to opt in. Preserve both usage-history directories.
Conversation-mode save failures explicitly report local-only application and
possible use of the previous setting on resume.

# v0.3.0 checkpoint (unpublished)

Historical local checkpoint. Its features are distributed in v0.4.0.

## Changes

- Independent opt-in reviews for MCP tool/resource permissions, custom-tool
  permission checks, and external-directory access from all linked tool origins.
- Dedicated customizable assessment prompts for each new category. MCP resource
  operations using `read` and custom tools using native-like permission names
  are classified by their originating tool and host metadata.
- One fixed format-correction contract under `contracts/`, shared across review
  categories. The strict two-field assessment format remains unchanged.
- Bounded optional filesystem enrichment with explicit omissions for stalled
  paths/files, conservative alias accounting, and owned late cleanup. Host edit
  diffs remain usable when optional canonicalization fails.
- Inline lifetime statistics appear only with valid current-request usage.
  Lifetime accounting and the palette dialog remain independent.
- Native patch-directory reviews retain bounded operation/path/move summaries and
  mark omitted edit bodies as partial, including when directory approval is the
  only remaining gate. Mandatory summaries must fit the evidence budget.
- MCP resource identities preserve whitespace exactly as the pinned host does.
  Optional conversation waits finish before the filesystem budget starts, so
  stalled history reads do not prevent healthy source capture.

## Migration from v0.2.x

The new switches default to false:

```json
{
  "reviewMcp": true,
  "reviewCustomTools": true,
  "reviewExternalDirectories": true
}
```

Add the switches for the categories you want. In particular, directory reviews
now require `reviewExternalDirectories: true`, including shell directory checks
previously controlled by `reviewBash`. Global auto approval applies to enabled
categories only.

Remove custom `*-REVIEW-CORRECTION.md` files. Correction is fixed in the plugin;
legacy overrides produce an explicit configuration error. Shell/edit assessment
override filenames remain supported. New assessment templates are:

- `MCP-REVIEW-PROMPT.md`
- `CUSTOM-TOOL-REVIEW-PROMPT.md`
- `EXTERNAL-DIRECTORY-REVIEW-PROMPT.md`

Use the current npm package entry and quit/restart OpenCode after migration.

## Limitations

Only pending permission requests are reviewed. Existing allowed operations and
custom tools that do not ask permission are outside this integration. Ambiguous
tool identities/collisions remain manual. MCP definitions unavailable through
OpenCode 1.18.34's public SDK are explicitly marked unavailable. Remote file/resource
contents are not fetched to supply missing evidence. Directory access may resume
an operation without another prompt. Custom tools may have run earlier code before
their permission check.

File timeouts cannot force the OS to cancel blocked I/O. Outstanding evidence
transactions are capped and retain cleanup ownership; they do not generate
unbounded follow-up work. Real remote-mount behavior has not been claimed as
verified by injected filesystem-stall tests.

## Verification

- Typecheck and 348 unit tests passed.
- Four interruption/startup-race/parallel-isolation cleanup tests passed.
- Thirty-three distinct focused native TUI scenario/flag combinations passed during implementation, covering
  new kinds, corrections, disabled modes, cancellation, Unsafe/error behavior,
  separate directory/operation countdowns, statistics, and existing native flows.
- Six affected combinations passed during the follow-up audit fixes, including
  directory-only patch deletion with format correction, verbatim whitespace MCP
  resource identity, separate directory/edit stages, stalled files and immediate
  approval. The full legacy runtime suite was not rerun.
- The stalled-file TUI fixture kept the palette responsive and delivered a bounded
  omission using an injected evidence open. It does not patch host filesystem
  globals or claim live NFS/SSHFS verification.
- Reproducible packaging passed with exactly five files. Bundle SHA-256:
  `c884fb8b956add95ed1066a608cbcb5211ca144e75c51b2a321d457aedebe866`.

Fixtures used isolated temporary files, local MCP/model servers, and private tmux
supervision. They verified integration mechanics, not live-model judgment.
