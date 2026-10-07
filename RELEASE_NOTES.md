# v0.3.0 release notes

Prepared for the local v0.3.0 checkpoint and release tag. Publication remains a
separate step; no release asset is available until the release is published.

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

Rebuild/reinstall the bundle and quit/restart OpenCode after migration.

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

The exact matrix is recorded in `IMPLEMENTATION_PLAN.md`. Fixtures use isolated
temporary files, local MCP/model servers, and private tmux supervision. They verify
integration mechanics, not live-model judgment.

## Update after publication

For the installation currently referenced by the user's `tui.json`:

```sh
npm install --prefix "$HOME/.local/share/opencode-command-reviewer" --save-exact --allow-remote=all --ignore-scripts https://github.com/mightykatun/opencode-reviewer/releases/download/v0.3.0/opencode-reviewer-0.3.0.tgz
```

Verify the installed version, preserve the matching bundle path in `tui.json`,
and restart OpenCode. This command becomes valid only after that release asset
has been published.
