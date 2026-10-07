# Opencode request reviewer

Review pending OpenCode permissions in the sidebar, with explanations, safety ratings, and optional one-time auto-approval.

Reviews native shell execution and edit/write/apply-patch changes by default. Independent opt-in switches add **MCP operations**, **custom-tool permission checks**, and **external-directory access from any linked tool**. Tested with **OpenCode 1.18.34, local Linux TUI**; other versions and clients are unverified.

## Install

**1. Download and extract** the built `.tgz` asset from [Releases](https://github.com/mightykatun/opencode-reviewer/releases), not the source archive. Replace the archive path below with your download; older releases use the previous project name.

```sh
mkdir -p opencode-reviewer
tar -xzf /path/to/downloaded-asset.tgz -C opencode-reviewer --strip-components=1
```

For an npm-managed installation/update, use the **same prefix as the bundle registered in `tui.json`**. For example, an existing installation under `~/.local/share/opencode-command-reviewer` can be updated from any working directory with:

```sh
VERSION=X.Y.Z
npm install --prefix "$HOME/.local/share/opencode-command-reviewer" --save-exact --allow-remote=all --ignore-scripts "https://github.com/mightykatun/opencode-reviewer/releases/download/v${VERSION}/opencode-reviewer-${VERSION}.tgz"
npm ls --prefix "$HOME/.local/share/opencode-command-reviewer" opencode-reviewer --depth=0
```

Replace `X.Y.Z` with a published release version. Its bundle is `~/.local/share/opencode-command-reviewer/node_modules/opencode-reviewer/dist/tui.js`; use the expanded absolute path in `tui.json`. The remote-download flag is required by npm 12. The archive is prebuilt and needs no install scripts. Installing into the source checkout instead updates a different copy.

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
        "reviewMcp": true,
        "reviewCustomTools": true,
        "reviewExternalDirectories": true,
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

This example explicitly enables all five review categories; the three new categories default to **off** when omitted. Use a local or hosted **OpenAI-compatible Chat Completions endpoint**. The plugin appends `/chat/completions`. `apiKey` takes precedence over `apiKeyEnv`; remove `apiKey` to use the environment variable, and set it before launch. Remove both for an unauthenticated endpoint. Remove `instructions` to use built-in prompts, or point it at an existing custom prompt directory.

**Restart OpenCode.** The release bundle needs no dependency installation. The plugin reviews requests that OpenCode asks about; configure permission rules in `opencode.json`, for example `"permission": { "bash": "ask", "edit": "ask" }`.

**Upgrading from `opencode-command-reviewer`:** replace the old plugin entry rather than adding a second one. The new plugin ID is `opencode-reviewer`; reapply any saved enable/disable preference if needed. Use documentation matching your installed release.

**Migrating from v0.2.x:** set `reviewExternalDirectories: true` to retain shell-associated directory reviews and enable the additional directory origins. `reviewBash` now controls shell execution only. MCP and custom-tool reviews require their own switches. Remove any `*-REVIEW-CORRECTION.md` files from your custom prompt directory: correction is now a fixed contract, and legacy overrides produce an explicit configuration error. Restart OpenCode after updating the bundle and configuration.

## Configuration

Put options beside the plugin path in `tui.json`. Only **`baseURL` and `model`** are required. Omitted options use these defaults:

| Option | Default | Meaning / accepted values |
| --- | --- | --- |
| `baseURL` | required | HTTP(S) API base URL, without embedded credentials, query, or fragment. Trailing slashes are removed. |
| `model` | required | Nonempty model identifier accepted by your endpoint. |
| `apiKey` | omitted | Nonempty Bearer API key; takes precedence over `apiKeyEnv`. |
| `apiKeyEnv` | omitted | Environment-variable name, e.g. `OPENCODE_REVIEWER_API_KEY`. Letters, digits, underscores; cannot start with a digit. Its value must be nonempty unless `apiKey` is supplied. |
| `instructions` | built-in prompts | Absolute custom prompt-directory path; no relative paths, `~/`, or inline instructions. See [Custom prompts](#custom-prompts). |
| `reviewBash` | `true` | Review native shell execution. Directory access has its own switch. |
| `reviewEdits` | `true` | Review native edit, write, and apply-patch requests. |
| `reviewMcp` | `false` | Review identifiable MCP tool and resource permissions, including MCP resource requests using `read`. |
| `reviewCustomTools` | `false` | Review permission checks raised by identifiable registered custom/plugin tools. |
| `reviewExternalDirectories` | `false` | Review directory-access requests from shell, read, search, edit, MCP, or custom tools independently of their operation-review switches. |
| `autoApprove` | `false` | Allow Safe requests once after a visible countdown. |
| `autoApproveDelaySeconds` | `15` | Integer **0–3600** seconds. `0` approves once visible and verified. |
| `formatRetries` | `1` | Integer **0–100** additional attempts to correct invalid assessment JSON; no HTTP/network retries. |
| `timeoutMs` | `30000` | Integer **1–3,600,000** ms for context, evidence, and review/corrections together; separately bounds startup prompt loading. |
| `maxFiles` | `6` | Integer **1–1,000** distinct candidate files per review, shared counting rules for shell and edit tools. Repeated paths and resolved symlink aliases count once; unavailable candidates also count. |
| `maxEvidenceBytes` | `131072` | Integer **1–16,777,216** UTF-8 bytes. Shell: command + captured files. Edit: included diffs. MCP/custom/directory: variable operation JSON, including action arguments, permission scope/metadata, and optional definition text/schema. Common user/session context and generated notices are outside this budget. |

Booleans must be `true`/`false`, numbers must be integers, and strings are trimmed and must be nonempty. Unknown keys, explicit `null`, and invalid supplied values are rejected even for disabled features. Omit both API-key options for unauthenticated endpoints.

Disable review categories independently; disabling all five leaves all decisions manual. Disabled kinds skip evidence/model work, although identifying an unknown tool's category may require a minimal host lookup. Oversized sources or whole diffs are omitted with reasons; an oversized mandatory command, tool payload, or permission scope fails review. Optional definitions/metadata can be omitted explicitly. New JSON payloads are bounded to 32 nesting levels and 16,384 values. **Restart after configuration changes.**

Shell evidence includes literal Python/shell sources and supported `cat`/`head` file operands. Each permission gets a fresh file/byte budget; repeated edit entries retain their separate diffs. Omitted files carry `[!] File "path" not included in context.`; omitted edits also carry `[Δ] "path": +N −M lines` when a valid diff or host counts provide the numbers. Paths are JSON-quoted, and unknown counts are never invented. No omitted file content is sent.

### Coverage and evidence limits

- **MCP:** uses the pending tool's exact recorded arguments and scope. Registry membership and connected-server identity are cross-checked; ambiguous sanitized names or collisions remain manual. OpenCode 1.18.34 does not expose a complete MCP definition catalog through the public SDK, so unavailable descriptions/schemas are reported explicitly. Resource server names and URIs are matched verbatim, including whitespace. Resource URIs are identifiers, not assumed local paths. The reviewer does not call MCP tools or fetch their resource contents.
- **Custom tools:** uses public registry identity, available definition, arguments, and the exact permission raised. A custom tool may request `bash`, `edit`, or an arbitrary permission name; its tool identity determines the evidence format. Earlier custom-tool code may already have run before its permission check. Tools that never ask permission cannot be reviewed by this plugin.
- **Directory access:** uses host-declared scope and associated operation context without reading target contents or canonicalizing targets. Native patch summaries retain add/update/delete/move operations, declared paths and move destinations. Edit bodies are omitted and coverage is marked partial; a subsequent edit request supplies its own diffs. Patch-header scanning is bounded to 16 MiB of input and 65,536 scanned lines, with summaries subject to the operation JSON budget. Missing, oversized or incomplete mandatory summaries fail analysis rather than silently dropping operations. Approving directory access can resume an operation immediately when other permissions are already allowed, so another prompt is not guaranteed.
- **Other native permissions:** standalone native reads, searches, web requests, subagent launches and similar requests remain manual and unreviewed. Experimental code-mode MCP calls whose originating tool is `execute` also remain outside this classification. Unsupported or unidentified requests still block later panels in native order.

The plugin sees **pending permission requests**, not every invocation. Existing `allow` rules or remembered grants may bypass the approval stage. The review switches do not change native permission rules.

### Missing files and timeouts

Missing/unreadable files normally become evidence omissions, not a failed review. SSH/container commands are not executed to obtain remote sources. Network-mounted local paths can still stall filesystem operations.

Optional filesystem enrichment gets at most **5 seconds and one third of the remaining review time**, shared by the request. Path lookups are bounded to **500 ms** and file captures to **1.5 seconds**, within that shared budget. At most two evidence I/O transactions remain outstanding per plugin instance; busy probes are omitted rather than queued indefinitely. A timed-out OS operation may finish later, with its handle still owned for cleanup. These limits cannot force the kernel to cancel blocked I/O.

Stalled optional canonicalization does not discard host-provided edit diffs. Unresolved aliases count conservatively as separate files, with a limitation. Optional conversation/project lookups are also bounded and finish before filesystem enrichment starts; missing context remains explicit. The overall `timeoutMs` still covers all preparation, reviewer responses, and format corrections. Timeout messages distinguish the active stage. The reviewer decides whether incomplete evidence supports a rating; the plugin does not manufacture one.

## Using the reviewer

The sidebar shows **Safe** (green), **Unsafe** (red), or **Analysis unavailable** (orange), using the active theme. Explanations support Markdown and mouse-wheel/scrollbar scrolling. Only the assessment description is shown, not separate provider reasoning fields.

A dimmed footer shows three separate lines when usage and pricing are available:

```text
tokens in/out: 1000/100
cost: $0.0045
lifetime: $0.1234
```

Report totals include format-correction requests. Cost is an estimate from OpenCode's configured model catalog, matched by endpoint and model, including cache and context-tier rates. Unknown request pricing omits its cost line; valid token counts can still accompany recorded lifetime totals. Missing/invalid usage in any attempt omits that report's stats. These are reviewer-request statistics.

**Lifetime usage** is saved automatically across projects and restarts. Its inline line appears **only alongside valid current-request usage**, including token-only reports with unknown request pricing. It stays hidden while loading, on review failure, or when any format attempt lacks valid usage. Open **Reviewer: Lifetime usage** from the command palette (`Ctrl+P`) for cumulative tokens, request count, and pricing coverage, even with no review open. Accounting still counts each completed endpoint response with valid usage, including format retries and invalid assessments whose inline stats are hidden. Canceled requests and responses without usage are excluded. Unknown pricing is never treated as free; partially priced totals are labeled. Earlier versions' usage cannot be recovered.

Totals live in `opencode-reviewer/usage-v1/` under OpenCode's state directory (normally `~/.local/state/opencode/`). Concurrent instances save separate atomic snapshots containing only counters, estimated cost and the first-recorded timestamp. Totals refresh on locally recorded usage and when opening the stats command. Persistence failures leave reviews usable and show **lifetime: usage unavailable** alongside valid request stats, or in the palette dialog; stored data is never silently reset. There is no `oc-stats` or native session-accounting integration.

The panel follows the first pending permission in the root session or its direct children. Directory access and command execution may require separate reviews. If the sidebar is hidden, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).

**Data sent:** the current request, latest genuine root-user prompt, project context, and applicable bounded file snapshots, proposed diffs, tool arguments, permission metadata and available definitions go to your reviewer endpoint **before approval**. Tool arguments can themselves contain private data. MCP connection credentials, host environment/configuration and unrelated messages are not copied into evidence. `cat`/`head` operands supply full bounded snapshots, not command output. Shell file capture can follow symlinks outside the project. HTTP is supported but unencrypted. Ratings reflect the supplied evidence, not a safety guarantee; implementations, dependencies, remote contents and omitted content are not fully inspected.

### Auto-approval

Enable it with `"autoApprove": true`; optionally change `"autoApproveDelaySeconds": 15`.

- Each completed **Safe** assessment gets a full countdown once its explanation is visible. **Unsafe** and **Analysis unavailable** stay manual. A Safe result with incomplete evidence still qualifies.
- The fixed footer shows **Allowed in Xs** and **Cancel**. Click the countdown to allow once immediately; Cancel leaves that request manual.
- After starting, hiding or covering the panel, switching sessions, or narrowing the terminal enough to hide it cancels that request's automation for the running plugin. Returning does not restart it; scrolling does not cancel it.
- Native controls remain available. **Click Cancel before deliberating in native Allow always or rejection forms**. Opening those forms alone does not cancel the timer. Once **Allowing…** begins, approval cannot be undone.
- The plugin rechecks the pending request and sends only **Allow once**. OpenCode performs the operation. Failed/uncertain submissions remain manual if still pending; writes are never automatically retried.

Auto mode applies to every explicitly enabled review category and adds extra-careful reviewer guidance without announcing automation or adding plugin notices to the generating agent's conversation. Built-in prompts assess **Allow once**, not hypothetical Allow always grants. Bash execution reports end with brief guidance to prefer Allow once because only the current request was reviewed; all other categories omit that closing line.

## Custom prompts

Set `instructions` to an absolute directory containing any of these files:

| Filename | Purpose |
| --- | --- |
| `PERMISSION-REVIEW-PROMPT.md` | Shell assessment |
| `EDIT-REVIEW-PROMPT.md` | Edit assessment |
| `MCP-REVIEW-PROMPT.md` | MCP tool/resource assessment |
| `CUSTOM-TOOL-REVIEW-PROMPT.md` | Custom/plugin-tool permission assessment |
| `EXTERNAL-DIRECTORY-REVIEW-PROMPT.md` | Directory-access assessment |
| `EXTRA-CAREFUL-REVIEW-PROMPT.md` | Shared extra guidance, included only in auto mode |

Copy templates from this repository's `prompts/` directory for your installed version. Missing files fall back individually to built-ins. Supplied files must be readable, stable, nonempty regular UTF-8 text, without NUL bytes, up to **64 KiB each**. Invalid files fail configuration, including when auto mode is off.

The evidence/output and format-correction contracts live in `contracts/` and cannot be overridden. Custom filenames ending in `-CONTRACT.md` or `-REVIEW-CORRECTION.md` are rejected. Remove old correction overrides when upgrading; the fixed correction preserves the selected category's guidance. Output remains exactly `{"safe": boolean, "desc": "nonempty text"}`.

**Restart after changing custom prompts.** Editing built-in source prompts also requires rebuilding. Existing overrides replace the named built-ins; update them to adopt new guidance. Older inline `instructions` must be moved into the appropriate prompt file.

## Development

From the repository root, with **Node.js 22+** and npm:

```sh
npm ci --ignore-scripts
npm run check          # Typecheck, tests, build
npm run test:runtime   # Linux; Git, Python 3, tmux, OpenCode on PATH
npm run test:runtime-cleanup # Fast tmux interruption/parallel-isolation checks; no model
npm run test:runtime-permissions # Focused MCP/custom/directory and stats fixtures
npm run check:package  # Reproducible build and exact package contents
```

Use `OPENCODE_BIN` to select a test binary. Build output is `dist/tui.js`; `npm pack` creates `opencode-reviewer-VERSION.tgz`. See [AGENTS.md](https://github.com/mightykatun/opencode-reviewer/blob/main/AGENTS.md) for maintainer and release details.
