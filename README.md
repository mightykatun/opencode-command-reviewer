# OpenCode reviewer

Reviews pending permissions in the OpenCode sidebar using a separate LLM. Covers
shell commands, file edits, MCP calls, custom tools, and external-directory access.
Supports streaming explanations and optional one-time auto-approval.

Requires OpenCode 1.18.35 on Linux.

## Install

Add this entry to `~/.config/opencode/tui.json` or `.opencode/tui.json`.
OpenCode installs the [npm package](https://www.npmjs.com/package/opencode-reviewer).

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-reviewer@latest",
      {
        "baseURL": "https://openrouter.ai/api/v1",
        "model": "your-model",
        "apiKey": "your-api-key",
        "apiKeyEnv": "OPENCODE_REVIEWER_API_KEY",
        "instructions": "/absolute/path/to/reviewer-prompts",
        "stream": false,
        "reviewBash": true,
        "reviewEdits": true,
        "reviewMcp": false,
        "reviewCustomTools": false,
        "reviewExternalDirectories": false,
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

Only `baseURL` and `model` are required. Use any OpenAI-compatible Chat Completions
endpoint; `/chat/completions` is appended to the base URL. Choose a model available
at that endpoint.

Replace `apiKey`, or remove it and set the variable named by `apiKeyEnv` before
launching OpenCode. The inline key takes precedence. Omit both for an unauthenticated
endpoint. Remove `instructions` to use the built-in prompts.

The remaining values above are the defaults. Restart OpenCode after changing
configuration. Reviews run when OpenCode asks for permission, so set the relevant
rules to `ask` in `opencode.json`. Existing `allow` rules skip review.

## Options

| Option | Behavior |
| --- | --- |
| `stream` | Show the rating and explanation as they arrive. Requires SSE support from the endpoint. |
| `reviewBash` | Review native shell commands. |
| `reviewEdits` | Review native edit, write, and apply-patch requests. |
| `reviewMcp` | Review identifiable MCP tool and resource permissions. |
| `reviewCustomTools` | Review permissions requested by registered custom tools. |
| `reviewExternalDirectories` | Review directory access independently of the other switches. Directory approval can resume the operation without another prompt. |
| `autoApprove` | Allow completed Safe reviews once after the visible countdown. |
| `autoApproveDelaySeconds` | Countdown duration, 0–3600 seconds. |
| `formatRetries` | Additional attempts to correct malformed assessment JSON, 0–100. |
| `timeoutMs` | Total review deadline, 1–3,600,000 ms. |
| `maxFiles` | File limit per review, 1–1,000. |
| `maxEvidenceBytes` | Evidence limit, 1–16,777,216 bytes. Whole files or diffs may be omitted; oversized mandatory arguments fail review. |
| `instructions` | Absolute directory containing overrides for the [prompt templates](https://github.com/mightykatun/opencode-reviewer/tree/main/prompts). Missing templates use the built-ins. |

## Usage

The sidebar shows Safe, Unsafe, or Analysis unavailable. Explanations support
Markdown and scrolling. If the sidebar is hidden, use OpenCode's Show sidebar
command.

With streaming enabled, the rating remains provisional while Evaluating is shown.
A format retry clears the preview and shows Retrying. Auto-approval starts only
after the full response is validated and rendered.

During an auto-approval countdown, click the countdown to allow once immediately,
or Cancel to leave the request manual. Hiding or covering the panel also cancels
that request's countdown. Cancel before using native Allow always or rejection
forms; those forms alone do not stop the countdown.

`/reviewer-disable` and `/reviewer-enable` control the current conversation and its
descendants. The setting is saved for resume. Both commands are also in the command
palette. Disabling stops current reviews and countdowns while native permission
controls remain available.

Token and cost totals appear below completed reports when available. Open
Reviewer: Lifetime usage in the command palette for cumulative totals. OpenRouter
costs use reported charges; other endpoints use available catalog estimates.
Received usage counts even if a review fails or is interrupted. Unreported charges
are missing from the totals.

Reviews send the pending request, latest user prompt, project context, and relevant
file snapshots, diffs, or tool arguments to your endpoint before approval. Shell
file snapshots can follow symlinks outside the project. Missing evidence is noted
in the report; ratings are advice based on the supplied evidence.

## Development

Use Node.js 24.15.0+ within 24.x, or 22.22.2+ within 22.x, and npm.
Run `npm ci --ignore-scripts`, then `npm run check` for typechecking, source tests,
pure-helper tests and the build. `npm run test:helpers` runs the helper checks
without building or starting OpenCode. Pull-request CI checks both Node versions.
See [AGENTS.md](https://github.com/mightykatun/opencode-reviewer/blob/main/AGENTS.md)
for runtime tests and the tag-driven release process.
