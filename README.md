# Opencode request reviewer

Review shell commands and file changes in OpenCode's sidebar, with explanations, safety ratings, and optional one-time auto-approval.

Supports pending `bash`, shell-associated `external_directory`, and native `edit`/`write`/`apply_patch` permissions. Tested with **OpenCode 1.18.34, local Linux TUI**; other versions and clients are unverified.

## Install

**1. Download and extract** the built `.tgz` asset from [Releases](https://github.com/mightykatun/opencode-reviewer/releases), not the source archive. Replace the archive path below with your download; older releases use the previous project name.

```sh
mkdir -p opencode-reviewer
tar -xzf /path/to/downloaded-asset.tgz -C opencode-reviewer --strip-components=1
```

**2. Add the plugin** to `~/.config/opencode/tui.json` or `.opencode/tui.json`, preserving existing entries. This example includes every option. Replace the placeholder paths, endpoint, model and authentication values; remove optional settings you do not use:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "/absolute/path/to/opencode-reviewer/dist/tui.js",
      {
        "baseURL": "https://api.example.com/v1",
        "model": "your-model",
        "apiKey": "your-api-key",
        "apiKeyEnv": "OPENCODE_REVIEWER_API_KEY",
        "instructions": "/absolute/path/to/reviewer-prompts",
        "reviewBash": true,
        "reviewEdits": true,
        "autoApprove": false,
        "autoApproveDelaySeconds": 15,
        "formatRetries": 1,
        "timeoutMs": 30000,
        "maxFiles": 6,
        "maxEvidenceBytes": 131072
      }
    ]
  ]
}
```

Use a local or hosted **OpenAI-compatible Chat Completions endpoint**. The plugin appends `/chat/completions`. `apiKey` takes precedence over `apiKeyEnv`; remove `apiKey` to use the environment variable, and set it before launch. Remove both for an unauthenticated endpoint. Remove `instructions` to use built-in prompts, or point it at an existing custom prompt directory.

**Restart OpenCode.** The release bundle needs no dependency installation. The plugin reviews requests that OpenCode asks about; configure permission rules in `opencode.json`, for example `"permission": { "bash": "ask", "edit": "ask" }`.

**Upgrading from `opencode-command-reviewer`:** replace the old plugin entry rather than adding a second one. The new plugin ID is `opencode-reviewer`; reapply any saved enable/disable preference if needed. Use documentation matching your installed release.

## Configuration

Put options beside the plugin path in `tui.json`. Only **`baseURL` and `model`** are required. Omitted options use these defaults:

| Option | Default | Meaning / accepted values |
| --- | --- | --- |
| `baseURL` | required | HTTP(S) API base URL, without embedded credentials, query, or fragment. Trailing slashes are removed. |
| `model` | required | Nonempty model identifier accepted by your endpoint. |
| `apiKey` | omitted | Nonempty Bearer API key; takes precedence over `apiKeyEnv`. |
| `apiKeyEnv` | omitted | Environment-variable name, e.g. `OPENCODE_REVIEWER_API_KEY`. Letters, digits, underscores; cannot start with a digit. Its value must be nonempty unless `apiKey` is supplied. |
| `instructions` | built-in prompts | Absolute custom prompt-directory path; no relative paths, `~/`, or inline instructions. See [Custom prompts](#custom-prompts). |
| `reviewBash` | `true` | Review shell execution and shell-associated external-directory requests. |
| `reviewEdits` | `true` | Review native edit, write, and apply-patch requests. |
| `autoApprove` | `false` | Allow Safe requests once after a visible countdown. |
| `autoApproveDelaySeconds` | `15` | Integer **0–3600** seconds. `0` approves once visible and verified. |
| `formatRetries` | `1` | Integer **0–100** additional attempts to correct invalid assessment JSON; no HTTP/network retries. |
| `timeoutMs` | `30000` | Integer **1–3,600,000** ms for context, evidence, and review/corrections together; separately bounds startup prompt loading. |
| `maxFiles` | `6` | Integer **1–1,000** distinct candidate files per review, shared counting rules for shell and edit tools. Repeated paths and resolved symlink aliases count once; unavailable candidates also count. |
| `maxEvidenceBytes` | `131072` | Integer **1–16,777,216** UTF-8 bytes: command + captured files, or included edit diffs. Excludes prompts and metadata. |

Booleans must be `true`/`false`, numbers must be integers, and strings are trimmed and must be nonempty. Unknown keys, explicit `null`, and invalid supplied values are rejected even for disabled features. Omit both API-key options for unauthenticated endpoints.

Disable either review type independently; disabling both leaves all decisions manual. Oversized sources or whole diffs are omitted with reasons; an oversized command fails review. **Restart after configuration changes.**

Shell evidence includes literal Python/shell sources and supported `cat`/`head` file operands. Each permission gets a fresh file/byte budget; repeated edit entries retain their separate diffs. Omitted files carry `[!] File "path" not included in context.`; omitted edits also carry `[Δ] "path": +N −M lines` when a valid diff or host counts provide the numbers. Paths are JSON-quoted, and unknown counts are never invented. No omitted file content is sent.

## Using the reviewer

The sidebar shows **Safe** (green), **Unsafe** (red), or **Analysis unavailable** (orange), using the active theme. Explanations support Markdown and mouse-wheel/scrollbar scrolling. Only the assessment description is shown, not separate provider reasoning fields.

A dimmed footer shows three separate lines when usage and pricing are available:

```text
tokens in/out: 1000/100
cost: $0.0045
lifetime: $0.1234
```

Report totals include format-correction requests. Cost is an estimate from OpenCode's configured model catalog, matched by endpoint and model, including cache and context-tier rates. Unknown pricing shows token counts only; missing/invalid usage in any attempt omits that report's stats. These are reviewer-request statistics.

**Lifetime usage** is saved automatically across projects and restarts. The last dimmed line shows recorded lifetime cost; open **Reviewer: Lifetime usage** from the command palette (`Ctrl+P`) for cumulative tokens, request count, and pricing coverage, even with no review open. It counts each completed endpoint response with valid usage, including format retries and responses whose assessment is invalid. Canceled requests and responses without usage are excluded. Unknown pricing is never treated as free; partially priced totals are labeled. Earlier versions' usage cannot be recovered.

Totals live in `opencode-reviewer/usage-v1/` under OpenCode's state directory (normally `~/.local/state/opencode/`). Concurrent instances save separate atomic snapshots containing only counters, estimated cost and the first-recorded timestamp. Totals refresh on locally recorded usage and when opening the stats command. Persistence failures leave reviews usable and show **lifetime: usage unavailable**; stored data is never silently reset. There is no `oc-stats` or native session-accounting integration.

The panel follows the first pending permission in the root session or its direct children. Directory access and command execution may require separate reviews. If the sidebar is hidden, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).

**Data sent:** the current request, latest genuine root-user prompt, project context, and bounded file snapshots or proposed edit diffs go to your reviewer endpoint **before approval**. `cat`/`head` operands supply full bounded snapshots, not command output. File capture can follow symlinks outside the project. HTTP is supported but unencrypted. Ratings reflect the supplied evidence, not a safety guarantee; dependencies and omitted content are not fully inspected.

### Auto-approval

Enable it with `"autoApprove": true`; optionally change `"autoApproveDelaySeconds": 15`.

- Each completed **Safe** assessment gets a full countdown once its explanation is visible. **Unsafe** and **Analysis unavailable** stay manual. A Safe result with incomplete evidence still qualifies.
- The fixed footer shows **Allowed in Xs** and **Cancel**. Click the countdown to allow once immediately; Cancel leaves that request manual.
- After starting, hiding or covering the panel, switching sessions, or narrowing the terminal enough to hide it cancels that request's automation for the running plugin. Returning does not restart it; scrolling does not cancel it.
- Native controls remain available. **Click Cancel before deliberating in native Allow always or rejection forms**. Opening those forms alone does not cancel the timer. Once **Allowing…** begins, approval cannot be undone.
- The plugin rechecks the pending request and sends only **Allow once**. OpenCode performs the operation. Failed/uncertain submissions remain manual if still pending; writes are never automatically retried.

Auto mode adds extra-careful reviewer guidance without announcing automation or adding plugin notices to the generating agent's conversation. Built-in prompts assess **Allow once**, not hypothetical Allow always grants. Bash execution reports end with brief guidance to prefer Allow once because only the current request was reviewed; edit and directory-access reports omit that closing line.

## Custom prompts

Set `instructions` to an absolute directory containing any of these files:

| Filename | Purpose |
| --- | --- |
| `PERMISSION-REVIEW-PROMPT.md` | Shell assessment |
| `PERMISSION-REVIEW-CORRECTION.md` | Shell format correction |
| `EDIT-REVIEW-PROMPT.md` | Edit assessment |
| `EDIT-REVIEW-CORRECTION.md` | Edit format correction |
| `EXTRA-CAREFUL-REVIEW-PROMPT.md` | Shared extra guidance, included only in auto mode |

Copy templates from this repository's `prompts/` directory for your installed version. Missing files fall back individually to built-ins. Supplied files must be readable, stable, nonempty regular UTF-8 text, without NUL bytes, up to **64 KiB each**. Invalid files fail configuration, including when auto mode is off.

Correction templates must keep `{{validationError}}`. Fixed contracts cannot be overridden: custom filenames ending in `-CONTRACT.md` are rejected. Output remains exactly `{"safe": boolean, "desc": "nonempty text"}`.

**Restart after changing custom prompts.** Editing built-in source prompts also requires rebuilding. Existing overrides replace the named built-ins; update them to adopt new guidance. Older inline `instructions` must be moved into the appropriate prompt file.

## Development

From the repository root, with **Node.js 22+** and npm:

```sh
npm ci --ignore-scripts
npm run check          # Typecheck, tests, build
npm run test:runtime   # Linux; Git, Python 3, tmux, OpenCode on PATH
npm run test:runtime-cleanup # Fast tmux interruption/parallel-isolation checks; no model
npm run check:package  # Reproducible build and exact package contents
```

Use `OPENCODE_BIN` to select a test binary. Build output is `dist/tui.js`; `npm pack` creates `opencode-reviewer-VERSION.tgz`. See [AGENTS.md](https://github.com/mightykatun/opencode-reviewer/blob/main/AGENTS.md) for maintainer and release details.
