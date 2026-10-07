# Permission coverage, evidence resilience, and statistics implementation plan

## 1. Status and objective

This document consolidates the requested changes and the investigation discussed
after v0.2.3. The execution record and acceptance checklist track the implemented
work and verification. Publication remains a separate, explicitly requested step.

- Baseline: v0.2.3, commit `8215126`.
- Target host: OpenCode **1.18.34**, local Linux terminal TUI, Node.js **22+**.
- Release version: **v0.3.0**, because permission coverage, configuration, and
  custom correction-template compatibility will change.
- Follow `AGENTS.md` throughout implementation. Use public host APIs and slots.

### Requested outcomes

1. Review pending MCP permissions, including identifiable MCP resource requests.
2. Review pending permissions raised by custom/plugin tools.
3. Review other `external_directory` requests, including reads, searches, and
   edits, using a dedicated directory-access prompt.
4. Give MCP, custom-tool, and directory reviews their own prompt files.
5. Move format-failure correction guidance out of overridable `prompts/` and
   into fixed `contracts/`.
6. Show inline lifetime statistics only alongside valid current-request stats.
7. Investigate reports of file-access timeouts, distinguish missing files from
   stalled I/O, and implement appropriate bounded handling.
8. Update implementation, tests, fixtures, configuration documentation, maintainer
   instructions, build embedding, packaging, and release guidance together.

## 2. Current behavior and verified constraints

### Coverage and lifecycle

- `src/controller.ts` initially gates `edit` with `reviewEdits`, and `bash` plus
  `external_directory` with `reviewBash`.
- `src/context.ts` recognizes native shell requests and shell-associated directory
  checks. Non-shell directory checks currently return no review.
- Native edits use pending host-computed diffs from `edit`, `write`, and
  `apply_patch`. Edit-associated directory checks are currently hidden.
- Unsupported and disabled requests still participate in native pending-request
  ordering. They must not let a later request's panel appear prematurely.
- Approval remains a fresh, visible, once-only reply through the invocation host
  instance. The plugin neither executes the tool nor grants remembered rules.

### Host details relevant to the new coverage

Inspection of the pinned host source established that:

- MCP tool execution requests permission under its exposed tool identifier.
  The pending permission can contain empty metadata and wildcard patterns, so
  the linked running tool part is necessary to obtain the arguments.
- MCP resource listing, template listing, and reading can request `read`, with
  MCP server/resource scope. A `read` permission is not necessarily a local file
  read.
- Custom tools receive an `ask` function and may request arbitrary permission
  names. Their permission check can occur inside tool execution, after other
  code has already run. Review the operation being allowed now; do not claim the
  entire custom tool has yet to execute.
- The public tool-list route obtains registry definitions. It must not be
  assumed to provide a complete MCP definition catalog or definitive origin
  metadata for every tool.
- MCP exposed identifiers sanitize names. Simple underscore splitting or prefix
  guessing is not a reliable proof of server/tool identity.

Verify these capabilities against the installed SDK and real host fixtures
before committing to classification or metadata enrichment behavior.

### Files and timeouts

- `src/evidence.ts` converts ordinary capture errors such as `ENOENT` into
  factual omissions and continues the review.
- Shell discovery does not execute SSH/container commands or fetch their remote
  sources. Such commands receive indirect-execution limitations.
- `src/files.ts` calls `realpath` for distinct-file accounting, including edit
  entries whose diff text is already available from the host.
- Context loading and file capture also await `realpath`, `open`, `stat`, and
  `read`. Abort checks between awaits do not make the individual filesystem
  operations cancellable.
- `withDeadline` stops waiting at the overall deadline, but it cannot guarantee
  immediate cancellation of an in-flight kernel filesystem operation.
- A stalled NFS/SSHFS/FUSE path is a plausible cause, not a reproduced diagnosis
  of the user's reported timeout. Investigate rather than just increasing
  `timeoutMs`.

### Prompts and statistics

- Shell and edit each have an overridable correction template today.
- The evidence/output contract is already fixed and appended to system guidance.
- Prompt source loading and build embedding currently maintain filename routing
  separately; both need the same new inventory.
- `src/tui.tsx` renders lifetime text outside the request-usage condition. This
  explains why an existing lifetime total can appear by itself.
- Lifetime accounting observes valid completed response usage before assessment
  validation. This accounting behavior is intentional and is separate from the
  requested display change.

## 3. Decisions to settle before implementation

Execution uses the proposed opt-in defaults after the instruction to implement
this plan: all three new switches default false, and the directory switch owns
all directory checks. The migration must explicitly enable directory reviews.

| Decision | Proposed choice | Consequence |
| --- | --- | --- |
| Prompt separation | Separate MCP, custom-tool, and external-directory prompts | Each review policy can be customized independently. |
| New switches | `reviewMcp`, `reviewCustomTools`, `reviewExternalDirectories` | Three explicit booleans in the existing flat configuration. |
| New switch defaults | Initially `false` | Existing auto-mode installations do not silently acquire new review/approval coverage. Confirm this versus defaulting to `true` like existing review switches. |
| Directory switch ownership | All directory checks use `reviewExternalDirectories` | `reviewBash` becomes shell execution only. Existing shell-directory reviews require enabling the new switch if the proposed false default is accepted. This is a documented migration, not backward-compatible behavior. |
| Auto mode for new kinds | Existing `autoApprove` applies to an enabled, identified kind | No new approval writer or separate countdown mechanism. |
| Failure-template migration | One shared fixed correction contract | Old shell/edit correction overrides become invalid configuration with a specific migration message. |
| File-access controls | Start with internal bounded budgets | Avoid adding another public timing option unless reproductions demonstrate a need. Final timing values must be validated. |

Keep `reviewBash: true`, `reviewEdits: true`, `autoApprove: false`, and the existing
numeric defaults unless there is a separately justified change. The three new
switches bring the complete option example from 13 to 16 options if no additional
setting is introduced.

