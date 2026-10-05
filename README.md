# opencode-command-reviewer

Explains a pending OpenCode shell command and displays an advisory **SAFE** or
**UNSAFE** rating beneath the normal approval UI.

```text
✓ Counts fruit references in the input file and prints the totals.
```

Results show only a **green ✓** for safe or an **orange !** for unsafe, followed
by the description. Loading shows `… Analyzing…`; failures show
`! Analysis unavailable: …`. The native approval UI supplies the command and scope.

The normal OpenCode approval controls remain active. The panel disappears when
you approve or reject; unfinished review requests are cancelled. A rating does
not approve, block, alter, or execute the command.

## Target and installation

Verified with **OpenCode 1.18.34**, the **local Linux TUI**. Uses the public TUI
plugin API, permission events/state, session reads and the `app_bottom` slot.
The native permission dialog itself is not modified.

Build with Node.js 22+ and npm:

```sh
npm ci --ignore-scripts
npm run check
```

Add the following entry to the `plugin` array in
`~/.config/opencode/tui.json` (or the project's `.opencode/tui.json`). Preserve
your existing settings and plugin entries. Replace the endpoint and model.

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "/absolute/path/to/opencode-command-reviewer/dist/tui.js",
      {
        "baseURL": "http://127.0.0.1:1234/v1",
        "model": "your-small-model",
        "formatRetries": 1,
        "timeoutMs": 30000,
        "maxFiles": 4,
        "maxEvidenceBytes": 65536
      }
    ]
  ]
}
```

For an authenticated endpoint, add `"apiKeyEnv": "COMMAND_REVIEWER_API_KEY"` and set
that environment variable before starting OpenCode. Omit it for an endpoint
without authentication. A configured but unset key produces Analysis unavailable.

**Quit and restart OpenCode after installing or changing plugin configuration.**
Keep the checkout and built file at the configured path. Rebuild after editing
the source and restart to load the new bundle.

The plugin assesses pending native `bash` execution requests and
`external_directory` requests linked to that same native shell tool. Directory
requests from reads/edits are not shell reviews. The reviewer receives the exact
permission type; a later execution request receives its own assessment.
Your existing permission rules determine which commands prompt. If you want every
native shell command to prompt, configure `"permission": { "bash": "ask" }`
in your existing `opencode.json`, accounting for any more-specific/agent rules.
This plugin does not change those rules for you.

## Configuration

All settings are plugin options in `tui.json`. Unknown keys and invalid types
produce an explanatory Analysis unavailable result for pending shell requests.

| Option | Default | Meaning |
| --- | --- | --- |
| `baseURL` | required | HTTP(S) API base, e.g. `https://example.com/v1`; `/chat/completions` is appended |
| `model` | required | Reviewer model identifier |
| `apiKeyEnv` | omitted | Name of environment variable containing the bearer API key |
| `instructions` | built-in prompt | Replacement assessment instructions; evidence format/output contract remain fixed |
| `formatRetries` | `1` | Correction requests after invalid assessment JSON; `0` disables corrections |
| `timeoutMs` | `30000` | One total deadline for context, files, initial request and corrections |
| `maxFiles` | `4` | Maximum direct source files attempted per assessment |
| `maxEvidenceBytes` | `65536` | UTF-8 byte budget shared by command text and included file contents |

Numeric settings must be integers. Validation bounds are: retries 0–100, timeout
1–3,600,000 ms, files 1–1,000, evidence 1–16,777,216 bytes. The latest user prompt
and factual evidence labels are separate from the command/source budget.

Example prompt override:

```json
{
  "instructions": "Explain concrete effects in two concise sentences. Rate routine bounded local work safe. Rate credential exposure, broad deletion, production changes, or material uncertainty unsafe. Consider the user's request, but keep consequential risk visible even when authorized. Do not repeat the rating in the description."
}
```

The built-in instructions use that same general policy. Contents of commands,
source files and quoted user prompts are treated as evidence, not reviewer
instructions. This is a model assessment, not proof of runtime safety.

## Evidence and script discovery

The reviewer receives a JSON-encoded **text message** containing:

- Complete command and resolved working directory, or an explicit unavailable value.
- `permission`: exact request ID and type (`bash` or `external_directory`), requested
  `patterns`, proposed `always` patterns, host `metadata` and originating tool IDs.
- `session`: root and current session IDs, recorded directories, project IDs and
  workspace IDs, plus their matching OpenCode project name, VCS and worktree metadata.
- `execution`: invocation instance directory/worktree, original tool `workdir`,
  how the launch cwd was resolved, and its canonical filesystem path if available.
- Latest genuine root-conversation user prompt. Synthetic continuations, ignored
  text and attributed injected text are filtered using OpenCode's public metadata.
  Subagent delegation messages are not substituted for the user's prompt.
- Labeled direct Python/shell source files, including files outside the project.
- Explicit limitations and file-omission notices.

### Session origin, execution location and permission scope

The root session's recorded directory/project describes the conversation's origin;
the command's invocation directory can differ, including for continued sessions or
subagents. Relative tool `workdir` is resolved against the assistant invocation's
public `path.cwd`, matching OpenCode's shell-instance behavior—not against the
root session's starting directory. `cwd` is the initial shell launch directory,
before any `cd` statements inside the command. A missing invocation location is
explicitly unknown rather than replaced with the session's directory.

Project metadata is matched by project ID from OpenCode's registered-project list.
Only the matching root/current project records are sent. The plugin does not
initialize another OpenCode instance in the command's target directory to discover
its project. Linked worktrees can have a different invocation worktree from the
project's main worktree. A non-repository project's `vcs` is null, even if OpenCode
reports `/` as its generic worktree. These are the records available at review
time, not a reconstruction of a session's immutable history after moves/imports.

