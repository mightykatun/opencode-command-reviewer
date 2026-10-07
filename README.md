# Opencode request reviewer

Review pending OpenCode permissions in the sidebar, with explanations, safety ratings, and optional one-time auto-approval.

Reviews native shell execution and edit/write/apply-patch changes by default. Independent opt-in switches add **MCP operations**, **custom-tool permission checks**, and **external-directory access from any linked tool**. Targets **OpenCode 1.18.35, local Linux TUI**, with local-fixture verification; other versions and clients are unverified.

## Install

Add the [npm package](https://www.npmjs.com/package/opencode-reviewer) to `~/.config/opencode/tui.json` or `.opencode/tui.json`, preserving existing entries. OpenCode downloads the prebuilt package and loads its TUI entry automatically. No archive extraction, separate `npm install`, or absolute plugin file path is needed.

Minimal configuration:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    ["opencode-reviewer@0.4.0", {
      "baseURL": "https://api.example.com/v1",
      "model": "your-model",
      "apiKeyEnv": "OPENCODE_REVIEWER_API_KEY"
    }]
  ]
}
```

Set `OPENCODE_REVIEWER_API_KEY` in your environment before launching OpenCode. Use your endpoint's model identifier. For OpenRouter, set `baseURL` to `https://openrouter.ai/api/v1`.