## 4. Scope boundaries and invariants

- This remains a pending-permission reviewer, not an interceptor for every tool
  invocation. Already-allowed operations and custom tools that do not call
  permission APIs may produce no reviewable request.
- Adding MCP coverage does not add general native `read`, `glob`, `grep`,
  `webfetch`, `websearch`, `task`, `skill`, or `doom_loop` assessment. Their
  associated directory checks are in scope; their independent operation
  permissions remain unsupported unless specifically identified as MCP/custom.
- Use only public TUI/SDK interfaces. Do not patch native dialogs, import private
  host modules, inspect private runtime UI, or initialize a host in a target
  directory to discover metadata.
- Native controls stay active. The writer remains restricted to `once`; never
  send `always` or `reject`, modify rules, apply edits, or execute operations.
- Do not contact MCP servers, execute custom tools, import their implementation
  modules, or fetch remote file contents to manufacture review evidence.
- Keep strict output JSON, non-streaming Chat Completions, redirect rejection,
  the HTTP response-size cap, and format-only retries.
- All static reviewer guidance belongs in Markdown prompt/contract files.
- Preserve request ordering, root-user provenance, shared deadlines, cancellation,
  partial-evidence handling, native-themed buttons, and lifetime persistence.
- A model-produced Safe result with partial evidence remains eligible under the
  existing policy. Do not introduce a hidden automatic veto or fabricate a rating.
  Missing mandatory request identity or mandatory action data is a review failure,
  not a completed partial-evidence assessment.

## 5. Proposed architecture and classification

### 5.1 Use explicit review kinds

Introduce a discriminated review model with these kinds:

```ts
type ReviewKind = "shell" | "edit" | "mcp" | "custom" | "external-directory"
```

Keep shared request identity, invocation location, user/session context, and
limitations in a common envelope. Give each kind its own payload rather than
pretending all tool arguments are shell commands or edit diffs.

Migrate internal shell evidence to an explicit kind. If existing test helpers
still omit `kind`, normalize at a single boundary while migrating them; avoid a
permanent collection of implicit shell fallbacks in every consumer.

### 5.2 Separate identification from evidence collection

Use an explicit classification result:

- Supported and enabled, with kind and validated linked invocation.
- Supported but disabled.
- Unrelated native permission.
- Candidate request whose identity/origin cannot be verified.

Suggested home: `src/classification.ts`, with host reads adapted in `src/tui.tsx`
and reusable context interfaces in `src/context.ts`.

Identification must:

1. Retain the exact permission request ID, session ID, permission string,
   patterns, proposed remembered patterns, metadata, and tool linkage.
2. Match session/message/call IDs to a running tool part and validate ownership.
3. Classify directory permission first, then native shell/edit, identifiable MCP
   operations, and verified custom tools.
4. Use public tool IDs/definitions and available MCP server information without
   assuming that every unknown permission or tool name is custom.
5. Recognize host MCP resource operations even when their permission is `read`.
6. Treat name collisions, ambiguous server mapping, missing parts, stale parts,
   and unsupported native tools explicitly. Never choose a prompt by guessing
   which interpretation is safest or most convenient.

For ambiguous origin, do not route an MCP operation through the custom category
merely because MCP reviews are disabled, or vice versa. Keep it manual. An
identifiable enabled category with insufficient evidence can show `Analysis
unavailable`; genuinely unidentified requests remain hidden ordering blockers,
consistent with the current controller's identification behavior.

### 5.3 Keep metadata enrichment optional

- Query only the existing invocation host instance.
- Obtain description/schema only where the public API makes it available.
- Bound catalog reads under the review deadline; use a per-review snapshot.
- Missing optional descriptions or schemas produce limitations, not invented
  definitions or a reason to execute a tool.
- Avoid a persistent catalog cache initially. If needed, key it by host/model
  context and establish a public invalidation strategy before using it.
- If the host cannot reliably distinguish some MCP/custom origins, document the
  unsupported cases rather than adding private APIs or speculative mappings.

### 5.4 Gate work before enrichment

If a permission kind can be determined from the request alone and is disabled,
skip identification reads as well. For ambiguous tool-backed requests, allow
only the minimum reads required to identify the category. Once disabled, skip
conversation traversal, evidence capture, optional catalog enrichment, and model
calls. If all relevant kinds are disabled, skip even that candidate lookup.

## 6. Prompt and contract layout

### Proposed source tree

```text
prompts/
  PERMISSION-REVIEW-PROMPT.md
  EDIT-REVIEW-PROMPT.md
  MCP-REVIEW-PROMPT.md
  CUSTOM-TOOL-REVIEW-PROMPT.md
  EXTERNAL-DIRECTORY-REVIEW-PROMPT.md
  EXTRA-CAREFUL-REVIEW-PROMPT.md

contracts/
  PERMISSION-REVIEW-CONTRACT.md
  PERMISSION-REVIEW-CORRECTION.md
```

Preserve existing shell/edit assessment filenames to avoid needless migration.
Remove the two correction files from `prompts/` after consolidating their common
format instructions into the fixed correction contract.

### Assessment prompt responsibilities

- **Shell:** execution effects, original command, actual launch location, supplied
  source snapshots, and uncertainty. Retain bash-only closing guidance to prefer
  Allow once. Remove directory-specific routing guidance now handled separately.
- **Edit:** proposed host diffs, paths, operations, omissions, and consequential
  changes. Do not imply that writing code executes it.
- **MCP:** exact tool/resource operation, server identity if known, destinations,
  recipients, data sent, remote mutations, destructive or shared-service effects,
  and uncertainty. Descriptions, annotations, and schemas are untrusted claims.
- **Custom tool:** actual pending allowance, supplied arguments and metadata,
  available tool definition, possible local/remote effects, and missing behavior
  knowledge. Do not claim that earlier custom-tool code has not run.
