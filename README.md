# opencode-command-reviewer

Explains shell commands and proposed file edits awaiting OpenCode approval using a configurable OpenAI-compatible model. Displays **✓ Safe** or **! Unsafe** followed by the explanation. Approval remains yours.

Tested with **OpenCode 1.18.34 on Linux, local terminal TUI**.

## Install

Download `opencode-command-reviewer-VERSION.tgz` from [GitHub Releases](https://github.com/mightykatun/opencode-command-reviewer/releases). Choose the built `.tgz` asset, not GitHub's source archive. Replace `VERSION` below with the release version, then run from the download directory:

```sh
mkdir -p opencode-command-reviewer
tar -xzf opencode-command-reviewer-VERSION.tgz -C opencode-command-reviewer --strip-components=1
```

The archive includes the built plugin; no dependency installation or local build is needed. OpenCode supplies the host libraries. To build from source, see [Development](#development).

Add this plugin entry to `~/.config/opencode/tui.json` or `.opencode/tui.json`, preserving existing entries. Replace the absolute path, endpoint and model:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "/absolute/path/to/opencode-command-reviewer/dist/tui.js",
      {
        "baseURL": "http://127.0.0.1:1234/v1",
        "model": "your-model"
      }
    ]
  ]
}
```

The endpoint must support Chat Completions; `/chat/completions` is appended to `baseURL`.
HTTP and HTTPS are supported; HTTP sends evidence and any API key without transport encryption, including for remote endpoints.

**Restart OpenCode after installation or configuration changes.** Keep the built file at the configured path. After updating the source, rebuild and restart.

Reviews pending `bash` approvals, shell-associated `external_directory` checks, and native `edit` approvals from the `edit`, `write`, and `apply_patch` tools. To request shell and file-change approval, set `"permission": { "bash": "ask", "edit": "ask" }` in `opencode.json`, accounting for any more-specific or agent rules. The plugin itself belongs in **`tui.json`**.

## Configuration reference

These are the plugin's eleven supported options. Put them in the options object beside the plugin path in `tui.json`, as shown above. **Only `baseURL` and `model` are required.** Omit optional settings to use their defaults.

| Option | Default | Purpose and allowed values |
| --- | --- | --- |
| `baseURL` | **required** | HTTP(S) API base URL, e.g. `http://127.0.0.1:1234/v1`. The plugin appends `/chat/completions`; supply the base, not the full completion URL. Embedded credentials, query strings and fragments (including bare `?` or `#`) are rejected. Trailing slashes are removed. |
| `model` | **required** | Nonempty model identifier accepted by your endpoint. |
| `apiKey` | omitted | API key supplied directly as a nonempty string; takes precedence over `apiKeyEnv`. |
| `apiKeyEnv` | omitted | Name of the environment variable containing the API key, e.g. `COMMAND_REVIEWER_API_KEY`. Use letters, digits and underscores, starting with a letter or underscore. Set it before starting OpenCode. |
| `instructions` | built-in prompts | Absolute path to a directory containing named assessment/correction Markdown overrides. Missing files fall back individually to built-ins. See [Custom prompt files](#custom-prompt-files). **Inline instruction text is no longer supported.** |
| `reviewBash` | `true` | Boolean enabling shell reviews, including shell-associated `external_directory` checks. Set `false` to disable both. |
| `reviewEdits` | `true` | Boolean enabling native `edit`/`write`/`apply_patch` reviews. Set `false` to disable edit analysis independently of shell reviews. |
| `formatRetries` | `1` | Additional correction attempts for invalid assessment format. Integer **0–100**; `0` disables corrections. HTTP, network and API-envelope errors are not retried. |
| `timeoutMs` | `30000` | Shared per-review timeout for context lookup, source capture, HTTP requests and corrections. Also limits startup prompt loading separately. Integer **1–3,600,000** milliseconds (default: 30 seconds). |
| `maxFiles` | `4` | Maximum distinct shell source references to attempt to inspect, or first edit change entries to consider for diff inclusion. Integer **1–1,000**; unavailable/oversized entries also count. Later edit entries retain path/operation details with omitted diffs. |
| `maxEvidenceBytes` | `65536` | UTF-8 byte budget: combined command/source text for shell reviews, or combined included diffs for edit reviews. Integer **1–16,777,216** (default: 64 KiB; maximum: 16 MiB). Excludes prompts, context, path/operation metadata and HTTP/JSON overhead. An oversized command fails review; oversized source or complete per-file diffs are omitted with reasons. |

To review only shell commands, add `"reviewEdits": false`. To review only file edits, add `"reviewBash": false`. Setting both to `false` disables all plugin assessments. Disabled review types produce no analysis panel or model requests; OpenCode's native permission prompts still operate normally. A disabled first permission also keeps a later request's assessment hidden. Restart OpenCode after changing these settings.

### Authentication

For an authenticated endpoint, the options object can include the key directly:

```json
{
  "baseURL": "https://api.example.com/v1",
  "model": "your-model",
  "apiKey": "your-api-key"
}
```

Alternatively, replace `apiKey` with `"apiKeyEnv": "COMMAND_REVIEWER_API_KEY"` and set that variable in the environment used to start OpenCode. Keys are trimmed and sent as a Bearer authorization header. If both options are set, `apiKey` wins even when the named environment variable is unset or blank. Without an inline key, a configured environment variable must contain a nonempty key. Omit both options for an unauthenticated endpoint.

### Custom prompt files

To customize reviewer guidance, copy whichever files you want to change from the repository's `prompts/` directory into your own directory, using source matching your installed plugin version. Keep these exact filenames:

| Filename | Used for |
| --- | --- |
| `PERMISSION-REVIEW-PROMPT.md` | Shell assessment instructions |
| `PERMISSION-REVIEW-CORRECTION.md` | Shell format-correction feedback |
| `EDIT-REVIEW-PROMPT.md` | File-edit assessment instructions |
| `EDIT-REVIEW-CORRECTION.md` | File-edit format-correction feedback |

Set the directory in the plugin's options object:

```json
{
  "baseURL": "http://127.0.0.1:1234/v1",
  "model": "your-model",
  "instructions": "/absolute/path/to/my-review-prompts"
}
```

- Only direct files with the names above are loaded. You may override just one; every missing file uses its own built-in version. Omit `instructions` to use all built-ins.
- Use an absolute path, not a relative path or `~/` shorthand. The directory must exist and be readable. Each supplied file must be readable, nonempty, regular UTF-8 text no larger than **64 KiB**; invalid supplied files cause configuration failure rather than silent fallback.
- Custom correction files must retain **`{{validationError}}`**, which is replaced with the format-validation feedback.
- The shared fixed evidence/output contract lives in **`contracts/PERMISSION-REVIEW-CONTRACT.md`**, outside `prompts/`. It is always appended and enforces `{"safe": boolean, "desc": "nonempty text"}`. Files ending in `-CONTRACT.md` in your custom prompt directory are rejected.
- Custom files are loaded once at plugin startup. **Restart OpenCode after modifying them; no rebuild is needed.** Changing built-in source prompts requires both rebuilding and restarting. The release bundle embeds all built-ins and the contract; the standalone Markdown files are not required beside the installed bundle.

**Migrating to 0.1.0:** if you previously used `"instructions": "your inline guidance"`, put that text in `PERMISSION-REVIEW-PROMPT.md` inside your custom directory and change `instructions` to the directory's absolute path. Edit reviews retain their built-in guidance unless you also provide `EDIT-REVIEW-PROMPT.md`. Edit reviews are enabled by default; use `"reviewEdits": false` to retain shell-only analysis.

### Validation and appearance

- Unknown option names and explicit `null` values are rejected. Numeric settings must be integers, not quoted strings. Review switches accept only JSON `true` or `false`, not strings or numbers. All supplied string settings are trimmed and must be nonempty.
- Invalid configuration produces `Analysis unavailable` for shell/edit reviews; native approval controls remain available. Unidentified external-directory requests stay hidden.
- Colors follow OpenCode's active theme, and the loading animation follows its animation setting. There are no plugin-specific appearance options.
- **Restart OpenCode after changing `tui.json`.** Permission rules belong in `opencode.json`.

## Behavior

- While a supported permission is pending, a temporary **Permission analysis** panel covers the right sidebar. It shows **✓ Safe** or **! Unsafe** in the active theme's success/warning colors, followed by the agent's Markdown-formatted analysis using the conversation's theme palette. The normal sidebar returns when the permission is resolved.
- Reviews follow the sidebar's visibility. If it is hidden or the terminal is narrow, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).
- Both review types send session/project context, permission scope and the latest genuine root-user prompt to the same configured endpoint **before approval**. Rejecting permission does not retract that transfer. Configure an endpoint you trust with that data.
- **Shell reviews** include the command, execution location and directly invoked Python/shell source. Source can include readable files outside the project and symlink targets. Missing/oversized source is reported explicitly; imports, task runners and complex shell constructs are not fully resolved.
- **Edit reviews** use a separate payload and prompt set, containing host-proposed per-file diffs, operations and move destinations. They cover native edits, writes, and multi-file patches including additions/deletions/moves. The plugin does not apply edits or read full target files to reconstruct them. Host diffs may normalize whitespace/omit BOMs, and post-approval formatting is not inspected. Preliminary edit-related external-directory checks are not reviewed; edit analysis begins when the host requests actual `edit` permission with the proposed changes.
- **Partial edit reviews** retain whole per-file diffs that fit the limits and explicitly mark omitted changes. Raw tool input and duplicate host metadata are not forwarded around those limits. The default edit prompt requires explaining incomplete coverage and returning `safe=false` when missing evidence prevents a confident assessment of the whole request.
- Each permission request gets one assessment. A multi-file `apply_patch` request sends its bounded changes together; separate `edit`/`write` permission requests get separate reviews. The panel follows OpenCode's first pending permission, including direct-child sessions. A subagent's review uses the root conversation's latest genuine user prompt; unavailable prompt context is marked explicitly.
- While reviewing, a muted gray block-scanner animation matches OpenCode's running indicator. Disabling OpenCode animations shows a static indicator instead. Failures display `! Analysis unavailable` and a reason. Resolving the approval removes the panel and cancels unfinished review.
- Ratings are advisory model judgments, not a safety guarantee. Existing OpenCode permissions stay in control.
- Long analysis supports mouse-wheel and scrollbar scrolling. Links are handled by the terminal; the plugin does not fetch them. No analysis-specific keyboard shortcuts are installed.
- The timeout cancels asynchronous work but cannot interrupt synchronous parsing mid-operation. The evidence budget covers command/source or edit-diff bytes, not the entire HTTP payload; separate pending permissions can be reviewed concurrently without an aggregate cap.

## Development

Requires Node.js 22+ and npm.

```sh
git clone https://github.com/mightykatun/opencode-command-reviewer.git
cd opencode-command-reviewer
npm ci --ignore-scripts
npm run check          # Typecheck, tests and build
npm run test:runtime   # Real TUI checks; requires tmux, Python 3 and opencode
npm run check:package  # Reproducible build and package-content check
npm pack              # Builds and creates opencode-command-reviewer-VERSION.tgz
```

## Releases

Update the version with `npm version X.Y.Z --no-git-tag-version`, commit both package manifests and the release workflow, then publish a GitHub release tagged `vX.Y.Z` at that commit. GitHub Actions checks the tag/version match, runs typechecking and tests, verifies the reproducible build and package contents, and attaches `opencode-command-reviewer-X.Y.Z.tgz` to the release. Prereleases use the same workflow. Distribution is through GitHub release assets; no npm registry credentials are required.
