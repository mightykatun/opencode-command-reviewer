# opencode-command-reviewer

Explains shell commands awaiting OpenCode approval using a configurable OpenAI-compatible model. Displays a **green ✓** or **orange !** followed by the explanation. Approval remains yours.

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

**Restart OpenCode after installation or configuration changes.** Keep the built file at the configured path. After updating the source, rebuild and restart.

Only pending shell approvals are reviewed, including their `external_directory` checks. To request approval for shell commands, set `"permission": { "bash": "ask" }` in `opencode.json`, accounting for any more-specific or agent rules. The plugin itself belongs in **`tui.json`**.

## Optional settings

Add these alongside `baseURL` and `model`:

| Option | Default | Purpose |
| --- | --- | --- |
| `apiKey` | omitted | API key stored directly in the plugin options; takes precedence over `apiKeyEnv` |
| `apiKeyEnv` | omitted | API-key environment-variable name, e.g. `COMMAND_REVIEWER_API_KEY`; set it before starting OpenCode |
| `instructions` | built-in prompt | Override assessment instructions; JSON response format stays fixed |
| `formatRetries` | `1` | Correction retries for invalid model response format |
| `timeoutMs` | `30000` | Total review timeout, including retries |
| `maxFiles` | `4` | Maximum directly invoked script files to inspect |
| `maxEvidenceBytes` | `65536` | Combined command/source text budget in bytes |

For an authenticated endpoint, the plugin options can include the key directly:

```json
{
  "baseURL": "https://api.example.com/v1",
  "model": "your-model",
  "apiKey": "your-api-key"
}
```

`apiKey` must be a nonempty string and is sent as a Bearer authorization header. If both key options are set, `apiKey` wins even when the named environment variable is unset. Omit both options for an unauthenticated endpoint.

## Behavior

- While a shell permission is pending, a temporary **Permission analysis** panel covers the right sidebar. It shows **✓ Safe** or **! Unsafe** in the active theme's success/warning colors, followed by the agent's Markdown-formatted analysis using the conversation's theme palette. The normal sidebar returns when the permission is resolved.
- Reviews follow the sidebar's visibility. If it is hidden or the terminal is narrow, use OpenCode's **Show sidebar** command (default: `Ctrl+X`, then `B`).
- Sends the command, execution location, session/repository and permission context, latest user prompt, and directly invoked Python/shell source to your endpoint. Source can include files outside the project.
- Reports missing or oversized source explicitly. Imports, task runners and complex shell constructs are not fully resolved.
- While reviewing, a muted gray block-scanner animation matches OpenCode's running indicator. Disabling OpenCode animations shows a static indicator instead. Failures display `! Analysis unavailable` and a reason. Resolving the approval removes the panel and cancels unfinished review.
- Ratings are advisory model judgments, not a safety guarantee. Existing OpenCode permissions stay in control.

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