- **External directory:** current requested access and its originating operation,
  scope breadth, read/search versus mutation/execution, sensitive targets, and
  material uncertainty. Being outside the repository alone is not danger.
- **Extra careful:** apply existing shared guidance to all enabled kinds in auto
  mode without automation notices or modifications to the generating conversation.

All prompts assess the current one-time allowance. Preserve proposed `always`
patterns as metadata but do not treat them as existing grants or rate hypothetical
future permission choices. Only native bash execution includes the bash closing
line; new kinds do not inherit it accidentally.

### Fixed contracts and correction migration

- Expand the evidence/output contract to cover tool arguments, descriptions,
  schemas, resource URIs, permission metadata, and quoted prompts as untrusted
  evidence. The output stays exactly `safe` and nonempty `desc`.
- Keep one generic correction contract containing `{{validationError}}`. It asks
  for corrected format for the same evidence/allowance while retaining the
  category's original guidance.
- Remove category-specific correction fields from overridable `PromptSet`.
  `correctionPrompt(validationError)` reads the fixed template, not a supplied
  override. Keep literal placeholder substitution, including `$` characters.
- Reject the old `PERMISSION-REVIEW-CORRECTION.md` and
  `EDIT-REVIEW-CORRECTION.md` override names with actionable migration errors.
  Reject reserved contract overrides; do not silently pretend they are active.
- Keep startup-only loading, immutable snapshots, per-file fallback, absolute
  directory validation, UTF-8/NUL validation, regular-file checks, and the 64 KiB
  per-file limit for all six overridable prompt files.
- Use one explicit prompt/contract inventory, consumed by source loading and
  build embedding, to avoid divergent filename/directory rules. A small static
  manifest is sufficient; do not create a general templating framework.
- Failed custom prompt loading remains configuration failure. It must not be
  handled like an optional missing evidence file.

## 7. Evidence design and limits

### 7.1 Shared fields

Retain root/current sessions and projects, latest genuine root-user prompt,
invocation cwd/worktree, exact request identity/scope, and factual limitations.
Use the invocation path, never session origin, to resolve local relative paths.
Continue bounded ancestry/history traversal and registered-project reads.

### 7.2 MCP/custom payloads

Include:

- Exposed tool ID and verified kind, plus origin confidence/limitations.
- MCP server/resource identity or custom definition identity where available.
- Complete supplied invocation arguments when they fit the evidence budget.
- Exact permission operation and relevant host metadata. The tool name and
  permission name can differ and must both remain visible.
- Optional bounded description, schema, and annotations, each with availability
  status and source. Do not imply a description is verified implementation.
- Explicit notice that tool execution results are not available at this pending
  check. Do not issue a preview/dry-run invocation to obtain them.

Native shell/edit adapters must not process a custom tool solely because it asks
for a permission named `bash` or `edit`. Verify its originating tool before
choosing native evidence semantics.

### 7.3 Directory payloads

Include exact access scope, associated tool identity, and bounded operation
context. For shell, include the original command. For read/search, include the
actual target/pattern. For edit, include available target/operation metadata
without duplicating full new file contents or every diff just to review access.

Keep declared paths distinct from canonical local paths. Preserve raw patterns,
including wildcards. Do not expand globs, enumerate directory contents, read
target files, or normalize a remote resource into a local filesystem path.

Directory approval can resume the waiting operation immediately if its other
permissions are already allowed. The prompt must evaluate that possibility,
not assume a separate execution/edit/read prompt is guaranteed.

Each directory and subsequent operation request has its own identity, assessment,
limits, cancellation state, and full visible countdown, even for one tool call.

### 7.4 Budget rules

- Retain the existing shell command-plus-source and edit-diff byte semantics.
- For new tool/directory kinds, define `maxEvidenceBytes` over variable operation
  evidence: arguments/command, permission payload, and optional descriptions,
  schemas, and metadata. Document the category-specific accounting explicitly.
- Define mandatory action data by category: full invocation arguments for
  MCP/custom reviews, and the exact access scope plus relevant operation context
  for directory reviews. Directory evidence need not duplicate an edit body;
  identify such excluded content explicitly instead of calling the argument
  record complete.
- Reserve room for complete mandatory request scope and action data before
  optional definitions. If mandatory evidence does not fit, fail clearly rather
  than truncate a command, payload, or permission scope into a misleading action.
- Optional sections may be omitted as whole sections with reasons. Apply nesting
  and collection limits before recursive normalization of arbitrary tool JSON.
- Reuse common session/user provenance handling; do not copy whole messages,
  provider configuration, environment variables, or MCP connection credentials
  into evidence.
- User-supplied tool arguments may themselves contain private data. Document that
  these go to the configured reviewer before approval. Never silently transform
  action-bearing values and then represent them as complete original arguments.
- `maxFiles` remains a distinct local-file budget. It is not a limit on arbitrary
  JSON properties, directory patterns, or MCP resource counts. New categories do
  not automatically fetch referenced files.
- Preserve existing `[!]` omission notices and validated `[Δ]` edit counts.
  Never invent line counts for inaccessible or remote contents.

## 8. File-access and timeout investigation

### 8.1 Reproduce before selecting a fix

Build deterministic tests around an injectable filesystem adapter or equivalent
test seam. Cover separately:

1. Immediate `ENOENT`, `EACCES`, dangling symlinks, directories, FIFOs, and invalid
   UTF-8/binary files.
2. Stalled `realpath`, `open`, `stat`, `read`, and cleanup completion.
3. Stalled alias resolution before capture, including candidates beyond the
   file limit and repeated references.
4. Edit diffs already in memory while target-path canonicalization stalls.
5. Slow host identity, ancestry, project, or tool-catalog reads.
6. Reviewer connection/header/body stalls and format correction near the deadline.
7. Parent cancellation and deadline expiry at each stage, plus late resolution.
8. SSH/container paths and MCP resource URIs that should never trigger local
   source fetching.