The following expanded example shows **every configuration option**, with all five review categories explicitly enabled. Replace endpoint/model/authentication values and the optional custom prompt-directory path; omit options you do not use:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-reviewer@0.4.0",
      {
        "baseURL": "https://api.example.com/v1",
        "model": "your-model",
        "apiKey": "your-api-key",
        "apiKeyEnv": "OPENCODE_REVIEWER_API_KEY",
        "instructions": "/absolute/path/to/reviewer-prompts",
        "stream": false,
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

**Restart OpenCode.** The plugin reviews requests that OpenCode asks about; configure permission rules in `opencode.json`, for example `"permission": { "bash": "ask", "edit": "ask" }`.

### Updates and migration to npm

To update, replace `opencode-reviewer@0.4.0` with the desired published version and restart OpenCode. Exact versions keep upgrades intentional; see [npm versions](https://www.npmjs.com/package/opencode-reviewer?activeTab=versions) and [release notes](https://github.com/mightykatun/opencode-reviewer/releases).

If you previously registered an extracted bundle, a `file://` URL, or a manually installed `dist/tui.js`, replace that plugin entry with the npm package specifier and preserve its options. Do not keep both entries. Usage history and saved conversation modes remain under OpenCode's state directory, independent of how the plugin is installed. Published npm packages begin with v0.4.0; older releases were distributed as GitHub assets.

**Upgrading from `opencode-command-reviewer`:** replace the old plugin entry rather than adding a second one. The new plugin ID is `opencode-reviewer`; reapply any saved enable/disable preference if needed. Use documentation matching your installed release.

**Migrating from v0.2.x:** set `reviewExternalDirectories: true` to retain shell-associated directory reviews and enable the additional directory origins. `reviewBash` now controls shell execution only. MCP and custom-tool reviews require their own switches. Remove any `*-REVIEW-CORRECTION.md` files from your custom prompt directory: correction is now a fixed contract, and legacy overrides produce an explicit configuration error. Restart OpenCode after updating the bundle and configuration.

## Configuration

Put options beside the npm package specifier in `tui.json`. Only **`baseURL` and `model`** are required. Omitted options use these defaults:

| Option | Default | Meaning / accepted values |
| --- | --- | --- |
| `baseURL` | required | HTTP(S) API base URL, without embedded credentials, query, or fragment. Trailing slashes are removed. |
| `model` | required | Nonempty model identifier accepted by your endpoint. |
| `apiKey` | omitted | Nonempty Bearer API key; takes precedence over `apiKeyEnv`. |
| `apiKeyEnv` | omitted | Environment-variable name, e.g. `OPENCODE_REVIEWER_API_KEY`. Letters, digits, underscores; cannot start with a digit. Its value must be nonempty unless `apiKey` is supplied. |
| `instructions` | built-in prompts | Absolute custom prompt-directory path; no relative paths, `~/`, or inline instructions. See [Custom prompts](#custom-prompts). |
| `stream` | `false` | Enable SSE Chat Completions transport and progressive rating/explanation display together. `false` waits for the complete JSON response. |
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

For progressive display, set `"stream": true`. For a temporary conversation-level switch, use `/reviewer-disable` or `/reviewer-enable`; the saved conversation mode is not a configuration option.

Shell evidence includes literal Python/shell sources and supported `cat`/`head` file operands. Each permission gets a fresh file/byte budget; repeated edit entries retain their separate diffs. Omitted files carry `[!] File "path" not included in context.`; omitted edits also carry `[Δ] "path": +N −M lines` when a valid diff or host counts provide the numbers. Paths are JSON-quoted, and unknown counts are never invented. No omitted file content is sent.

### Coverage and evidence limits

- **MCP:** uses the pending tool's exact recorded arguments and scope. Registry membership and connected-server identity are cross-checked; ambiguous sanitized names or collisions remain manual. OpenCode 1.18.35 does not expose a complete MCP definition catalog through the public SDK, so unavailable descriptions/schemas are reported explicitly. Resource server names and URIs are matched verbatim, including whitespace. Resource URIs are identifiers, not assumed local paths. The reviewer does not call MCP tools or fetch their resource contents.
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

The panel follows the first pending permission in the root session or its direct children. Directory access and command execution may require separate reviews. If the sidebar is hidden, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).

**Data sent:** the current request, latest genuine root-user prompt, project context, and applicable bounded file snapshots, proposed diffs, tool arguments, permission metadata and available definitions go to your reviewer endpoint **before approval**. Tool arguments can themselves contain private data. MCP connection credentials, host environment/configuration and unrelated messages are not copied into evidence. `cat`/`head` operands supply full bounded snapshots, not command output. Shell file capture can follow symlinks outside the project. HTTP is supported but unencrypted. Ratings reflect the supplied evidence, not a safety guarantee; implementations, dependencies, remote contents and omitted content are not fully inspected.

### Streaming and pending reviews

With the default `stream: false`, the scanner shows **Evaluating** while waiting for the complete response, or **Retrying** during a format correction. Set `"stream": true` and restart OpenCode to request SSE streaming and show the rating as soon as it is parsed, followed by incremental Markdown. This changes both transport and display; the endpoint must support streaming Chat Completions. Model and provider selection remain configurable.

An early **Safe** or **Unsafe** is provisional. The pending indicator stays visible while the response is still being received or validated, even after a rating or apparently complete explanation appears. A format correction clears the earlier rating and text and shows **Retrying** until new streamed content arrives. Transport failures show **Analysis unavailable** and clear the preview; they are not automatically retried. With animations disabled, a static indicator retains the same labels.

Only a completed, validated **Safe** assessment whose final explanation has rendered can start auto-approval. A preview cannot start a countdown or enable the plugin's approval button. Native **Allow once**, **Allow always**, and **Reject** controls remain available throughout, with their existing OpenCode meanings.

### Enable or disable a conversation

Use `/reviewer-disable` or `/reviewer-enable`, or open the command palette (`Ctrl+P`) and choose **Reviewer: Disable for conversation** or **Reviewer: Enable for conversation**. These are local controls: they do not send assistant prompts or add conversation messages. They apply to the current root conversation and all its descendants, including when invoked from a descendant. They are unavailable without an active session.

Reviewing is enabled by default. Disabling aborts current analysis and countdowns, hides reports, and leaves native permission requests pending for manual action. Enabling freshly reviews pending requests for the configured review categories. A countdown already canceled or interrupted stays manual for that request in the running plugin, including after re-enabling. This cancellation history is not persisted across restarts.

The mode is saved for resume within the same host directory scope. Other conversations and the configured review-category switches remain independent. Changes take effect immediately in this instance; other running instances do not live-sync mode changes. These controls do not alter native permission rules or what native approval buttons mean.

Mode records live in `opencode-reviewer/session-mode-v1/` under OpenCode's state directory, normally `~/.local/state/opencode/`. Records contain only a version and enabled flag, with filenames keyed by host directory and root-session identity. No evidence or partial explanation is saved there. A success toast confirms **Saved for resume**. If saving fails, the toast says the change applied locally but resume may use the previous setting. If ancestry or saved mode cannot be read, review work stays suspended and native controls remain usable; a failed command reports **Reviewer setting unavailable** rather than claiming success.

### Usage and lifetime history

A dimmed footer shows three separate lines when usage and pricing are available:

```text
tokens in/out: 1000/100
cost: $0.0045
lifetime: $0.1234
```

Report totals include format-correction requests. Token counts and cost are independent: each line appears only when that component is available across the complete review, so cost-only and token-only reports are possible. Missing usage in an attempt can leave the report without stats. These are reviewer-request statistics.

- For `baseURL: "https://openrouter.ai/api/v1"`, cost is the endpoint's valid, nonnegative `usage.cost`, including reported zero or cost without token counts. The plugin does not add upstream inference costs or substitute a catalog estimate when reported cost is absent.
- Other endpoints use estimates from OpenCode's configured model catalog, matched by endpoint and model, including cache and context-tier rates. Unknown pricing omits the cost line. Model choice is not restricted to OpenRouter or any particular model.

**Lifetime usage** is saved automatically across projects and restarts. Its inline line appears **only alongside valid current-request usage**, including cost-only or token-only reports. It stays hidden while loading, on review failure, or when no usage component covers the complete review. Open **Reviewer: Lifetime usage** from the command palette for cumulative tokens, request count, and separate token/pricing coverage, even with no review open.

Lifetime accounting records valid received usage once per HTTP attempt, including format corrections and invalid assessments. Usage received before later failure or cancellation still counts; repeated cumulative stream frames do not count as extra requests. A request with no received valid tokens or cost adds no entry. These totals cover **received usage only**: unreported charges remain unknown, and the plugin makes no billing follow-up calls. Unknown cost is not treated as free, and partial token/pricing coverage is labeled.

New totals live in `opencode-reviewer/usage-v2/` under OpenCode's state directory. Existing `opencode-reviewer/usage-v1/` snapshots are read alongside them without being rewritten or copied. Keep both directories to preserve history. Legacy amounts retain their original estimates; cumulative cost can combine those estimates with newer reported costs and generic catalog estimates. Earlier unrecorded usage cannot be recovered.

Concurrent instances save separate atomic snapshots containing only numeric totals and timestamps. Totals refresh on locally recorded usage and when opening the stats command. Persistence failures leave reviews usable and show **lifetime: usage unavailable** alongside valid request stats, or an unavailable message in the palette dialog; stored data is never silently reset. There is no `oc-stats` or native session-accounting integration.

### Auto-approval

Enable it with `"autoApprove": true`; optionally change `"autoApproveDelaySeconds": 15`.

- Each completed, validated **Safe** assessment gets a full countdown once its final explanation is rendered and visible. Streamed previews never qualify. **Unsafe** and **Analysis unavailable** stay manual. A Safe result with incomplete evidence still qualifies.
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

### Releasing

Update both manifests with `npm version X.Y.Z --no-git-tag-version`, commit the release changes, then create and push the matching `vX.Y.Z` tag. A `v*` tag push runs verification and packaging, automatically creates a GitHub Release with generated notes and the archive, and publishes that same archive to npm. No separate GitHub Release creation step is required.

Stable versions publish to npm's `latest` tag. Versions such as `X.Y.Z-beta.1` create GitHub prereleases and publish to npm's `next` tag. Package and lockfile versions must match the Git tag; published npm versions are immutable.

For an existing tag containing this workflow, use **Actions → Release package → Run workflow**, select `main`, and supply the tag. Equivalent CLI command: `gh workflow run release.yml --ref main -f tag=vX.Y.Z`. Reruns reuse an existing release, and skip npm publication only when the existing package has identical archive integrity.
