# OpenCode Reviewer

Reviews pending permissions in the OpenCode sidebar using a separate LLM. Covers
shell commands, file edits, MCP calls, custom tools, and external-directory access.
Supports streaming explanations, auto-approval, and Linux desktop notifications with distinct sounds.

![](./assets/recording.gif)

Requires OpenCode 1.18.35 or newer on Linux.

## Install and config

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
        "extraCareful": true,
        "autoApproveDelaySeconds": 15,
        "notify": true,
        "notifySound": true,
        "notificationSoundDirectory": "/absolute/path/to/notification-sounds",
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
endpoint: `/chat/completions` is appended to the base URL. Choose a model available
at that endpoint.

Replace `apiKey`, or remove it and set the variable named by `apiKeyEnv` before
launching OpenCode. The inline key takes precedence. Omit both for an unauthenticated
endpoint. Remove `instructions` to use the built-in prompts and
`notificationSoundDirectory` to use the bundled sounds.

The remaining values above are the defaults. Restart OpenCode after changing
configuration. Reviews run when OpenCode asks for permission, so set the relevant
rules to `ask` in `opencode.json`. Existing `allow` rules skip review.

## Options reference

| Option | Behavior |
| --- | --- |
| `stream` | Show the rating and explanation as they arrive. Requires SSE support from the endpoint. |
| `reviewBash` | Review native shell commands. |
| `reviewEdits` | Review native edit, write, and apply-patch requests. |
| `reviewMcp` | Review identifiable MCP tool and resource permissions. |
| `reviewCustomTools` | Review permissions requested by registered custom tools. |
| `reviewExternalDirectories` | Review directory access independently of the other switches. Directory approval can resume the operation without another prompt. |
| `autoApprove` | Allow completed Safe reviews once after the visible countdown. |
| `extraCareful` | Include the extra-careful prompt in auto-mode reviews. Defaults to `true`; set `false` to omit it. |
| `autoApproveDelaySeconds` | Countdown duration, 0–3600 seconds. |
| `notify` | Linux desktop notifications and sounds. Defaults to `true`; set `false` to disable both. |
| `notifySound` | Play notification sounds. Defaults to `true`; set `false` to keep banners silent. |
| `notificationSoundDirectory` | Absolute custom sound directory. Use `attention`, `approved`, `error`, and `ended` basenames with `.wav` or `.mp3`; WAV takes precedence. Missing or unusable files fall back to bundled sounds. |
| `formatRetries` | Additional attempts to correct malformed assessment JSON, 0–100. |
| `timeoutMs` | Total review deadline, 1–3,600,000 ms. |
| `maxFiles` | File limit per review, 1–1,000. |
| `maxEvidenceBytes` | Evidence limit, 1–16,777,216 bytes. Whole files or diffs may be omitted; oversized mandatory arguments fail review. |
| `instructions` | Absolute directory containing overrides for the [prompt templates](https://github.com/mightykatun/opencode-reviewer/tree/main/prompts). Missing templates use the built-ins. |

My LLMs insist on writing a bunch of useless text to my README, so I collapsed them here in case anyone wants to inflict themselves (or more likely their agent) the pain of reading it.

<details>
<summary>Usage</summary>
The sidebar shows Safe, Unsafe, or Analysis unavailable. Explanations support
Markdown and scrolling. If the sidebar is hidden, use OpenCode's Show sidebar
command.

With streaming enabled, Evaluating and its spinner disappear when a rating arrives.
The rating remains provisional until the full response is validated. A format retry
clears the preview and restores the loading indicator. Auto-approval
starts only after the full response is validated and rendered.

Transient connection failures and HTTP 408/429/500/502/503/504 responses get up to
two internal retries within `timeoutMs`, honoring server cooldowns. A stream that
has already delivered assessment text is not restarted. This is separate from
`formatRetries`; no additional setting is needed. Retried requests can incur
additional provider charges, and unreported usage remains unknown.

During an auto-approval countdown, click the countdown to allow once immediately,
or Cancel to leave the request manual. Hiding or covering the panel also cancels
that request's countdown. Cancel before using native Allow always or rejection
forms; those forms alone do not stop the countdown.
Positive countdowns hold their configured starting number for one extra second
before counting down. A zero-second setting still approves without that hold.

`/reviewer-disable` and `/reviewer-enable` control the current conversation and its
descendants. The setting is saved for resume. Both commands are also in the command
palette. Disabling stops current reviews and countdowns while native permission
controls remain available.

Token and cost totals appear below completed reports when available. Open
Reviewer: Lifetime usage in the command palette for cumulative totals. OpenRouter
costs use reported charges; other endpoints use available catalog estimates.
Received usage counts even if a review fails or is interrupted. Unreported charges
are missing from the totals.

The lifetime dialog shows completed reviews, retries, tokens, cost, Safe/Unsafe
percentages, confirmed auto-approvals, and average time to a rating and full report.
Percentages use recorded completed reviews as their denominator. Each validated
review counts once, even without usage data; a fresh review after re-enabling counts
again. Retries count extra API attempts actually dispatched, including format
corrections and transport recovery. Manual approvals are not auto-approvals.
Timings run from evaluation start, including evidence and retries, to the accepted
attempt's first rating and final validated response, excluding rendering/countdown
time. Non-streaming reviews use the final response time for both measurements.
Only running averages and sample counts are stored, not individual timings.
Totals persist across restarts. New metrics show partial history when older records
lack them; averages include measured reviews only. Earlier unrecorded values cannot
be reconstructed.

Reviews send the pending request, latest user prompt, project context, and relevant
file snapshots, diffs, or tool arguments to your endpoint before approval. Shell
file snapshots can follow symlinks outside the project. Missing evidence is noted
in the report; ratings are advice based on the supplied evidence.
</details>

<details>
<summary>Desktop notifications</summary>
Transient banners have an **Opencode (Session name)** heading and a small status icon: green
checkmark for approvals, orange exclamation mark for attention, red X
for errors, and a neutral code mark for completed responses. GNOME controls the
heading's font weight. The event message appears beneath it, even while the
terminal is focused:

- **Session needs attention:** questions and manual permissions. Reviewed requests
  wait for a final validated assessment; failures, canceled automation, and a Safe
  review blocked from starting its countdown also notify. Unreviewed requests
  notify immediately, including when conversation review is disabled.
- **Reviewer approved a permission:** sent with the approval sound after confirmed
  automatic approval, for both positive and zero delays. The countdown is silent.
  Approval sounds are limited to
  one every two seconds; every eligible banner is retained for delivery.
- **Session error:** an unrecovered session/provider failure, not a review failure.
- **Session ended:** a completed root-agent response, not a question/permission
  pause or an explicit user interruption.

Notifications cover conversations visited in this terminal and their descendants.
Existing pending requests at startup/resume are not replayed. Clicking can select
the originating GNOME Terminal tab and root conversation. Native input prompts
cover root/direct-child requests in the supported host. Open dialogs are
left intact; other terminals still receive banners and sounds. Desktop policies
control expiry/history and whether activation actually brings a window forward.
GNOME Terminal clicks use the desktop activation token to bring the correct tab
forward across workspaces. GNOME may attribute the notification source to Terminal;
the banner heading remains Opencode.

Linux delivery uses `notify-send`, `stdbuf`, and `gdbus`; audio uses `paplay` or `pw-play`.
On Ubuntu, `libnotify-bin`, `coreutils`, `libglib2.0-bin`, and `pulseaudio-utils` provide these
utilities. The MP3 decoder and four default sounds are bundled; FFmpeg is not
required. MP3 and mono/stereo PCM/float WAV files up to 4 MiB and 10 seconds are
normalized toward -20 dBFS RMS with a -3 dBFS peak ceiling before playback.
Custom sounds are loaded on first use; restart after replacing them.
Audio is prepared before showing its banner and played from the normalized cache
with a low-latency buffer; preparation never blocks permission approval.
`stdbuf` makes delivery acknowledgements immediate instead of waiting for
`notify-send` to flush its output when the banner closes.
Disable overlapping notification plugins to avoid duplicate alerts.
</details>

## Development

Use Node.js 24.15.0+ within 24.x, or 22.22.2+ within 22.x, and npm.
Run `npm ci --ignore-scripts`, then `npm run check` for typechecking, source tests,
pure-helper tests and the build. `npm run test:helpers` runs the helper checks
without building or starting OpenCode. Pull-request CI checks both Node versions.
See [AGENTS.md](https://github.com/mightykatun/opencode-reviewer/blob/main/AGENTS.md)
for runtime tests and the tag-driven release process.