Ask for an example command/error if available, but do not block reproducible
tests on access to the user's server. Real NFS/SSHFS verification is optional and
must be reported separately from injected stalled-I/O tests.

### 8.2 Preserve an overall deadline and bound optional work

Keep `timeoutMs` as one deadline for classification, context, evidence, HTTP, and
format corrections. Expose remaining time internally rather than starting a
fresh full timeout at every stage or file.

Provisional internal values to validate, not settled public defaults:

- Optional filesystem enrichment budget: at most 5 seconds and no more than
  one third of the remaining review time when that stage begins.
- Path canonicalization: at most 500 ms per attempt, subject to that shared
  enrichment budget.
- A file-capture transaction: at most 1.5 seconds, including its metadata and
  content operations, subject to both budgets.
- Maximum outstanding evidence-related filesystem probes owned by this plugin
  instance: a small fixed cap, initially two, validated against the actual
  adapter structure. Account separately for prompt loading and lifetime storage;
  this is not a promise to cap all filesystem activity in the host process.

Mandatory identity/arguments must still be verified. If they cannot be obtained,
show an unavailable analysis rather than sending guessed evidence to the model.
Optional ancestry/project/definition lookups should also have bounded waits and
explicit unknown values so they do not consume the entire model opportunity.

Do not promise a minimum provider response time. The aim is to prevent optional
file work from exhausting the review budget, not to extend the configured total.

### 8.3 Timeout results and accounting

- Distinguish optional evidence timeout, ordinary filesystem error, parent
  cancellation, and overall review timeout with typed internal outcomes.
- Missing or timed-out optional source becomes a factual omission. Continue with
  remaining evidence only while the overall request is active.
- Preserve complete host edit diffs when optional canonicalization fails. Use
  lexical path identity conservatively and mark unresolved alias equivalence.
- Count unresolved candidate paths conservatively against `maxFiles`; do not
  collapse distinct files because canonicalization failed. Resolved aliases
  still count once. Never normalize away symlink-sensitive `..` segments.
- Do not spend unbounded time canonicalizing every candidate after capture
  budgets have already been exhausted. Retain scope and explicit omissions.
- Treat remote-only paths as remote/unknown. A path on a local network mount is
  still a local filesystem access, but can stall and needs the same bounds.
- Parent cancellation must stop the review, not be converted into a harmless
  missing-file warning that allows the model request to proceed.

### 8.4 Avoid abandoned-work leaks

`Promise.race` alone is insufficient. Design and test ownership of underlying
operations:

- Count a filesystem slot as occupied until the actual operation settles,
  including after its caller has timed out.
- When all slots are occupied, skip optional probes with a clear limitation
  rather than enqueueing unbounded promises or launching more I/O.
- Do not start chained parent-directory fallbacks after the budget/parent has
  expired.
- If `open` resolves late, close the resulting handle. Handle close/read races
  and late rejections without unhandled promises or duplicate ownership.
- Never mutate published evidence or controller state from late completions.
- Controller disposal must return in bounded time even if the OS is still
  servicing an uninterruptible filesystem request. Document this limitation.
- Do not add worker/process infrastructure unless the reproduction shows the
  bounded in-process design is inadequate. Any isolation design requires its
  own packaging and cleanup review before adoption.

### 8.5 Diagnostics

Expose concise stage-specific failures, for example context lookup timeout,
evidence omission due to file access timeout, or reviewer response timeout.
Keep file omissions in evidence/report limitations, and review failures in the
existing unavailable UI. Do not leak raw API bodies or private diagnostics.

Use fixture-local stage timings to prove where time was spent. No new durable
content logs, automation messages, or accounting payload fields are needed.

## 9. Statistics display change

Render request usage and inline lifetime text in one condition tied to the
current completed assessment's valid aggregate `usage`.

| State | Request stats | Inline lifetime |
| --- | --- | --- |
| Loading/identifying | Hidden | Hidden |
| Analysis unavailable | Hidden | Hidden |
| Completed assessment without valid aggregate usage | Hidden | Hidden |
| Valid input/output counts, unknown pricing | Token line | Shown if lifetime text is available |
| Valid counts and known pricing | Token and cost lines | Shown if lifetime text is available |
| Lifetime storage unavailable, valid request usage | Request stats | Existing lifetime-unavailable text allowed in the same block |

- Use the assessment already attached to the current request. Never show a prior
  request's usage merely to make a lifetime line visible.
- Keep contiguous muted lines inside the report scrollbox, with no blank gap
  between request cost and lifetime cost.
- The lifetime palette command remains accessible without an active review.
- Continue accounting for completed valid-usage responses, including invalid
  assessments and correction attempts, even when no inline footer is displayed.
- Preserve missing-usage aggregation: one invalid/missing attempt suppresses the
  report's usage block, and therefore also its inline lifetime line.
- Preserve unpriced counts, partial pricing labels, atomic persistence, concurrent
  instances, and disposal flushing. No store-format change is needed.

## 10. Controller, approval, and UI integration

- Extend options and view identification to the new kinds without replacing the
  existing lifecycle machinery.
- Preserve the first native pending permission across root/direct-child sessions.
  Disabled, unrelated, and unidentified entries remain ordering blockers.
- Delay review display/countdown until kind identification and evidence/assessment
  are ready. Classification timeouts cannot expose a later request's panel.
- Preserve request-ID deduplication, revision-guarded reconciliation, aborts on
  reply/deletion/disposal, and the two-second read-only recovery interval.
- Auto mode uses the same fully visible Safe assessment, stable request-keyed
  panel, initial Markdown render gate, and fixed footer for every enabled kind.
- Preserve once-only single-flight submission, fresh identity/scope verification,
  permanent cancellation after visibility loss, and no automatic write retries.