OpenCode can ask for `external_directory` access before asking for `bash` execution.
The reviewer receives each exact request separately, including the directory
patterns/metadata. The prompt explains that `always` lists proposed remembered
permissions, not permissions already granted. Being outside the starting repo is
relevant context, not an automatic UNSAFE rating.

Source is read as bounded regular UTF-8 files. Symlinks resolve to their target;
directories, special files, binary content and invalid UTF-8 are not included.
Missing or oversized files get notices such as:

```json
{
  "filename": "script.py",
  "status": "file too large for remaining evidence budget; contents not provided; assess risk accordingly"
}
```

The model chooses the boolean from the available evidence. The host does not
automatically force UNSAFE for an omitted file. A command larger than the entire
evidence budget produces Analysis unavailable rather than sending a partial command.

### Supported literal discovery

- `python`, `python2`, `python3`, versioned Python, including interpreter paths.
- `sh`, `bash`, `dash`, `ksh`, `zsh` with ordinary supported flags and literal file arguments.
- Direct paths such as `./script.sh` and extensionless Python/shell shebang scripts.
- Quoted filenames; absolute/relative paths; tool `workdir`.
- Common interpreter flags, `--`, basic `env` assignments/`-i`/`-u`, `command`, `exec`.
- Literal `cd directory && ...`, simple `;`, `&&`, `||` and pipeline tokenization.
  Ambiguous working directories are explicitly unresolved.
- Literal shell `-c`/`-lc` strings, with bounded nesting. Python `-c` code is
  already present in the command and is not recursively analyzed for file references.
- `source file` and `. file`; later working-directory state is marked uncertain.

### Explicit discovery boundaries

This is bounded tokenization, not a shell interpreter or full static analyzer.
Multiline commands, heredocs, backticks, substitutions, grouping, redirections,
background execution, unsupported options, variable-derived/globbed script paths,
and control flow may leave source discovery incomplete. That limitation is sent
to the reviewer along with the original command; no proposed command is executed
to resolve it. `~` and PATH-based script lookup are not expanded.

Imports, nested script calls inside files, `python -m`, task runners such as npm
and make, other language runtimes and MCP command tools are outside v1 discovery.
Files reflect the filesystem at review time; commands or other processes may
change them before execution. The plugin performs no sandboxing or file locking.

Root-prompt lookup follows at most 16 ancestors and 20 pages of 100 messages.
Unavailable/ambiguous context is labeled, not replaced by an older delegated brief.
An attachment-only latest user message has no text prompt to send. Compacted or
imported histories can only be interpreted using the provenance metadata exposed
by OpenCode.

## Reviewer protocol and failures

The endpoint must support non-streaming Chat Completions with system/user/assistant
text messages. No tools, Responses API or provider-specific JSON mode are required.
The model must return exactly:

```json
{"safe": false, "desc": "Prints .env, which may expose credentials in the output."}
```

`safe` must be a boolean, `desc` a nonempty string, and extra fields are rejected.
The description explains effects without repeating the rating. Markdown fences,
surrounding prose, invalid JSON and schema mismatches trigger a correction request
with validation feedback, within the configured count and shared deadline.

HTTP/network errors, malformed API envelopes, missing text completions, and an
HTTP response larger than 64 KiB end the review. Redirects are rejected. The panel
shows Analysis unavailable and a concise cause; API error bodies are not displayed.

## Lifecycle and scope

- Assessments are keyed to permission request IDs; duplicate events do not re-review.
- The panel follows the root session's first pending permission, including direct
  subagents, matching the tested host's approval ordering. An unrelated permission
  does not show another command's assessment.
- A read-only pending-permissions refresh every two seconds recovers startup
  requests and reconciles cancellations that lack a reply event. Stale snapshots
  cannot resurrect a request resolved while the snapshot was being fetched.
- Resolution, deletion and plugin disposal abort review work. Late results cannot
  recreate the panel. No persistent assessment history is stored.
- The UI uses a bounded scroll area and escapes terminal control/bidi characters.

The current implementation targets local filesystem sessions. Remote OpenCode
servers/remote workspaces, desktop/web clients and OpenCode 2 are not verified
targets. Commands, user prompts and captured file contents are sent to your
configured reviewer endpoint; use one appropriate for that data.

## Development and verification

```sh
npm run check          # TypeScript, automated tests, compiled ESM bundle
npm run test:runtime   # installed OpenCode + tmux + local mock HTTP models
npm run check:package  # reproducible bundle and exact package-content check
```

Runtime tests require Linux, Python 3, `tmux`, and `opencode` on PATH; set
`OPENCODE_BIN` for another binary. They create isolated HOME/XDG/project directories
under the OS temporary directory (`opencode-command-reviewer-*`), use synthetic source and local model fixtures, and leave
captures under ignored `.runtime/`. They do not use your provider credentials or
modify your OpenCode configuration. Runtime tests intentionally approve only their
own harmless temporary Python fixture through a terminal keystroke.

Verified on OpenCode 1.18.34: 42 automated tests and four real-TUI scenarios
(format correction, cancellation, API failure, and separate directory/execution
permissions). Checks cover source/context collection, strict JSON validation,
deadlines, stale-result suppression, advisory-only behavior and compact rendering.
Packaging checks compare successive build hashes and require exactly the intended
four package files. The local model fixtures verify mechanics, not the accuracy
of a live model's safety judgments.

Runtime captures are disposable and can be regenerated with `npm run test:runtime`.
Source modules separate evidence, context, review transport, lifecycle and TUI
rendering. The runtime bundle embeds the shell tokenizer; Solid/OpenTUI are supplied
by the host.
