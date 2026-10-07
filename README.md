# Opencode request reviewer

[![Tested on OpenCode 1.18.34](https://img.shields.io/badge/OpenCode-1.18.34-3178c6?style=flat-square)](https://opencode.ai) ![Linux terminal TUI](https://img.shields.io/badge/Interface-Linux%20TUI-64748b?style=flat-square) [![Auto-approval is opt-in](https://img.shields.io/badge/Auto--approval-opt--in-0f766e?style=flat-square)](#auto-approval)

Review shell commands and file changes in OpenCode's sidebar, with explanations, safety ratings, and optional one-time auto-approval.

Supports pending `bash`, shell-associated `external_directory`, and native `edit`/`write`/`apply_patch` permissions. Tested with **OpenCode 1.18.34, local Linux TUI**; other versions and clients are unverified.

## Install

**1. Download and extract** the built `.tgz` asset from [Releases](https://github.com/mightykatun/opencode-reviewer/releases), not the source archive. Replace the archive path below with your download; older releases use the previous project name.

```sh
mkdir -p opencode-reviewer
tar -xzf /path/to/downloaded-asset.tgz -C opencode-reviewer --strip-components=1
```

**2. Add the plugin** to `~/.config/opencode/tui.json` or `.opencode/tui.json`, preserving existing entries. Replace the path, API base URL, and model:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["/absolute/path/to/opencode-reviewer/dist/tui.js", {
    "baseURL": "https://api.example.com/v1",
    "model": "your-model"
  }]]
}
```

Use a local or hosted **OpenAI-compatible Chat Completions endpoint**. The plugin appends `/chat/completions`. For authentication, add `"apiKeyEnv": "OPENCODE_REVIEWER_API_KEY"` and set that environment variable before launch.

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
| `maxFiles` | `4` | Integer **1–1,000** shell source references or first edit-change entries considered for capture. |
| `maxEvidenceBytes` | `65536` | Integer **1–16,777,216** UTF-8 bytes: command + captured sources, or included edit diffs. Excludes prompts and metadata. |

Booleans must be `true`/`false`, numbers must be integers, and strings are trimmed and must be nonempty. Unknown keys, explicit `null`, and invalid supplied values are rejected even for disabled features. Omit both API-key options for unauthenticated endpoints.

Disable either review type independently; disabling both leaves all decisions manual. Oversized sources or whole diffs are omitted with reasons; an oversized command fails review. **Restart after configuration changes.**

## Using the reviewer

The sidebar shows **Safe** (green), **Unsafe** (red), or **Analysis unavailable** (orange), using the active theme. Explanations support Markdown and mouse-wheel/scrollbar scrolling. Only the assessment description is shown, not separate provider reasoning fields.

The panel follows the first pending permission in the root session or its direct children. Directory access and command execution may require separate reviews. If the sidebar is hidden, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).

**Data sent:** the current request, latest genuine root-user prompt, project context, and bounded script source or proposed edit diffs go to your reviewer endpoint **before approval**. Source capture can follow symlinks outside the project. HTTP is supported but unencrypted. Ratings reflect the supplied evidence, not a safety guarantee; dependencies and omitted content are not fully inspected.

### Auto-approval

Enable it with `"autoApprove": true`; optionally change `"autoApproveDelaySeconds": 15`.

- Each completed **Safe** assessment gets a full countdown once its explanation is visible. **Unsafe** and **Analysis unavailable** stay manual. A Safe result with incomplete evidence still qualifies.
- The fixed footer shows **Allowed in Xs** and **Cancel**. Click the countdown to allow once immediately; Cancel leaves that request manual.
- After starting, hiding or covering the panel, switching sessions, or narrowing the terminal enough to hide it cancels that request's automation for the running plugin. Returning does not restart it; scrolling does not cancel it.
- Native controls remain available. **Click Cancel before deliberating in native Allow always or rejection forms**—opening those forms alone does not cancel the timer. Once **Allowing…** begins, approval cannot be undone.
- The plugin rechecks the pending request and sends only **Allow once**. OpenCode performs the operation. Failed/uncertain submissions remain manual if still pending; writes are never automatically retried.

Auto mode adds extra-careful reviewer guidance without announcing automation or adding plugin notices to the generating agent's conversation. Built-in prompts assess **Allow once**, not hypothetical Allow always grants.

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
npm run check:package  # Reproducible build and exact package contents
```

Use `OPENCODE_BIN` to select a test binary. Build output is `dist/tui.js`; `npm pack` creates `opencode-reviewer-VERSION.tgz`. See [AGENTS.md](https://github.com/mightykatun/opencode-reviewer/blob/main/AGENTS.md) for maintainer and release details.