- Keep verification/reply and recovery bounds separate from model timeout as
  currently documented. Native resolution can abort acknowledgement; never
  resurrect a resolved view or report a false failure afterward.
- Keep the OpenCode 1.18.34 permission button colors, padding, hover behavior,
  disabled appearance, and theme support from v0.2.3. This work does not require
  another button redesign.
- Native Always/rejection internal forms still require explicit Cancel before
  deliberation. Do not claim those private forms are public dialog events.

## 11. File-by-file implementation map

| File or area | Planned change |
| --- | --- |
| `src/types.ts` | Shared envelope and discriminated evidence/context types; explicit availability/omission fields. |
| `src/classification.ts` (new, if useful) | Public-data-based kind identification and enablement decisions. |
| `src/context.ts` | Reusable invocation validation and conversation provenance; MCP/custom/directory context adapters. |
| `src/evidence.ts` | Preserve shell/edit collectors and integrate new collectors; bounded optional enrichment. |
| `src/tool-evidence.ts`, `src/directory-evidence.ts` (proposed) | Focused new collectors if keeping everything in `evidence.ts` would obscure category rules. |
| `src/files.ts` | Bounded/cached canonicalization and conservative distinct-file accounting. |
| `src/file-access.ts` (proposed) | Filesystem operation ownership, local budgets, outstanding-work cap, and injectable test seam. |
| `src/reviewer.ts` | Explicit kind-to-prompt selection, fixed correction contract, phase-aware timeout integration; retain transport/usage behavior. |
| `src/prompts.ts` and shared static inventory | Six overridable prompts, two fixed contracts, immutable loading, migration errors. |
| `prompts/*.md`, `contracts/*.md` | Three new category prompts, updated shell/common guidance, consolidated correction contract. |
| `src/config.ts` | Three validated switches and agreed defaults; preserve unknown-key rejection. |
| `src/controller.ts` | New kind gating/identification while preserving ordering and approval lifecycle. |
| `src/tui.tsx` | Public metadata adapters, dispatch, and request-usage-gated lifetime rendering. |
| `src/approval.ts` | Audit identity/scope checks through existing callers; retain the once-only transport interface. |
| `src/usage.ts`, `src/lifetime.ts`, `src/lifetime-view.tsx` | Verify compatibility; change only if needed for UI integration, not accounting semantics. |
| `scripts/build.mjs` | Embed the shared prompt/contract inventory with the universal OpenTUI transform. |
| `scripts/smoke.mjs` and fixture helpers | Local MCP/custom tools, directory stages, failure/usage states, and new prompt assertions. |
| `scripts/smoke-runtime.mjs` | Reuse private-socket supervised sessions; extend only if fixture cleanup needs it. |
| `test/*.test.ts` | Classification, evidence, timeout, config, prompt, transport, lifecycle, and usage regression coverage. |
| `README.md` | Coverage, complete config, prompt migration, data sent, timeout behavior, lifetime gating, correct installation/update path. |
| `AGENTS.md` | Replace shell-only directory and overridable-correction rules; document new invariants and fixture scenarios. |
| `package.json`, `package-lock.json` | New runtime commands if needed; final version/description updates when releasing. |
| `scripts/check-package.mjs`, release workflow | Verify new bundle contents and existing release checks; only change mechanics if required. |

Prefer small cohesive modules. Proposed new module names are organizational
suggestions, not a requirement to create abstractions that duplicate existing code.

## 12. Test and fixture matrix

### Unit and component-level verification

**Classification/context:** native kinds; MCP wildcard permissions with empty
metadata; MCP resources under `read`; custom tools with arbitrary or native-like
permission strings; sanitized-name ambiguity; missing/stale/mismatched parts;
disabled kinds; optional catalog failure; root prompt provenance; invocation versus
session directory; direct-child sessions; unsupported native permissions.

**Evidence:** nested arguments and hostile text; bounded descriptions/schemas;
mandatory over-budget payloads; optional omissions; exact scope preservation;
directory read/search/edit/shell operations; remote URI/path handling; no accidental
source reads or remote calls; fresh budgets for consecutive permission stages.

**Prompts/contracts:** per-kind dispatch; all six override files; fallback and
immutable startup snapshot; rejected legacy correction/contract overrides;
placeholder substitution; fixed output contract on every kind/attempt; extra-careful
guidance only in auto mode; bash-only closing guidance remains bash-only.

**Timeouts:** immediate errors versus never-settling operations; optional stage
budget and hard global deadline; resource saturation; late `open` cleanup; abort
propagation; no late evidence mutation; in-memory edit diffs survive optional path
failures; no unhandled rejections or unbounded queue growth.

**Controller/approval:** kind gating and ordering; disabled kinds start no
enrichment/model work; per-request countdowns; visibility/cancel invariants;
request identity/scope changes; stale recovery; once-only writes; uncertain reply
reconciliation; parent cancellation never becomes a completed assessment.

**Usage/UI:** all rows in the display table above; lifetime seeded from earlier
requests while the current request loads/fails/has no usage; one format attempt
missing usage; unknown pricing; independent palette access; unchanged accounting
of invalid completed assessments.

### Real-TUI fixtures

Add deterministic scenarios using isolated temporary files and local servers:

| Scenario group | Required observations |
| --- | --- |
| MCP tool | Correct category/prompt and exact arguments; no invocation before its approval; one harmless fixture invocation after once. |
| MCP resource | `read` permission reaches MCP review; server/URI are preserved; resource is not read by the reviewer. |
| Custom tool | Custom permission name and arguments survive; pre-permission fixture activity is not falsely described as blocked. |
| External read/search | Directory review is visible; the fixture can demonstrate continuation without a guaranteed second permission check. |
| External edit | Directory and edit stages get separate IDs, prompts, diffs, and countdowns when both are pending. |
| Disabled/ambiguous | No model call for disabled kinds; unrelated/ambiguous first requests block later panels and stay manual. |
| Correction | Invalid first assessment uses the fixed correction contract for each new category. |
| Auto/manual | Safe once-only completion, Unsafe/unavailable remain manual, cancellation and visibility loss retain existing behavior. |
| Statistics | No standalone lifetime during loading, missing usage, or failure; valid usage and lifetime share the muted block. |
| Stalled evidence | UI remains responsive and shows omission or phase-specific failure within its budget. Use deterministic injected stalls where a real mount is impractical. |

Reuse the IPC supervisor and private tmux socket for every session/restart. Own
and close fixture HTTP/MCP processes through fixture cleanup; do not leave a
secondary server behind when the fixture owner is interrupted. Never use broad
process-name cleanup or a shared tmux server.

The user previously stopped lengthy full-TUI runs. Default to a documented focused
matrix plus affected existing regressions. Broaden only for a concrete unresolved
lifecycle concern, and report exactly which scenarios ran. Fixtures verify host
mechanics, not a live model's safety judgment.

## 13. Implementation sequence and exit criteria

### Milestone 1: capability and failure reproduction

- Confirm switch/default and directory-migration decisions.
- Establish a public-API capability matrix for MCP/custom origin and definitions.
- Reproduce the lifetime-only footer and distinguish filesystem/host/HTTP stalls.
- Identify any cases that cannot be supported without private host access.

Exit: executable reproductions or fixtures identify the failure modes, and the
classification design states exactly what can and cannot be verified.

### Milestone 2: prompt and data foundations

- Introduce review kinds and shared identity/provenance types.
- Add three assessment prompts and the fixed correction contract.
- Migrate prompt loading/build embedding and update correction tests/fixtures.
- Add configuration switches with the agreed behavior.

Exit: source/build prompt inventories agree, overrides cannot replace contracts,
and existing shell/edit prompt behavior passes focused regressions.

### Milestone 3: bounded filesystem enrichment

- Implement the operation/budget test seam and ownership rules.
- Fix capture/canonicalization stalls and conservative file counting.
- Add stage-specific timeout outcomes and prevent unbounded background work.
- Verify in-memory edit evidence can survive optional filesystem failures.

Exit: stalled optional I/O cannot consume the entire default review budget or
accumulate unbounded work; global abort still prevents review completion.

### Milestone 4: new review categories

- Implement classifier, linked invocation reads, and evidence collectors.
- Move every directory request to the dedicated category/prompt.
- Wire new kinds into controller/TUI dispatch and existing approval lifecycle.
- Exercise MCP resources and custom tools that use nonmatching permission names.

Exit: supported pending requests receive the correct evidence/prompt, while
disabled, unsupported, and ambiguous requests retain correct ordering/manual state.

### Milestone 5: statistics display

- Gate inline lifetime on valid current-request aggregate usage.
- Add real-render assertions for loading, failure, missing usage, and valid usage.
- Verify palette access and cumulative accounting independently.

Exit: no standalone lifetime footer in any request state and no accounting
regression. This small milestone can be implemented earlier if convenient.

### Milestone 6: integration, documentation, and package readiness

- Run the focused test matrix, fix failures, and update maintainer instructions.
- Update README coverage/options/migration/privacy/timeout/statistics sections.
- Verify all five distributable files and deterministic build embedding.
- Review diff for accidental installation dependencies, credentials, or runtime
  artifacts. Keep the repository free of an `opencode-reviewer` self-dependency.

Exit: the acceptance checklist below is satisfied with a recorded test summary.

## 14. Documentation and release procedure

### Documentation updates

- Keep README focused on installation and behavior; use this document and
  `AGENTS.md` for development detail.
- List all supported kinds and the important limitation that only pending
  permissions are reviewed.
- Show every configuration option, with each closing brace/bracket on its own
  line. Distinguish example values from defaults.
- Explain the new independent directory switch and its migration consequence.
- List the six customizable prompt files and identify fixed contracts separately.
- Explain how to remove legacy correction overrides and restart after changes.
- Explain arguments/metadata sent to the reviewer and the lack of automatic
  remote content fetching.
- Describe missing files, optional evidence timeouts, and whole-review timeouts
  separately, including conservative alias counting after lookup failure.
- Explain that inline lifetime requires request usage; palette totals do not.
- Include prefix-specific npm installation instructions so updates reach the
  bundle actually referenced by `tui.json`.

### Verification commands

Run appropriate focused tests while implementing. Before release:

```sh
npm run check
npm run test:runtime-cleanup
npm run check:package
git diff --check
```

Run the selected native fixtures after building, using OpenCode 1.18.34 via
`OPENCODE_BIN` when needed. Use `npm ci --ignore-scripts` for a clean dependency
setup when required, not as a substitute for inspecting local user changes.

Keep exact package contents:

```text
dist/tui.js
package.json
README.md
LICENSE
THIRD_PARTY_NOTICES.md
```

Prompts/contracts stay embedded; implementation plans, tests, fixtures, source,
and captures do not become additional distribution files.

### Release only when requested

1. Inspect status, full intended diff, recent commits, and remote changes.
2. Integrate remote maintainer changes without overwriting local work.
3. Update both version manifests using:
   `npm version 0.3.0 --no-git-tag-version`, if v0.3.0 is still the chosen version.
4. Run release checks against the final intended package metadata.
5. Stage only intended changes, commit, create the matching `v` tag, and push.
6. Publish the GitHub release. The published-release event triggers the packaging
   workflow; pushing a tag alone does not upload an asset.
7. Verify workflow success and the exact uploaded `.tgz` before announcing a
   working update command.
8. Report actual verification coverage and required configuration/prompt migration.

For the installation path observed in the user's `tui.json`, the planned update
command after v0.3.0 is published is:

```sh
npm install --prefix "$HOME/.local/share/opencode-command-reviewer" --save-exact --allow-remote=all --ignore-scripts https://github.com/mightykatun/opencode-reviewer/releases/download/v0.3.0/opencode-reviewer-0.3.0.tgz
```

Verify with:

```sh
npm ls --prefix "$HOME/.local/share/opencode-command-reviewer" opencode-reviewer --depth=0
```

Recheck the configured path at release time. The directory retains its old name
even though the package is `opencode-reviewer`. Do not install the tarball in the
source checkout and mistake that for updating the configured plugin. Quit and
restart OpenCode after the update and configuration/prompt migration.

## Execution record

- [x] Milestone 1: capability and failure reproduction.
  - Installed binary reports `1.18.34`; public SDK provides `tool.ids` and
    model-specific `tool.list`. Pinned host routes return registry definitions,
    not a full MCP tool catalog. Classification will cross-check registry IDs,
    configured/connected server names, linked invocation, and host permission
    shape; ambiguous prefixes/collisions remain manual. MCP definitions unavailable
    through the public SDK remain explicitly unavailable.
  - Baseline stalled-read probe: missing file returned `ENOENT` evidence; a held
    `FileHandle.read` exhausted a 100 ms overall deadline and retained the descriptor
    until late completion. Late completion closed it. Probe lives outside the repo
    in `/tmp/opencode/reviewer-stall-probe.mts`; permanent regressions follow in
    Milestone 3.
  - Real TUI `error --seed-lifetime` passed its existing assertions and reproduced
    the display bug: its baseline capture contained `Reviewer HTTP 503` followed
    by standalone `lifetime: $0.0100` with no request stats. The same
    `.runtime/error-pending.txt` path was regenerated by the fixed regression run.
- [x] Milestone 2: prompt and data foundations.
  - Added explicit evidence kinds, three opt-in switches, three dedicated prompts,
    one fixed correction contract, and a shared JSON source/build inventory.
  - Migrated correction overrides to explicit errors and adapted existing fixtures.
  - Typecheck, all 307 then-existing tests, and build passed. Added wire-level
    new-kind prompt/correction coverage; the updated prompt/reviewer subset passed
    all 97 tests with zero failures.
- [x] Milestone 3: bounded filesystem enrichment.
  - Added shared remaining-time deadlines, optional context budgets, and per-review
    filesystem scopes with a 5 s/one-third budget, 500 ms canonicalization,
    1.5 s capture, and two outstanding transactions per access owner.
  - Slots remain occupied through late cleanup. Saturation skips optional work;
    expired budgets do not enqueue fractional probes. Edit diffs survive stalled
    canonicalization using explicit conservative alias accounting.
  - Typecheck, all 320 tests, and build passed. Twelve new tests exercised held
    realpath/open/stat/read/close, late cleanup and rejection, parent abort,
    saturation/recovery, shared budgets, edit preservation, special files,
    SSH/container discovery, and stalled optional conversation context.
- [x] Milestone 4: new review categories.
  - Added public registry/connected-server classification, one linked invocation
    snapshot, bounded MCP/custom/directory collectors, and controller/TUI dispatch.
    Native-like custom permission names use custom evidence; MCP resources under
    `read` use MCP evidence. Collisions and unknown origins stay manual/hidden.
  - Typecheck, 332 tests, and build passed. Real OpenCode fixtures passed MCP,
    MCP resources, custom tools, custom `bash` permission, external read/search,
    separate directory/edit countdowns, correction for all three categories,
    disabled modes, cancellation, Unsafe, and HTTP failure. Existing `auto-external`
    and `edit` fixtures also passed, including lifetime palette/restart checks.
  - Directory evidence deliberately remains metadata-only: exact host scope and
    operation context are retained, with an explicit notice that canonical targets
    were not inspected. This avoids treating remote/custom paths as local targets
    and avoids unnecessary I/O for the directory-access review itself.
- [x] Milestone 5: statistics display.
  - Inline lifetime now lives inside the current assessment's valid-usage block.
    Cumulative recording and the palette dialog remain independent.
  - Typecheck/build passed. Eight seeded-ledger TUI cases passed: held loading
    with missing usage, native HTTP failure, custom HTTP failure, one missing
    correction usage record, valid correction totals, unpriced request totals,
    and storage failure with/without valid request usage. Dialog checks verified
    accounting despite hidden inline stats and explicit corrupted-store errors.
- [x] Milestone 6: integration, documentation, and package readiness.
  - Final review tightened shared JSON value accounting, accessor-free copying,
    MCP resource scope checks, and monotonic deadline enforcement
    even when synchronous work delays timer delivery. Prompt cancellation also
    stops late follow-up I/O.
  - Final plan reconciliation found that native-looking permission strings could
    show loading before a disabled custom origin was identified. All candidates
    now start hidden/identifying until their enabled category is confirmed;
    the new regression, full unit suite, native-like custom disabled fixture,
    immediate approval fixture, and stalled-file fixture all passed after this fix.
  - Added `stalled-file` native TUI fixture. It passed with a stalled evidence
    open: the command palette remained usable and the model received an explicit
    file-capture timeout omission in under five seconds. This uses the built
    bundle's read-only adapter seam, not a real remote mount or patched host globals.
  - Added focused runtime npm command, full 16-option README/migration guidance,
    updated maintainer rules, and an unreleased `RELEASE_NOTES.md` draft.
  - Pre-audit verification: 338 unit tests passed, typecheck passed, four supervisor
    cleanup tests passed, and the focused real-TUI matrix below passed. Native
    fixtures use the pinned OpenCode 1.18.34 binary. No live remote-mount behavior
    is claimed.
  - Pre-audit reproducible bundle SHA-256:
    `7800df4d258fcd3c5bf132b346f7b5f21dc65005e7f357de048fa7f6eed3bb99`.
    That package check included exactly five intended files, 167756 bytes unpacked.
    Tracked diff whitespace review passed; release packaging includes no source,
    fixture, plan, release-note draft, or runtime-capture files.
  - The subsequent audit below reopened completion; its fixes and final checks
    are now verified. The user authorized a local checkpoint and minor release
    tag, with no push. Both manifests now identify v0.3.0. Publishing and
    installation remain separate steps.

### Follow-up implementation audit

The careful review reproduced three gaps despite the earlier passing matrix.
All three corrections and the final checks are now verified below.

- [x] Retain native patch-directory operation types, paths and move destinations.
  Added bounded header-only summaries, explicit mandatory-summary failures, and
  partial coverage for omitted native edit bodies. Typecheck, 20 focused tests,
  build, `external-patch --auto --correction`, and `external-edit --auto` passed.
  The patch fixture verified deletion after directory-only approval with edit
  permission already allowed; no patch body was sent as directory evidence.
- [x] Match MCP resource server/URI strings verbatim, as the pinned host does.
  Removed the incorrect trimming assumption and replaced the normalization test
  with exact matching, optional-server and mismatch regressions. Typecheck, 15
  focused tests, build, `mcp-resource --auto`, and
  `mcp-resource --auto --resource-whitespace` passed. The real host preserved spaces
  in both the configured server name and resource URI through review and execution.
- [x] Keep optional conversation waits outside the filesystem enrichment budget.
  Shell context now finishes optional host lookups before its first filesystem
  probe. Added pipeline regressions for slow, timed-out and canceled conversation
  reads. Typecheck, 70 focused tests and build passed. A production-timing probe
  captured a real local source after the five-second context timeout with about
  25 seconds remaining. Real `stalled-file` and `auto-immediate` fixtures passed.
- [x] Refresh final unit/runtime/package verification and release-note records.
  `npm run check` passed typecheck, all 348 tests and build. All four runtime
  cleanup tests passed. Six affected native TUI combinations passed during these
  fixes: external patch/correction, external edit, ordinary and whitespace MCP
  resources, stalled-file, and immediate approval. The historical focused matrix
  now has 33 distinct combinations; the full legacy runtime suite was not rerun.
  Reproducible packaging includes exactly five intended files, 171477 bytes
  unpacked. Final bundle SHA-256:
  `c884fb8b956add95ed1066a608cbcb5211ca144e75c51b2a321d457aedebe866`.
  Diff whitespace review passed. Release notes now include the audit corrections.

### Focused native verification matrix

Thirty-three distinct scenario/flag combinations passed during implementation. Repeated
runs after relevant fixes are not counted twice. Captures and requests are in
ignored `.runtime/` files named after the scenario and flags.

`scripts/smoke-permissions.mjs`:

```text
mcp --auto --correction
custom --auto --correction
external-read --auto --correction
mcp-resource --auto
mcp-resource --auto --resource-whitespace
mcp --disabled --auto
custom-bash --auto
custom-bash --disabled --native-bash-enabled --auto
custom --disabled --auto
external-edit --auto
external-patch --auto --correction
external-read --disabled --auto
external-search
custom --auto --cancel
external-read --auto --unsafe
mcp --auto --error
mcp --held --no-usage --stats
custom --error --stats
mcp --correction --missing-usage --stats
mcp --held --correction --stats
custom --unpriced --stats
mcp --storage-error --stats
mcp --storage-error --no-usage --stats
custom --correction --stats
```

`scripts/smoke.mjs`:

```text
auto-external
edit
error --seed-lifetime
auto-fullscreen
auto-immediate
patch
external-disabled
stalled-file
edit-config-error
```

## 15. Final acceptance checklist

- [x] New defaults and directory compatibility behavior are explicitly decided.
- [x] MCP, custom tools, and directory access each use their dedicated prompt.
- [x] MCP resource permissions under `read` route correctly when identifiable.
- [x] Arbitrary custom permission names do not bypass tool-origin verification.
- [x] Unsupported/ambiguous operations stay manual and preserve pending ordering.
- [x] Exact one-time scope and action evidence are retained or fail explicitly.
- [x] New evidence is bounded and does not execute tools or fetch remote contents.
- [x] All directory origins are supported as specified, including edit preflight.
- [x] Directory approval is not misrepresented as always having a second gate.
- [x] Correction guidance is fixed in `contracts/` and migration errors are clear.
- [x] Existing shell/edit, transport, once-only approval, and usage invariants pass.
- [x] Missing source normally yields an omission, not a whole-review failure.
- [x] Stalled optional I/O is bounded with conservative fallback and owned cleanup.
- [x] Remote-only paths/URIs are never mistaken for local capture targets.
- [x] Global aborts and late results cannot resurrect a review or approve a request.
- [x] Inline lifetime never appears without valid current-request usage stats.
- [x] Palette totals and completed-response lifetime accounting remain correct.
- [x] README, AGENTS, configuration examples, fixtures, and build inventory agree.
- [x] Typecheck/tests, focused native fixtures, cleanup, and packaging checks pass.
- [x] Release notes state tested coverage and migration steps accurately (unreleased draft).

## 16. Source references for implementation

- Local baseline: `src/context.ts`, `src/controller.ts`, `src/evidence.ts`,
  `src/files.ts`, `src/prompts.ts`, `src/reviewer.ts`, `src/tui.tsx`, and
  `src/lifetime-view.tsx` at v0.2.3.
- Host revision used for the capability inspection:
  `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`.
- [Host tool permission routing](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/session/tools.ts).
- [Custom-tool registry](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/tool/registry.ts).
- [Public experimental tool route](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts).
- [MCP identifier handling](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/mcp/catalog.ts).
- [OpenCode permission documentation](https://opencode.ai/docs/permissions/).

These references guide compatibility research. They do not authorize imports of
private host internals into the plugin.
