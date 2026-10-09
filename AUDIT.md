# Consolidated Codebase Audit and Fixing-Agent Handoff

## Execution tracking

Implementation starts from `0aaf9d6`. Checkboxes require passing evidence, not an intended fix. Findings retain their original observations below; implementation notes record changed behavior. Commits are local checkpoints, not publication.

- [x] Preparation
  - [x] Read this plan completely; no implementation checkmarks existed.
  - [x] Read referenced implementation, tests, fixtures, workflows, package metadata, and both audit reports across explicitly scoped preparatory reviews.
  - [x] Derive the sequential work packages and regression boundaries below.
- [x] W1: approval boundaries (A01, A02, A04)
  - [x] Add failing dispatch-microtask and stale-verification regressions, including notification/fact consequences.
  - [x] Separate pre-dispatch reservation from actual dispatch; retain bounded fresh verification and durable cancellation/uncertainty.
  - [x] Prove actual heading/footer/report geometry; add short-height cancellation and restoration regressions.
  - [x] Pass focused approval/controller/fast/history-cover checks, typecheck, and build.
  - [x] Pass real short-height, normal approval, fast retained report, mode, and history-cover fixtures; record outputs.
  - [ ] Commit the verified W1 checkpoint.
- [ ] W2: evidence identity (A03, A05, A06, A24)
  - [ ] Match absolute launch workdir normalization to the pinned host and verify actual/decoy capture.
  - [ ] Invalidate unsupported physical shell/trap/time cwd inference with explicit evidence limitations.
  - [ ] Preserve quoted skill paths, consume link destinations whole, and compare main-file identity canonically.
  - [ ] Enforce atomic no-follow prompt overrides with valid-link and swap regressions.
  - [ ] Pass focused evidence tests and required real shell/skill fixtures after build; record outputs and commit.
- [ ] W3: persistence and actual operation ownership (A07, A08, A09)
  - [ ] Derive compatible serialized metadata bounds; prove legacy baseline and unrelated-root FIFO recovery.
  - [ ] Separate local maintenance progress from external invalidation; prove linear cleanup and healthy reconciliation.
  - [ ] Bound/coalesce actual ancestry operations through timeout, reopen, late settlement, and disposal.
  - [ ] Pass SQLite/controller composition tests and storage/maintenance/statistics/mode host fixtures; record outputs and commit.
- [ ] W4: notification admission, delivery, and navigation (A10-A15)
  - [ ] Own icon-worker rejection immediately and retain eventual cleanup.
  - [ ] Recover only eligible event-born question admission after metadata/capacity recovery.
  - [ ] Gate questions on healthy permission ordering and publish reconciliation atomically.
  - [ ] Schedule bounded actionable audio and banner/process work with explicit overflow, fairness, and abort ownership.
  - [ ] Acquire click generation at action receipt and invalidate superseded activation/navigation.
  - [ ] Pass notification composition/saturation/race tests and queue/fast/history host fixtures; record outputs and commit.
- [ ] W5: publication and archive correctness (A16, A17, A25)
  - [ ] Bind explicit signed provenance to verified release source/archive and independent workflow identity, with offline actual-npm coverage.
  - [ ] Preserve pending release runs with bounded platform queuing and unchanged semantic channel policy.
  - [ ] Verify the exact six-category sound mapping in emitted and packed bundles.
  - [ ] Pass helper, reproducibility/archive, and npm 12.2.0 smoke checks without publishing; record outputs and commit.
- [ ] W6: maintainability, fixture reliability, and scoped maintenance (A18-A23, A26-A28)
  - [ ] Inventory runtime entrypoints/scenarios and add a pinned-host CI selection with host-independent completeness checks.
  - [ ] Share atomic serialized observation publication and selected-result/postcondition palette synchronization.
  - [ ] Extract smoke scenario descriptors/families while preserving independent assertions and planning mode.
  - [ ] Replace positional reviewer/controller injection with named dependencies and a distinct historical replay adapter.
  - [ ] Extract the corrected live panel with explicit lifecycle ownership and stable request keying.
  - [ ] Align compatibility/docs, remove confirmed unused interfaces/output/legacy routes, and evaluate compatible dependency updates.
  - [ ] Pass aggregate/package/helper and representative real-host checks for changed surfaces; record outputs and commit.
- [ ] Final integration
  - [ ] Reconcile every A01-A28 item with implemented changes or an evidence-backed disposition.
  - [ ] Run final required checks, inspect diff/status, verify plan marks and commit history, and report exact remaining limitations.

### Execution notes and resolved plan mismatches

- `test/history-controller.test.ts` covers controller/history lifecycle facts; actual browser ancestry composition also requires `test/history-browser.test.ts`.
- The available editing tool is `apply_patch`; it is used for plan checkbox updates as well as source changes.
- A28 is compatibility evaluation, not an instruction to force incompatible major upgrades. OpenTUI 0.4.5 declares exact Solid 1.9.12 peers; any update must respect that verified host boundary.

### Phase verification ledger

**W1:** dispatch/revision regressions initially failed 26 of 154 cases, then passed; expanded approval/fast/controller/notification-controller/history-controller/history-coordinator/pending-refresh/history-cover suite passed **282/282**. Geometry suite passed **4/4**; `npm run typecheck` and `npm run build` passed. Final host runs passed:

```text
node scripts/smoke-approval-geometry.mjs initially-short  PASS .runtime/approval-geometry-initially-short-3CVR2j
node scripts/smoke-approval-geometry.mjs resize           PASS .runtime/approval-geometry-resize-1ljTIC
node scripts/smoke-approval-geometry.mjs history-short    PASS .runtime/approval-geometry-history-short-dyGTf6
node scripts/smoke.mjs auto-shell                       PASS one native execution
node scripts/smoke-fast-mode.mjs complete               PASS retained response/notification target/history
node scripts/smoke-session-mode.mjs                     PASS disable/enable/tombstone/persistence/resume
node scripts/smoke-history-auto.mjs covered             PASS actual Markdown readiness/one execution
```

W1 implementation details: at most three sequential verification reads share the original five-second reservation budget. Exhausted stale-read churn stays silent until an accepted fresh reconciliation releases it; it does not create a cancellation/uncertain-write tombstone. Actual list ownership survives caller timeout. Actual dispatch markers precede transport invocation without intervening observer callbacks; dispatch facts follow invocation. Geometry requires a painted proof of heading/rating/report/footer bounds and actual footer descendants. Same-frame child replacement can reuse that proof only with identical viewport/container identities and dimensions; the next frame revalidates descendants. The initially-short host regression exposed and verified the fix for the Checking-to-Allowing branch-replacement transition.

## 1. Scope, provenance, and status

- **Audited commit:** `0aaf9d6184f7de5f705e46bbf1881987657d0fbe`, package version `1.0.0`.
- **Consolidated:** 2026-10-10. The supplied notification audit is dated 2026-10-09.
- **Verified host target:** Linux OpenCode **1.18.35**. Development verification used Node.js **24.21.0** and npm **12.2.0**.
- **Sources:** the entire 726-line [NOTIFICATION-AUDIT.md](NOTIFICATION-AUDIT.md), the whole-codebase review in this session, and the underlying specialist review results and reproductions from that session.
- **Scope:** approval/controller/UI lifecycle, evidence and filesystem boundaries, model transport, history/statistics, notification ordering/delivery/audio/navigation, build/publication, dependencies, documentation, source tests, and fixture infrastructure.
- **Implementation status:** execution in progress. Tracking above records verified completion; unchecked findings remain open. Original audit evidence is retained as the baseline.
- **Reference stability:** source line numbers refer to the audited commit. Follow the named symbols when edits move the code.
- **Deduplication:** the desktop-click race was independently found by both reviews and appears once as A14. Audio saturation and banner/process saturation remain separate because their admission points, consequences, and required fixes differ. Related shell and skill failures are grouped with explicit subcases.

**Overall assessment:** the codebase has substantial defensive engineering and meaningful tests. The highest-risk defects are at component boundaries: eligibility versus actual approval dispatch, panel hit testing versus visible controls, and host path resolution versus captured evidence. Other important failures concern recoverable state being made permanently manual or silent, timeout wrappers losing actual operation ownership, and release metadata identifying a different commit from the packaged source.

### Evidence terminology

- **Host-confirmed:** reproduced inside the actual pinned OpenCode TUI with the production bundle and permission transport.
- **Source-reproduced:** production source classes/functions exercised with controlled promises, clocks, SQLite, temporary files, or fake process transports. Establishes the stated mechanism, not its production frequency.
- **Reported source reproduction:** reproduced by the supplied notification audit; relevant implementation was inspected during consolidation, but that reproduction was not independently rerun during document creation.
- **Static/contract finding:** established by implementation, call-site inspection, or documented platform behavior; no end-to-end failure is claimed.
- **Maintenance/coverage observation:** actionable debt or a missing regression boundary, not a claim that the current runtime is defective in every such path.

### Verification already completed

| Check | Result and scope |
| --- | --- |
| `npm run check` | Passed: typechecking, **861 source tests**, **77 pure-helper tests**, build |
| `npm run check:package` | Passed: two reproducible builds and actual archive containing exactly the five intended files |
| `node --test test/release-artifact-smoke.test.mjs test/npm-cli-smoke.test.mjs` | **6 passed**; npm CLI checks used npm 12.2.0; no publication |
| `npm run test:runtime-cleanup` | **6 passed**; supervisor interruption/isolation, not full plugin TUI coverage |
| `npm audit --json` | **0 known vulnerabilities** in the returned advisory data |
| `npm outdated --json` | Reviewed; dependency observations are in A28 |
| Notification audit's four-file source run | **80 passed**: notification order, policy, host, and controller tests |
| Focused review reproductions | Evidence mismatches, notification failures, SQLite migration/scheduling, ancestry ownership, and npm provenance behavior reproduced as described below |
| Short-height native fixture | **Host-confirmed** at 160x40 -> 160x8; hidden countdown/Cancel followed by one native `once` reply and one harmless command execution |

The 80 notification tests overlap the larger source suite; do not add them to 861 as unique coverage. Specialist agents also ran overlapping focused suites, which are not presented as additional unique tests. Documentation consolidation did not rerun implementation tests. The full real-host matrix, live-model judgment, physical sound playback, and GNOME focus were not validated by these aggregate results.

## 2. Severity-ranked inventory

P1 is a high-priority approval/evidence boundary defect. P2 is a significant correctness, reliability, scaling, publication, or maintenance issue. P3 is lower-priority contract alignment, interface cleanup, or planned dependency work. The **kind** column distinguishes defects from coverage and maintenance work.

| ID | Priority | Kind | Finding | Original source |
| --- | --- | --- | --- | --- |
| A01 | P1 | Defect | Final approval eligibility check occurs before deferred transport invocation | NA-01 |
| A02 | P1 | Defect | Vertical resize hides Cancel while normal auto-approval remains armed | Session finding 1 |
| A03 | P1 | Defect | Absolute workdir normalization differs from the host and captures the wrong script | Session finding 2 |
| A04 | P2 | Defect | Unrelated revision churn permanently fails an otherwise eligible Safe approval | NA-02 |
| A05 | P2 | Defect | Shell discovery retains an incorrect cwd through physical-mode and in-process constructs | Session finding 3 |
| A06 | P2 | Defect | Skill references can capture decoys or omit supporting files with `partial: false` | Session finding 4 |
| A07 | P2 | Defect | Valid legacy metadata exceeds the baseline reader's serialized-size limit and blocks writes | Session finding 5 |
| A08 | P2 | Defect | Maintenance restarts its scan after its own deletions, multiplying work and gating history | Session finding 6 |
| A09 | P2 | Defect | Ancestry timeout wrappers release apparent ownership before host reads settle | Session finding 7 |
| A10 | P2 | Defect | Early cancellation leaves background icon-preparation rejection unhandled | Session finding 8 |
| A11 | P2 | Defect | Shared audio capacity silently drops actionable sound-only notifications | NA-03 |
| A12 | P2 | Defect | Event-born questions are never readmitted after ancestry failure/capacity recovery | NA-04 |
| A13 | P2 | Defect | Question delivery can outrun the initial permission baseline | NA-05 |
| A14 | P2 | Defect | Older desktop activation can override the latest notification click | NA-06 + session finding 9 |
| A15 | P2 | Defect | Banner/process capacity permanently discards eligible notifications | Session finding 10 |
| A16 | P2 | Defect | Manual release provenance identifies the workflow commit instead of packaged source | Session finding 11 |
| A17 | P2 | Defect | Release concurrency replaces pending versions rather than preserving the queue | Session finding 12 |
| A18 | P2 | Coverage | Real-TUI scenarios lack a complete inventory and representative CI execution | Session finding 13 |
| A19 | P2 | Fixture reliability | Observation JSON is published non-atomically with overlapping writes | Session finding 14, file publication |
| A20 | P2 | Fixture reliability | Palette activation uses sleeps or search-input text as readiness proof | Session finding 14, UI synchronization |
| A21 | P2 | Maintainability | `reviewTui` combines service composition with nested live-panel lifecycle | Session finding 15, TUI |
| A22 | P2 | Maintainability | Main smoke driver duplicates scenario knowledge across distant branches | Session finding 15, fixtures |
| A23 | P3 | Maintainability | Positional reviewer/controller injection obscures dependencies and historical replay | Session finding 15, interfaces |
| A24 | P3 | Contract defect | Prompt overrides follow valid symlinks despite the documented restriction | Session cleanup |
| A25 | P3 | Coverage | Package verification checks four of six bundled notification sounds | Session cleanup |
| A26 | P3 | Documentation | Compatibility claim and a host-version comment exceed or lag the verified target | Session cleanup |
| A27 | P3 | Cleanup | Unused exports/output and a legacy helper route remain after refactors | Session + specialist observations |
| A28 | P3 | Dependency planning | Several exact pins lag available versions; no advisory-backed vulnerability found | Session dependency review |

## 3. Behavioral contracts fixes must preserve

Read [AGENTS.md](AGENTS.md) before implementing. These constraints are directly relevant to the proposed changes:

1. **Approval remains advisory by default and once-only when enabled.** Use the invocation host directory. Do not add `always`, `reject`, permission-rule writes, command execution, or edit application to the plugin.
2. **Normal approval requires all gates:** final validated Safe assessment, final highlighting, matching painted frame, presentation, native priority, enabled conversation mode, and countdown. A Safe rating alone is insufficient.
3. **Fast approval is opt-in and distinct:** `fastMode` plus `autoApprove`; a parsed Safe preview is sufficient only with streaming, physical visibility, and native priority. No history-cover exception. With `stream: false`, wait for a complete validated response.
4. **Cancellation and uncertainty are durable.** Explicit Cancel or actual visibility loss after countdown start makes a request manual for the controller lifetime, including remount/re-enable. Never retry an approval write with an uncertain outcome.
5. **Pre-dispatch reservation is not dispatch.** Observer facts, fast retention, irreversible-write tombstones, and acknowledgement ownership must reflect the actual transport boundary. Read-side recovery retains the original deadline and must not bypass fresh request equality or queue checks.
6. **Native ordering includes silent blockers.** Disabled, unsupported, baseline, identifying, and otherwise notification-ineligible permissions still precede questions. Use `pendingViews`, not retained fast reports, as pending native work.
7. **Pinned native input scope:** roots and direct children, code-unit session order, then pending request order within a session. Deeper descendants are covered by conversation mode but do not acquire native root-input notification eligibility in this host.
8. **Births and baselines differ.** Only new events authorize notification episodes. Startup/resume snapshots establish blockers and reconciliation, never replay eligibility. Unknown baseline ordering must not be treated as an empty queue.
9. **Safe requests awaiting automation are silent.** Queue position, rendering, or an unstarted countdown is not evidence of a manual problem. Countdowns/submission are silent; approval sounds require confirmed automatic success.
10. **Deferred delivery remains request-owned.** Resolution, queue loss, deletion, and disposal invalidate pending attention banners, sounds, reminders, and stale navigation. Handoff gets an initial notification, then a full reminder interval. Queues/process counts stay bounded.
11. **Preserve special retained-fast lifecycle.** After actual dispatch/confirmation, navigation or mode disable cannot unsend approval; report completion/validation and attribution still follow the existing rules. Deletion/disposal still abort retained work.
12. **Preserve physical presentation proof.** One stable slot root with live/history siblings; key the live panel by request ID. Scrolling must not cancel countdowns. Production history is the only normal-mode cover exception, using its actual hit-test proof. Native dialogs still cancel.
13. **Evidence remains bounded data.** Match the host's invocation semantics; retain exact mandatory arguments; omit optional evidence whole with factual limitations. Do not evaluate shell, recurse through scripts/skills, fetch URLs, or broaden skill containment. Partial evidence alone is not an automatic veto.
14. **Timeout is not settlement.** Keep actual I/O/process ownership through completion and cleanup even if caller-visible promises time out. Observer, notification, and persistence errors cannot change review/approval outcomes.
15. **History/accounting invariants remain transactional.** Do not reconstruct lifetime totals from detail rows, reduce totals on deletion, skip admitted FIFO operations casually, or reset corrupt databases. Migration fixes must not add UI upgrade/history-format warnings.
16. **Release privilege separation remains intact.** Package/build/test only in validation; publish the exact validated archive using immutable policy helpers. No upload retries, backward channel movement, dependency installation from project code in the privileged job, or archive-verification bypass.
17. **UI and tests:** fixed copy belongs in `src/ui-text.ts`; independent expected wording in behavioral tests; no em dashes. Diagnostics remain fixed labels/timings/local numeric correlations without prompts, IDs, paths, credentials, or model text.

### Cross-cutting implementation model

Two state distinctions should be explicit in fixes:

- **Approval:** eligible -> reserved/checking -> fresh verification -> actual dispatch -> confirmed/uncertain. A01 collapses reservation into dispatch too early; A04 treats stale pre-dispatch reads like failed writes. A02 feeds a false presentation proof into both. Fixing only one layer leaves the others intact.
- **Notifications:** event birth -> admitted target -> native blocker eligibility -> pending delivery -> actual delivery/closure. A12 loses admission recovery, A13 grants eligibility before baseline readiness, A11/A15 lose delivery under capacity, and A14 begins click ordering after asynchronous work. Retrying delivery must never recreate a birth or bypass eligibility.

**Existing audio timing:** policy decides whether a message requests sound. Banner-plus-sound delivery prepares audio before starting `notify-send`, then starts playback after receiving the notification ID. Sound-only starts playback without desktop acknowledgement. Approval sound requests are limited to one every two seconds; there is currently no cross-kind priority scheduler. A11 changes capacity scheduling, not eligibility or confirmed-success timing, and A15 must coordinate process availability without silently changing these channel semantics.

## 4. High-priority defects

### A01. Final approval guard precedes deferred transport invocation

**Priority:** P1. **Evidence:** reported source reproductions in NA-01, implementation inspected. **Owner:** approval lifecycle. **Related:** A02, A04, A14.

**Locations:** [`src/controller.ts:284-315`](src/controller.ts#L284-L315) (`approveNow`), [`108-111`](src/controller.ts#L108-L111) (`suspend`), [`157-166`](src/controller.ts#L157-L166) (`cancelAutoApproval`), [`src/deadline.ts:35-39`](src/deadline.ts#L35-L39).

**Failure mechanism:** `approveNow` publishes `allowing`, checks eligibility synchronously, records dispatch, marks `approvalDispatched`, and in fast mode sets `fastApproval = "pending"`. It then invokes `withDeadline`, whose callback runs in a later promise microtask. Visibility, priority, or mode can change before the callback calls `approval.once`. That callback does not recheck eligibility. `allowing` is already outside the states accepted by `cancelAutoApproval`, and `suspend` preserves entries marked as fast-dispatched even though no transport call has happened.

**Reproduced interleavings:** schedule a microtask from the `allowing` publication that (a) clears the visible ID and calls `presented()`, (b) disables conversation mode in fast mode, or (c) inserts an earlier native blocker. The audit observed an actual fake-transport write and automatic confirmation after the corresponding eligibility loss. Frequency in ordinary host event scheduling was not measured.

**Impact:** the write boundary can cross approval eligibility restrictions. Associated notification/history/accounting facts then describe a write that should have been prevented.

**Implementation direction:**

1. Keep a pre-dispatch single-flight reservation distinct from irreversible dispatch.
2. Inside the callback that actually invokes `once`, recheck abort/deadline, active entry identity, request identity/scope, mode, native ordering, and current presentation.
3. Move dispatch facts and dispatch-only markers to this boundary. Avoid another `await` or deferred callback between final validation and invocation; synchronous observer reentrancy also needs consideration.
4. `eligible()` currently rejects `entry.fastApproval`; simply calling it after setting the old marker would suppress all fast writes. Reorder the state transition rather than adding a blind check.
5. Preserve the bounded acknowledgement across native resolution and the already-dispatched fast-report lifecycle. Prevented writes must settle as not sent, without confirmation or retained-as-dispatched state.

**Acceptance/regressions:** in `test/approval.test.ts` and `test/fast-mode.test.ts`, use `queueMicrotask` from publication to hide, disable, insert a higher-priority direct child, resolve, delete, and dispose before invocation. Each produces zero writes and no confirmation. Unchanged state produces exactly one write. Visibility/mode changes after real invocation preserve existing acknowledgement/retention semantics. Include observer facts, history attribution, and notification output, not only a write counter.

### A02. Vertical resize hides countdown controls without canceling approval

**Priority:** P1. **Evidence:** host-confirmed. **Owner:** TUI presentation. **Related:** A01, A18, A21.

**Locations:** [`src/tui.tsx:426-428`](src/tui.tsx#L426-L428) (`ownsPanelProbes`), [`455-475`](src/tui.tsx#L455-L475) (`visible`), [`517-559`](src/tui.tsx#L517-L559) (panel layout); downstream countdown at [`src/controller.ts:238-247`](src/controller.ts#L238-L247).

**Failure mechanism:** two fixed-coordinate hit tests accept any panel descendant, not the actual heading/footer controls. The height check permits four rows. Resizing preserves `paintedAssessment`/`readyAssessment`, so prior readiness survives a layout in which the footer is clipped. A coordinate intended to represent the footer can now hit another part of the panel.

**Real-host reproduction:** OpenCode 1.18.35, normal auto-approval, 12-second configured delay, `fastMode: false`, `stream: false`, notifications disabled. At 160x40 the report/countdown/Cancel were visible. Resize to 160x8 without approval input. The same 42x8 production panel remained mounted at `(118, 0)`, with `physical: true`, `eligible: true`, `covered: false`, `auto: "countdown"`. Countdown and Cancel were absent from every post-resize sample. One native `once` reply occurred about 12.93 seconds later; the harmless marker command ran once about 13.09 seconds later.

**Evidence artifacts:** `.runtime/short-height-native.mjs` and `.runtime/short-height-native-N9OnGo/{REPRO.md,results.json,before-resize.txt,after-resize.txt,past-expiry.txt,screens.json,observations.json}`. The observation seam supplied no synthetic cover or eligibility override. Only resize-during-countdown at eight rows was host-tested; four rows, initially short layouts, fast mode, other themes, and newer hosts remain unverified.

**Implementation direction:** track actual heading/rating/footer renderables and verify their required bounds against the visible viewport. Require accessible normal-mode cancellation controls and usable report height. Apply layout validity independently of the history-cover exception; preserve cover hit testing for occlusion. Send layout failure through `controller.presented(undefined)` so restoring size cannot revive a canceled countdown. Do not replace this with an arbitrary minimum height without testing the actual layout, wrapping, and footer variants.

**Acceptance/regressions:** resize wide-but-short during countdown; expect zero approval writes and durable cancellation after restoring height. Test initially short layout, wrapped footer variants, usable report viewport, and history cover at insufficient height. Keep ordinary scrolling, valid history coverage, zero delay, and stable Markdown identity working. Extend a real fixture: the existing `auto-narrow` case at `scripts/smoke.mjs:552-566` tests width/sidebar disappearance rather than vertical clipping.

### A03. Absolute workdir normalization selects a different file than the host

**Priority:** P1. **Evidence:** source/filesystem reproduction and pinned-host algorithm comparison. **Owner:** invocation context/evidence. **Related:** A05, A06.

**Locations:** [`src/context.ts:114-117`](src/context.ts#L114-L117), [`130-133`](src/context.ts#L130-L133), capture at [`src/evidence.ts:19-24`](src/evidence.ts#L19-L24). Host reference: [ShellTool at v1.18.35](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/tool/shell.ts).

**Trigger:** `/project/link -> /outside/deep`, absolute `workdir = /project/link/..`, command `python job.py`. The pinned Linux host uses lexical `path.resolve(root, text)` for absolute and relative launch directories, selecting `/project`. The reviewer preserves the absolute operand, so filesystem traversal selects `/outside` and captures `/outside/job.py`.

**Observed:** collector returned the outside marker while execution using the host's normalized cwd ran the project marker. This is deterministic, not a file-change race.

**Impact:** a reviewer can assess unrelated contents and omit the actual executed script; pre-approval evidence may also transmit an unrelated file. A misleading Safe assessment is a risk, not a live-model outcome demonstrated by the marker reproduction.

**Implementation direction:** normalize absolute launch workdirs with the host's lexical rules while preserving `requestedWorkdir` verbatim in evidence. Keep missing invocation cwd unknown where it is required. Do not apply lexical normalization indiscriminately to source operands: ordinary operands with symlink-sensitive `..` need filesystem semantics, as A05/A06 illustrate.

**Acceptance/regressions:** exercise `loadContext` through collection using an absolute symlink/parent workdir and distinct decoy/actual files; compare to pinned host resolution. Retain relative-workdir-versus-session-directory tests, unknown invocation location behavior, and existing symlink-sensitive operand coverage. Current ordinary-absolute test at `test/context.test.ts:195-209` and direct-collector symlink tests do not cover this boundary.

## 5. Correctness, reliability, scaling, and publication defects

### A04. Global revision churn permanently fails an otherwise eligible Safe approval

**Priority:** P2. **Evidence:** reported deterministic reproduction in NA-02. **Owner:** controller/pre-dispatch recovery. **Related:** A01, A09, A13. **Symptom:** directly reproduces Safe + attention alert + no automatic approval.

**Locations:** [`src/controller.ts:274-279`](src/controller.ts#L274-L279), [`337-354`](src/controller.ts#L337-L354), [`358-374`](src/controller.ts#L358-L374), [`432-435`](src/controller.ts#L432-L435); attention classification at [`src/notification-policy.ts:24-36`](src/notification-policy.ts#L24-L36).

**Interleaving:** A is Safe, visible, and front-of-queue. While its fresh `permission.list` is held, B arrives in an unrelated root or behind A. The instance-wide revision changes despite unchanged A eligibility. A's stale read is correctly rejected, but the catch path converts that pre-dispatch invalidation to a permanent `failed`/manual tombstone. Recovery confirms A pending; `approvalPendingConfirmed` makes the policy emit attention. Presentation, another `approveNow`, and ordinary reconciliation do not rearm A.

| Reproduction | List reads | Writes | Outcome |
| --- | ---: | ---: | --- |
| No concurrent event | 1 | 1 | Approved, no attention |
| Unrelated-root request during verification | 2 | 0 | Safe, failed, pending confirmed, attention |

**Impact:** parallel subagents or unrelated conversation activity can stall a healthy automatic queue. Slower verification increases the opportunity. This does not imply every historical Safe-but-manual report had this cause.

**Implementation direction:** distinguish stale pre-dispatch verification from actual cancellation/loss of eligibility and from dispatched failed/uncertain writes. For stale reads, allow bounded fresh verification within the original verification deadline, rechecking full equality, scope, native priority, mode, and presentation. Do not remove revision guards, use the stale list, extend deadlines, clear true cancellation/uncertainty tombstones, or retry a write. Bound both retry count/work and actual read ownership; coordinate with A09 rather than launching replacement reads that merely outlive wrappers.

**Acceptance/regressions:** unrelated-root and later same-root events recover to one approval with no attention. An earlier blocker, changed same-ID arguments, resolution/deletion, explicit cancellation, mode change, or visibility loss prevents dispatch according to the existing durable policy. Sustained churn has bounded reads/deadline. Uncertain writes never retry, even across re-enable. Deliberately revise the existing `test/approval.test.ts` parameterized `new request / unknown reply / unknown deletion invalidates an outstanding fresh snapshot by revision` expectations only for the approved pre-dispatch recovery cases; retain proof that stale snapshots cannot erase new requests. A standalone original-behavior reproduction is in Appendix B.

### A05. Shell discovery retains a falsely known cwd through unmodeled semantics

**Priority:** P2. **Evidence:** differential source/Bash reproductions. **Owner:** literal shell discovery. **Related:** A03, A06.

**Locations:** [`src/shell-discovery.ts:260-263`](src/shell-discovery.ts#L260-L263) (`cd` inference), [`278-286`](src/shell-discovery.ts#L278-L286) (state/control-flow classification), [`326-347`](src/shell-discovery.ts#L326-L347) (interpreter flags), [`367-380`](src/shell-discovery.ts#L367-L380) (dispatch).

**A05a: physical-directory options disappear.** `bash -P -c 'cd link/.. && python3 job.py'` and `bash -o physical -c 'cd link/.. && python3 job.py'` accept and discard relevant options, then infer nested `cd` with lexical `path.resolve`. With `/project/link -> /outside/deep`, discovery collects `/project/job.py`; Bash executes `/outside/job.py`.

**A05b: in-process constructs fall through.** `trap 'cd /outside' DEBUG; python3 job.py` installs a cwd-changing trap, but `trap` is absent from the invalidation set. `time cd link && python3 ../job.py` executes `cd` in the current shell, but discovery treats `time` as an ordinary executable and misses the cwd transition. Both captured decoys in the reproduction.

**Impact:** unsupported semantics yield positive but incorrect source associations. The generic warning that preceding statements may change files does not describe this deterministic directory-resolution error.

**Implementation direction:** carry relevant shell options into nested scanning, or conservatively invalidate cwd inference when physical mode is active. Mark trap installation as an unmodeled in-process change. Support bounded `time [-p]` unwrapping with builtin semantics or invalidate cwd for it. Keep tokenization bounded; never invoke a shell to discover production evidence. Do not resolve unknown relative targets against the original cwd as a fallback.

**Acceptance/regressions:** add each command above with actual/decoy markers and independent expected paths/omissions to `test/evidence.test.ts`. Cover combined flags where the parser already accepts them, and verify explicit limitations rather than successful wrong captures. Existing accepted-option tests (`29-57`) and state-change tests (`357-383`) omit these semantics; direct `cd -P` rejection alone is insufficient. Preserve supported simple `cd ... &&`, source-read limits, and parent cancellation.

### A06. Skill reference parsing captures decoys or silently omits supporting guidance

**Priority:** P2. **Evidence:** full collector reproductions. **Owner:** skill evidence. **Related:** A03, A05, A24.

**Locations:** [`src/skill-evidence.ts:18-25`](src/skill-evidence.ts#L18-L25), [`36-48`](src/skill-evidence.ts#L36-L48), [`81-98`](src/skill-evidence.ts#L81-L98).

| Subcase | Input and filesystem | Observed wrong result |
| --- | --- | --- |
| A06a: quoted punctuation | Main text says ``Read `notes.md!`.``; both `notes.md!` and decoy `notes.md` exist | Captures `notes.md`; trailing prose-punctuation stripping also runs inside quoting |
| A06b: unsupported Markdown destination | `[reference](foo(bar).md)` with intended file plus decoy `.md` | Regex skips unsupported structure and discovers the `.md` fragment as a filename |
| A06c: lexical main-file exclusion | `skill/link -> skill/nested/deep`; main text references `link/../SKILL.md`; actual file is `skill/nested/SKILL.md` | `path.resolve(declared) === path.resolve(skill.location)` skips the different supporting file before filesystem identity checks |

All reproduced collectors returned **`partial: false`**, without the relevant omission limitation. Main instructions still came from the exact host catalog; the defect is in supporting-file association/completeness.

**Impact:** the model may receive an unreferenced file or miss supporting guidance while evidence appears complete. This contradicts the direct-reference description in `README.md:137-140` and `prompts/SKILL-REVIEW-PROMPT.md`.

**Implementation direction:** preserve literal quoted/code-span filenames. Restrict prose cleanup to unquoted tokens. Parse supported link destinations as whole constructs; unsupported balanced-parenthesis syntax must produce a factual limitation instead of permitting fragment discovery. Make main-file exclusion identity-aware under bounded filesystem scope, without rereading main instructions from disk. If identity cannot be established, record an omission. Retain canonical-directory and opened-descriptor containment, `maxFiles` accounting for the main skill, whole-file byte limits, and cancellation propagation.

**Acceptance/regressions:** collector tests with intended and decoy files for each subcase; decoys must never be captured. Internal symlink-plus-parent traversal must not be confused with the main file. Unsupported syntax yields partial evidence/limitations, not a fabricated reference. Preserve quoted spaces, simple links, URL rejection, outside-directory rejection, ancestor-swap protection, and built-in skills without local directories. Tests currently cover simpler references (`test/skill-evidence.test.ts:44-48`) and escapes/swaps (`50-81`), not these combinations.

### A07. Writer-valid legacy metadata fails baseline size limits and blocks the FIFO

**Priority:** P2. **Evidence:** real in-memory SQLite and production scheduler reproductions; historical validator inspected. **Owner:** history schema/migration. **Related:** A08, A18.

**Locations:** [`src/history-schema.ts:128-153`](src/history-schema.ts#L128-L153), [`171-190`](src/history-schema.ts#L171-L190); [`src/history-records.ts:57-58`](src/history-records.ts#L57-L58), [`78-81`](src/history-records.ts#L78-L81), [`109`](src/history-records.ts#L109); [`src/history-store.ts:183-190`](src/history-store.ts#L183-L190); `reportedModel` at [`src/usage.ts:13-14`](src/usage.ts#L13-L14).

**Trigger:** retained history has no materialized conversation baseline. Admission permits a 4,096-UTF-8-byte reported model with non-NUL controls; serialization can expand each control to six ASCII bytes. The baseline SQL exposes `accepted`/`finalized` JSON only at <=16,384 bytes. A model `"x" + "\u0001".repeat(4095)` produced a **24,642-byte** finalized record. Escaped controls on the provider JSON wire are valid; literal unescaped controls would not be.

**Observed:** baseline read failed with `Invalid history record`. Every mutation first runs `ensureConversation(root)`, so a mutation for that root failed too. With it ahead of another root's event, only the first apply was attempted, both stayed pending, and new admissions returned false. Disposal discards remaining queued events; committed history remains intact.

**Reachability/limits:** reproduction seeded events through current `encodeEvent`/`apply`, dropped the entire `conversation_totals` table, then reconstructed `HistorySQL`, which recreated an empty table. This simulates pre-feature retained data; it did not run an old application binary. The source before statistics commit `be1da72` already accepted the same reported-model controls. A fresh current database with materialized totals does not fail merely by receiving this string. This is an unusual provider-metadata/upgrade trigger, not an observed normal provider model name.

**Implementation direction:** derive and share serialized upper bounds from admission shapes, including worst-case escaping and envelope overhead. Audit analogous writer/reader bounds rather than changing only one magic number. Preserve validation of genuinely corrupt records, transactionality, FIFO replay semantics, and lifetime totals. Tightening future admission alone does not repair valid retained records; handle compatibility internally without new UI notices or destructive reset.

**Acceptance/regressions:** maximum escaped model metadata in both accepted and finalized retained rows; missing baseline recreated and readable; subsequent events for affected and unrelated roots commit. Include exact boundary/one-over invalid cases. Extend `test/conversation-statistics.test.ts:95-125` and a `HistoryStore` scheduler composition test. Do not fix by silently skipping a failed admitted transaction or inventing zero usage.

### A08. Maintenance restarts after every local deletion, causing multiplicative work

**Priority:** P2. **Evidence:** real SQLite plus production maintenance logic, synthetic exact host envelopes. **Owner:** history maintenance. **Related:** A07, A19.

**Locations:** [`src/history-maintenance.ts:40-51`](src/history-maintenance.ts#L40-L51), [`58-85`](src/history-maintenance.ts#L58-L85); [`src/history-store.ts:90-97`](src/history-store.ts#L90-L97), [`172-174`](src/history-store.ts#L172-L174).

**Mechanism:** `remove()` calls `markMaintenanceDirty()`, which increments the revision. The next step detects its own revision change, empties its page, resets its cursor, and starts at the beginning. A surviving prefix is rechecked for each absent session. Once dirty, normal history reads remain gated until a healthy pass completes.

**Reproduced scale:** 110 indexed sessions, last 10 absent -> **1,110 host lookups**, **1,111 maintenance turns**. After the first deletion, the gate stayed dirty for another **1,010 turns**. At two seconds per turn that is at least **33m40s**, excluding request latency. This is a scheduler-derived duration, not a real-host elapsed measurement.

**Implementation direction:** distinguish self-generated successful cleanup from external invalidation. Advance the current pass, invalidate cached rows affected by root cascading, and retain a final complete healthy reconciliation and the external revision publication guard. Account for deletion admission/commit failure; local intent alone cannot clear the gate. Retain exact pinned 404-envelope validation, root-first deletion, bounded pages, one actual host/read transaction, and totals remaining available as designed.

**Acceptance/regressions:** long surviving prefix + multiple missing roots/children + page boundaries; assert a linear lookup bound and eventual gate release. Include external revision changes, failed deletion admission, asynchronous commit, root cascade invalidating page members, unknown/error envelopes, and stalled reads. Existing `test/history-maintenance.test.ts:94-119` separates pagination and deletion rather than combining them.

### A09. Deadline-wrapped ancestry does not retain actual host-read ownership

**Priority:** P2. **Evidence:** production composition with a noncooperative metadata reader. **Owner:** ancestry API/controllers. **Related:** A04, A12.

**Locations:** [`src/history-controller.ts:41-57`](src/history-controller.ts#L41-L57), [`src/statistics-controller.ts:53-75`](src/statistics-controller.ts#L53-L75), [`src/history-coordinator.ts:46-47`](src/history-coordinator.ts#L46-L47), [`src/session-mode.ts:94-117`](src/session-mode.ts#L94-L117).

**Mechanism:** statistics waits for its `worker` before releasing `lookup`, but production `HistoryCoordinator.root` returns `SessionModes.root`, whose promise is already raced against abort/deadline. That promise can settle while `this.session(...)` is unresolved. History also starts replacement ancestry work on reopen without owning the old underlying read. The wrapper's settlement is not physical operation settlement.

**Observed:** 25 rapid opens produced 25 unsettled underlying reads, separately for history and statistics. All were later released and cleaned up. Operational impact depends on stalled/delayed cancellation; no such occurrence was claimed in the real host.

**Implementation direction:** carry an actual-settlement handle through ancestry, similar to `HistoryRead.settled`, or bound/coalesce at the lowest metadata-read layer. Keep newest-request selection separate from capacity ownership, ignore late results, and release slots only on actual completion/cleanup. Audit other callers of the same wrapped ancestry API, including notification lookup admission, when changing the contract; those adjacent paths were not separately reproduced as this finding.

**Acceptance/regressions:** test controller -> coordinator -> session-mode -> noncooperative reader composition; reopen storms, deadline retries, late resolve/reject, close/dispose, and newest-selection recovery. Assert outstanding reads never exceed the chosen bound. The raw unresolved-promise test at `test/statistics-controller.test.ts:79-90` masks the production wrapper. Keep disabled/invalid review compatible with history/statistics browsing and preserve ancestry depth/ownership validation.

### A10. Early cancellation leaves icon-preparation failures unhandled

**Priority:** P2. **Evidence:** source reproduction, independently rerun during the whole-codebase review. **Owner:** notification resource ownership. **Related:** A09, A11, A15.

**Locations:** [`src/notification-icon.ts:67-78`](src/notification-icon.ts#L67-L78), [`src/deadline.ts:35-42`](src/deadline.ts#L35-L42).

**Mechanism:** `NotificationIcon.file()` starts the filesystem worker before the deferred `withDeadline` callback consumes it. Immediate cancellation makes that callback throw before attaching to the worker. A later `mkdtemp` or `writeFile` rejection has no handler until eventual disposal.

**Observed:** public call returned `undefined`; Node emitted `unhandledRejection: simulated ENOSPC`, followed by a late-handled warning when disposal attached. No pinned-host crash was tested; application termination depends on runtime rejection handling.

**Implementation direction:** attach rejection consumption immediately when creating/storing every background worker, independently of caller deadlines. Preserve the original promise/result semantics as needed and eventual cleanup ownership. Cancellation should stop that caller's wait, not abandon shared work or delete temporary state while writes are still running. Avoid a global change to `withDeadline` merely to mask this local ownership error.

**Acceptance/regressions:** cancel synchronously after `file()` and reject deferred `mkdtemp`/`writeFile`; no unhandled rejection, no post-disposal result, cleanup completes after settlement. Include callers sharing a worker and a stopped/already-aborted call. `test/notification-icon.test.ts:6-38` currently tests rendering, not this worker lifecycle.

### A11. Audio saturation silently drops actionable sounds

**Priority:** P2. **Evidence:** reported production-class playback-capacity reproduction in NA-03. **Owner:** audio scheduling. **Related:** A10, A12, A13, A15.

**Locations:** [`src/notification-audio.ts:88-102`](src/notification-audio.ts#L88-L102), [`src/notification-linux.ts:32-37`](src/notification-linux.ts#L32-L37), [`src/notification-policy.ts:165-172`](src/notification-policy.ts#L165-L172).

**Trigger/observed:** keep two fake player results unsettled for `approved` and `ended`, using prepared-cache dummy files. Request `unsafe`; `play()` returns immediately at `active >= 2`. Release the first players: Unsafe is never queued or retried. All types share these slots. Approval's two-second policy rate limit does not prevent collisions with longer sounds or other kinds.

**Impact:** banner+sound loses sound; sound-only plus `staleReminderSeconds: 0` loses the entire actionable notification episode. Reminders can encounter the same contention. Multiple independently visited roots make simultaneous completion/approval/attention plausible. No physical playback was performed in this reproduction.

**Implementation direction:** introduce bounded, abortable playback scheduling with explicit precedence for attention/Unsafe/question over routine approval/completion. Define cross-root fairness and routine coalescing as policy decisions, not assumptions already guaranteed by the code. Capacity exhaustion must remain distinguishable from successful completion. Preserve all master/per-kind controls, confirmed-success-only approval sounds, and the existing rate limit. Queue admission/dispatch must recheck request cancellation; do not use an unbounded queue or extra unbounded players. Consider preparation and process-pool capacity in the combined design, but only the active-playback cap was reproduced here.

**Acceptance/regressions:** two held routine players followed by actionable sound-only -> eventual playback while still eligible, without a reminder. Queue loss/resolution/deletion/disposal -> no later sound. Multiple roots -> documented bounded fairness. Disabled channels stay disabled. Player failures remain observational. Test the policy/backend path in `test/notification-linux.test.ts`, not just `play` in isolation. Coordinate with A15 so audio capacity and desktop process capacity cannot each independently discard the same request.

### A12. Failed or capacity-limited question admission has no recovery path

**Priority:** P2. **Evidence:** reported failed-lookup/recovered-metadata reproduction in NA-04; capacity reaches the same branch. **Owner:** notification host admission. **Related:** A09, A11, A13.

**Locations:** [`src/notification-host.ts:155-163`](src/notification-host.ts#L155-L163) (`lookup`), [`203-216`](src/notification-host.ts#L203-L216) (`admit`), [`116-120`](src/notification-host.ts#L116-L120) (healthy polling), [`232-242`](src/notification-host.ts#L232-L242) (permission-only readmission).

**Interleaving:** visit root; receive a fresh child question while child metadata is missing; root lookup rejects once; metadata later gains `parentID`; three healthy two-second polls still show the question. The host retains its request, but no policy entry/target is created. Polling updates blockers without retrying admission. The two-lookup cap also returns without scheduling recovery. `session.created` can retry, but ordinary later metadata recovery is not guaranteed to emit that event.

**Observed:** `lookups: 1`, one native pending question, known parent `root`, and zero notifications. This is not an audio failure; the event never reaches delivery policy.

**Implementation direction:** retry only still-pending, unadmitted event-born questions on healthy reconciliation, relevant metadata updates, or bounded lookup-capacity release. Preserve original object/birth sequence and visited-root eligibility. Coalesce retry triggers, cap concurrency, and retain actual ownership as required by A09. Do not create births from poll snapshots or revive resolved/deleted/pre-visit requests.

**Acceptance/regressions:** one failed lookup followed by healthy metadata/polls -> exactly one initial notification when actionable. Three or more simultaneous unknown-child questions recover after capacity release. Recovery while behind another blocker admits state but delays delivery until handoff, then starts the full reminder interval. Resolution/deletion/disposal defeats late admission; baseline-only and pre-visit questions remain silent. Use `test/notification-host.test.ts` with policy output assertions.

### A13. Question delivery can precede the initial permission baseline

**Priority:** P2. **Evidence:** reported startup-state reproduction in NA-05. **Owner:** notification/controller baseline integration. **Related:** A04, A12, A18.

**Locations:** [`src/notification-host.ts:129-141`](src/notification-host.ts#L129-L141), [`src/tui.tsx:247-256`](src/tui.tsx#L247-L256), [`318-325`](src/tui.tsx#L318-L325).

**Interleaving:** a native permission predates plugin activation. The initial question list succeeds while the controller's asynchronous initial permission refresh is held. A root is visited and a fresh question arrives. `blockers()` has neither a controller view nor a birth event for the baseline permission; only question readiness has an explicit gate. The question alerts while the public native permission state still contains the prior blocker. A later permission refresh may withdraw delivery but cannot undo a sound/banner already emitted.

**Impact:** startup/attachment recovery with concurrent work violates permission-before-question ordering. Cold audio preparation can mask a short window but is not a correctness mechanism.

**Implementation direction:** establish trustworthy permission ordering before question delivery, through a permission-baseline readiness/health signal or complete public pending-permission state for the root/direct-child scope. Use public host APIs and revision guards. Unknown or failed ordering is not an empty queue. Baseline permissions remain silent blockers and must never gain event-birth eligibility. Coordinate policy/snapshot publication atomically so a successful baseline does not momentarily expose stale outcomes.

**Acceptance/regressions:** hold initial permission read while question birth follows a healthy question baseline; existing root and direct-child permissions, including disabled/unsupported kinds, suppress question banners and sounds. Failed/event-raced permission refresh remains conservative. A healthy empty baseline allows the fresh actionable question; resolving a silent baseline permission hands off exactly one initial alert and a full reminder interval. Baseline questions remain silent. Test the host bridge and controller integration, not only pure ordering.

### A14. Desktop activation completion reorders notification clicks

**Priority:** P2. **Evidence:** independently reproduced by both audits using fake desktop processes. **Owner:** backend/host click ownership. **Related:** A01, A02, A09.

**Locations:** [`src/notification-linux.ts:88-105`](src/notification-linux.ts#L88-L105), [`src/notification-terminal.ts:18-31`](src/notification-terminal.ts#L18-L31), [`src/notification-host.ts:315-347`](src/notification-host.ts#L315-L347).

**Interleaving:** click old approval banner A; hold its first GNOME `GetSubsearchResultSet`. Click B; let activation complete and open B. Release A; its callback opens A over B. Targets remain individually correct; their callback order becomes `[new, old]`. Higher-level latest-click logic starts only after activation and cannot reconstruct original user-action order.

**Impact:** latest intended conversation/report selection is replaced by an older click. A route change could also interrupt another countdown, but that secondary consequence was not exercised. Physical GNOME focus behavior was not tested.

**Implementation direction:** assign generation/ownership at receipt of the `"default"` desktop action, before awaiting token/EOF/activation. Invalidate older activation work and check ownership before navigation. Ordering only at EOF is insufficient because process exit can itself reorder actions. Preserve token parsing, exact session/permission history identity, dialog deferral, unfinished fast-report selection, hidden five-second save wait, and missing-report behavior. Reconcile route/deletion/withdrawal/disposal invalidation across the backend-host boundary; do not replace an exact target with newest history.

**Acceptance/regressions:** hold A, finish B, finish A -> no later A navigation. Test approval then ordinary click and reverse, delayed notify-send EOF, route changes, deletion, disposal, activation failure, and dialogs deferring only the surviving click. Existing `test/notification-linux.test.ts:70-86` preserves per-banner identity but does not hold overlapping activation chains open.

### A15. Banner and process capacity permanently discard eligible delivery

**Priority:** P2. **Evidence:** policy saturation and production process-pool reproductions. **Owner:** notification delivery/backpressure. **Related:** A10-A14.

**Locations:** [`src/notification-policy.ts:126-143`](src/notification-policy.ts#L126-L143), [`198-202`](src/notification-policy.ts#L198-L202), [`212-213`](src/notification-policy.ts#L212-L213); [`src/notification-process.ts:18-19`](src/notification-process.ts#L18-L19); [`src/notification-linux.ts:94`](src/notification-linux.ts#L94); [`README.md:297-298`](README.md#L297-L298).

**Mechanism:** policy refuses new banners at 64; the production process pool refuses new children at 24. IDs are remembered before success. There is no delivery queue/capacity-release retry. `notify-send --wait` can hold a slot for up to 120 seconds. Approval/error/ended events do not repeat; human-attention episodes may wait for reminders or never retry if reminders are disabled.

**Observed:** a holding backend received 64 of 65 approvals. After releasing capacity, submitting the omitted approval again still did not deliver because its ID was consumed. The actual process pool separately rejected the 25th concurrent start. Thus fixing only the 64-banner limit does not fix production delivery.

**Impact:** permanent missing banners and a mismatch with "every eligible banner is retained for delivery." For attention, sound-only, and mixed channels, coordinate with A11 rather than counting audio as a reliable fallback.

**Implementation direction:** separate event deduplication, pending admission, dispatched delivery, and completed delivery. Provide bounded queuing/backpressure and an explicit overflow/coalescing policy. Prioritize actionable blockers and reserve capacity for withdrawal/control operations. Drain pending work on capacity release while rechecking eligibility and abort ownership. Do not replay resolved queued requests, make existing baselines fresh, or block approval on notification delivery. If bounded policy deliberately drops certain routine events, document that precise behavior rather than retaining an unconditional delivery promise.

**Acceptance/regressions:** hold 24 production process slots and 64 policy banners independently; verify eligible pending work proceeds after release exactly once. Test one-shot approval/error/ended, actionable events without reminders, saturation plus withdrawal, per-kind disabling, and cancellation while queued. Assert fixed resource/queue bounds and fair handoff across roots. Existing `test/notification-policy.test.ts:213-220` titled "every reviewer banner is delivered" uses only three approvals.

### A16. Manual releases attest workflow source rather than packaged source

**Priority:** P2. **Evidence:** installed npm 12.2.0 provenance generator exercised with an in-memory signing boundary; no OIDC/signing/publication. **Owner:** publication provenance.

**Locations:** [`.github/workflows/release.yml:101-107`](.github/workflows/release.yml#L101-L107), [`135-193`](.github/workflows/release.yml#L135-L193); [`scripts/publish-release.mjs:44-45`](scripts/publish-release.mjs#L44-L45); [`test/npm-cli-smoke.test.mjs:34-36`](test/npm-cli-smoke.test.mjs#L34-L36).

**Trigger:** workflow dispatch from default-branch commit B requests existing tag commit A. Validation correctly checks out/packages A and records `RELEASE_COMMIT`. Plain npm `--provenance` uses `GITHUB_REF`/`GITHUB_SHA`, still describing default branch/B, not the artifact manifest's A.

**Observed:** actual `libnpmpublish/lib/provenance.js` produced a dependency at `refs/heads/main`, commit B, with a distinct packaged release commit A supplied in the environment. The existing CLI smoke bypasses provenance generation, so archive tests can all pass.

**Impact:** signed npm provenance can identify the wrong source revision while immutable archive-byte checks remain correct. This is source-attribution failure, not demonstrated archive substitution.

**Implementation direction:** explicitly bind the verified archive digest and release source commit in provenance while retaining independent workflow-policy identity. Validate the supported npm 12.2.0 provenance input/signing path before selecting an implementation. A checkout alone does not change GitHub trigger variables; do not assume it repairs the predicate or falsify unrelated workflow identity. Preserve default-branch active policy, artifact-only privileged publication, OIDC/private-cache behavior, and no upload retries.

**Acceptance/regressions:** test unequal source/workflow commits using the actual npm provenance builder or explicit statement validation with a fake signing boundary. Assert digest, release ref/commit, workflow policy identity, and run binding. Tag-push and manual dispatch should both be correct. Keep release-artifact and npm CLI smoke tests; no real publication is needed to prove the predicate.

### A17. Shared release concurrency drops pending versions

**Priority:** P2. **Evidence:** workflow configuration plus current GitHub scheduler contract. **Owner:** release workflow.

**Location:** [`.github/workflows/release.yml:17-19`](.github/workflows/release.yml#L17-L19).

**Trigger:** release A runs, B waits, then C arrives. `cancel-in-progress: false` protects A but the omitted `queue` defaults to `single`; C cancels/replaces pending B. The up-to-one-hour npm propagation verification creates a substantial window for this sequence.

**Impact:** a valid pushed tag can receive no publication until someone notices and reruns it. Existing tests simulate sequential publication/channel updates, not scheduler retention.

**Implementation direction:** retain the package-wide group and `cancel-in-progress: false`, add `queue: max`, and assert it in workflow tests. [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) currently supports up to 100 pending runs with `max`; overflow is still bounded. Do not remove serialization, which protects channel updates, and do not combine `queue: max` with `cancel-in-progress: true`.

**Acceptance/regressions:** workflow test requires retained queued releases, unchanged serialization, and the 75-minute publication timeout above the verification budget. Continue forward-only semantic channel tests; do not rely on tag arrival order for correctness.

## 6. Maintenance, test organization, and fixture reliability

### A18. Real-TUI coverage lacks a complete inventory and representative CI execution

**Priority:** P2, coverage. **Evidence:** static workflow/script inspection. **Related:** A01-A04, A09, A12-A14, A19-A23.

**Locations:** [`package.json:51-55`](package.json#L51-L55), [`.github/workflows/ci.yml:29-36`](.github/workflows/ci.yml#L29-L36), [`test/ci-workflow.test.mjs:29-43`](test/ci-workflow.test.mjs#L29-L43).

**Problem:** `test:runtime` and `test:runtime-permissions` aggregate the original smoke/permission families, but omit standalone streaming, session-mode, skill, fast-mode, history, and statistics fixtures. Ordinary checks and PR CI can therefore pass without exercising these built-plugin paths. `test:runtime-cleanup` covers the supervisor, not approval/rendering inside OpenCode. Unlike pure helpers, runtime scenarios have no explicit completeness inventory.

**Pattern behind the gaps:** isolated test doubles hide production composition. Examples include logical visibility instead of real footer geometry (A02), raw unresolved ancestry instead of a deadline-wrapped ancestry implementation (A09), per-banner identity without overlapping activation (A14), and separate pagination/deletion tests instead of their combined scale (A08). Passing count alone does not demonstrate these contracts.

**Implementation direction:** create a runtime scenario inventory classifying automatic pinned-host fixtures, interactive desktop checks, and historical audits. Generate/select runs from the inventory and validate discovery completeness in normal CI. Add a separate representative real-host job using OpenCode 1.18.35 with controlled HTTP fixtures and at most two concurrent hosts. Include new deterministic interleavings rather than assuming ordinary overlapping requests cover them. Keep installation/build requirements explicit.

**Acceptance:** adding a new runtime entrypoint/scenario without inventory classification fails the appropriate inventory check; CI demonstrably executes at least approval/presentation, fast-mode, queue/baseline, and a persistence path. Record exact scenarios run rather than claiming full-matrix coverage. README's current description of PR checks is accurate; update it only when the checks actually change. Do not make an audible/focus test an unattended CI claim.

### A19. Fixture observation JSON can be truncated or overwritten concurrently

**Priority:** P2, fixture reliability. **Evidence:** static race mechanism; no observed flaky run claimed.

**Locations:** [`scripts/smoke-history.mjs:43-45`](scripts/smoke-history.mjs#L43-L45), [`100-101`](scripts/smoke-history.mjs#L100-L101), [`203-205`](scripts/smoke-history.mjs#L203-L205); [`scripts/smoke-history-maintenance.mjs:33-34`](scripts/smoke-history-maintenance.mjs#L33-L34), [`48-49`](scripts/smoke-history-maintenance.mjs#L48-L49), [`65-68`](scripts/smoke-history-maintenance.mjs#L65-L68).

**Problem:** an observation wrapper overwrites JSON every 100 ms with unawaited writes while its driver reads/parses the same file. A reader can hit truncation before the write completes, and slow writes can overlap. Some readers fail immediately on parse error; another catches all errors and obscures the cause behind a 60-second timeout.

**Implementation direction:** use one shared fixture-only publisher with serialized/coalesced writes, a unique same-directory temporary file plus rename, and a shutdown flush. Preserve useful read/write errors. Treat initial absence explicitly rather than swallowing every parse/filesystem exception. Reuse the better patterns in `scripts/smoke-streaming.mjs:41-49` and `scripts/smoke-fast-mode.mjs:31-34`; avoid parallel implementations.

**Acceptance:** a delayed writer with rapid updates never publishes partial JSON or rolls back to an older snapshot; only one write transaction is active; final disposal flushes the newest state. Real fixture failures surface relevant errors rather than generic timeout. If introducing a pure `.mjs` helper test, register it in `scripts/helper-tests.json` and update release-policy sparse checkout closure as needed.

### A20. Palette helpers mistake elapsed time or input text for selected-result readiness

**Priority:** P2, fixture reliability. **Evidence:** static synchronization weakness; not a reproduced failure.

**Locations:** [`scripts/smoke-statistics.mjs:63-66`](scripts/smoke-statistics.mjs#L63-L66), [`scripts/smoke-history-maintenance.mjs:70-72`](scripts/smoke-history-maintenance.mjs#L70-L72), [`scripts/smoke-history.mjs:73-76`](scripts/smoke-history.mjs#L73-L76).

**Problem:** statistics sleeps 250 ms and maintenance sleeps 300 ms after typing before Enter. Another helper waits for `includes(title)`, which can be satisfied by the search input before filtering has selected the intended command. Slow rendering can activate the previous selection or leave the fixture waiting in the wrong view.

**Implementation direction:** share a helper that observes a filtered/selected result separately from input text, activates it, then waits for an explicit command postcondition. The two-occurrence distinction in `scripts/smoke-streaming.mjs:169-175` is an existing improvement, but ensure the final helper proves the required selection rather than merely duplicating text. Do not fix by increasing sleeps. Preserve deliberate negative-observation windows that prove no approval/delivery occurs over an interval.

**Acceptance:** injected delayed filtering/rendering cannot cause early Enter; wrong/absent selection times out with useful capture; expected view must appear before later actions. Reuse across history, maintenance, statistics, and other palette clients.

### A21. `reviewTui` mixes service composition and deeply nested live-panel lifecycle

**Priority:** P2, maintainability. **Evidence:** structural inspection; A02 demonstrates why this boundary needs direct testing.

**Locations:** [`src/tui.tsx:196-350`](src/tui.tsx#L196-L350), [`364-569`](src/tui.tsx#L364-L569), especially [`407-523`](src/tui.tsx#L407-L523).

**Problem:** a roughly 377-line orchestration function constructs configuration/storage/history/notifications/review services, wires events/shutdown, and defines a keyed live panel inline. That callback combines mutable renderables, painted/ready assessment identity, scroll reset, hit testing, diagnostics, frame listeners, approval presentation, cleanup, and JSX over the outer service graph. Reading one state variable's lifetime requires following several nesting levels. No numeric cyclomatic-complexity score was measured; the finding is the concrete mixed ownership and change surface.

**Implementation direction:** extract a named keyed live-panel component owning its renderables, render readiness, geometry checks, and frame subscription. Give it explicit selection/report accessors and presentation callbacks. Keep service wiring/shutdown in the entrypoint. Extract a geometry/readiness helper that can be exercised with real OpenTUI renderables, but retain at least one native-host composition test. Do this after high-risk behavior has regressions, not as an unverified rewrite.

**Acceptance:** request-ID keying and stable live/history sibling root remain; countdown publications do not remount Markdown or reset scroll; cleanup unregisters frame listeners and presentation exactly once; history cover and final highlighting stay correct. Run relevant approval/history/streaming host fixtures after build. Avoid broad architecture churn outside the live-panel boundary.

### A22. The main smoke driver duplicates scenario knowledge across distant branches

**Priority:** P2, maintainability. **Evidence:** structure and control-flow inspection.

**Locations:** [`scripts/smoke.mjs:17-44`](scripts/smoke.mjs#L17-L44), [`186-262`](scripts/smoke.mjs#L186-L262), [`394-503`](scripts/smoke.mjs#L394-L503), [`745-818`](scripts/smoke.mjs#L745-L818), [`1017-1064`](scripts/smoke.mjs#L1017-L1064).

**Problem:** the 1,095-line driver separately encodes scenario membership/derived flags, HTTP responses, UI/manual/automatic transitions, evidence/usage expectations, and notification/persistence assertions. Adding one scenario requires coordinating distant lists and branches. `reviewStagePlan` centralizes part of the model, but the driver still hand-implements transitions such as directory-to-shell at `481-500`.

**Implementation direction:** introduce explicit scenario descriptors and a few named families, such as advisory/edit, approval/visibility, and rendering/scrolling. Reuse stage-driving primitives where semantics match; share launch/capture/palette mechanics while retaining independent behavioral assertions. `scripts/smoke-stages.mjs:37-51` and its helper tests are an incremental starting point. Do not derive expected outcomes from the same production helper under test.

**Acceptance:** every existing scenario remains discoverable in A18's inventory, no scenario loses its assertions, `--plan` remains host/bundle independent, and directory/operation stages remain separate even when review switches differ. Run representative families, not only parser/planning tests, after extraction.

## 7. Lower-priority interfaces, contract alignment, cleanup, and dependencies

### A23. Positional dependency injection obscures reviewer wiring and historical replay

**Priority:** P3, maintainability. **Evidence:** call-site inspection.

**Locations:** [`src/reviewer.ts:186-206`](src/reviewer.ts#L186-L206), [`src/tui.tsx:272-274`](src/tui.tsx#L272-L274), [`src/controller.ts:78-82`](src/controller.ts#L78-L82), [`scripts/audit-usage-history.mjs:59-71`](scripts/audit-usage-history.mjs#L59-L71), [`107-116`](scripts/audit-usage-history.mjs#L107-L116).

**Problem:** `review` has twelve positional parameters, several optional callbacks/dependencies, and call sites with runs of `undefined`. The controller constructor has a similar pattern. The historical usage audit invokes both current code and the actual `v0.7.0` implementation, making one changing positional shape serve two contracts.

**Implementation direction:** retain evidence/config/signal as explicit core arguments and group injected dependencies/observers in a named options object. Use separate current/tagged adapters exposing one small replay interface; isolate the old signature inside its adapter. Document the audit's required historical tag and invocation. Check fixture/embedding consumers before changing exported signatures; preserve compatibility deliberately where needed.

**Acceptance:** production and test call sites name callbacks unambiguously; all existing cancellation, accounting, exact-request, and observer-isolation behavior remains. Historical replay still targets the intended tag and keeps meaningful per-POST/cumulative-usage/restart/failure assertions. Do not remove the historical audit merely because it does not run in ordinary CI.

### A24. Prompt overrides follow valid symlinks despite the documented prohibition

**Priority:** P3, contract defect. **Evidence:** source/filesystem reproduction. **Owner:** custom prompt loading.

**Locations:** [`src/prompts.ts:61-75`](src/prompts.ts#L61-L75), [`README.md:98`](README.md#L98), [`test/prompts.test.ts:93-110`](test/prompts.test.ts#L93-L110).

**Mechanism/observed:** `lstat` establishes existence but its result is discarded; `open` lacks `O_NOFOLLOW`; descriptor `isFile()` checks the target. A valid `EDIT-REVIEW-PROMPT.md` symlink to a file outside the configured directory loads successfully as privileged reviewer instructions. Tests reject a dangling symlink but not a valid one.

**Impact/severity:** this contradicts the explicit non-symlink promise. It is not independently an exploit without influence over configured prompt files/targets. Other path classes intentionally allow symlinks, so do not apply a global prohibition to shell evidence or unrelated features.

**Implementation direction:** enforce the promised final-component restriction atomically at open with `O_NOFOLLOW`, retaining bounded UTF-8/content/regular-file/descriptor-change checks and close ownership. Do not rely solely on a pre-open `lstat` race. Keep absence fallback different from a supplied invalid override. If a broader ancestor-containment policy is desired, specify it separately rather than claiming final-component no-follow already implements it.

**Acceptance:** valid inside/outside target symlinks, dangling links, and a final-component swap cannot load as overrides; regular files and omitted overrides still behave correctly. Contracts remain fixed and cannot be overridden. Update docs only to reflect the actual chosen contract.

### A25. Package checks omit two bundled sound categories

**Priority:** P3, coverage. **Evidence:** build/check comparison; current sound assets are not reported missing.

**Locations:** [`scripts/check-package.mjs:17-19`](scripts/check-package.mjs#L17-L19), [`test/notification-codec.test.ts:35-45`](test/notification-codec.test.ts#L35-L45).

**Problem:** the bundle embeds six sounds, but archive verification searches exact bytes only for `attention`, `approved`, `error`, and `ended`. `unsafe` and `question` are omitted. Reproducibility and source/archive comparison cannot detect a consistently wrong bundle. The six-sound decoding test reads source assets rather than the embedded mapping.

**Implementation direction:** verify all six bundled category-to-byte mappings. Simple substring membership improves current coverage but still misses swapped mappings; prefer an inspectable build seam or emitted-map validation without importing unsafe package code into privileged publication.

**Acceptance:** omitting, replacing, or swapping either missing category fails package verification. Keep the exact five-file package, embedded decoder checks, unused worker-adapter exclusion, and reproducibility checks. Run `npm run check:package` after the change.

### A26. Compatibility wording and one host-version comment do not match verification

**Priority:** P3, documentation. **Evidence:** manifest/guide/docs comparison.

**Locations:** [`README.md:16`](README.md#L16), [`src/tui.tsx:514`](src/tui.tsx#L514), [`package.json:34-36`](package.json#L34-L36), [`AGENTS.md:61-64`](AGENTS.md#L61-L64).

**Problem:** README says OpenCode 1.18.35 "or newer", while verified behavior and host-sensitive ordering/rendering contracts target exactly 1.18.35. The panel-width comment still refers to 1.18.34. This review does not demonstrate newer-host incompatibility; it identifies a stronger compatibility claim than the available verification.

**Implementation direction:** distinguish the verified target from any minimum-version/support claim and update or explain the older version in the layout comment. Keep README focused on installation/config/user behavior. Do not introduce UI upgrade/history-format warnings. Document actual notification delivery policy after A11/A15 and retain the accurate description of existing CI until A18 is implemented.

**Acceptance:** manifest/guide/user docs describe the same tested target and avoid implying unrun host coverage. Source comments explain relevant contracts rather than carrying a stale version number without purpose.

### A27. Small dead interfaces/output and a legacy helper route remain

**Priority:** P3, cleanup. **Evidence:** repository consumer searches including tests, scripts, and build seams.

| Candidate | Location | Assessment and action |
| --- | --- | --- |
| `HistoryOperation` | [`src/history-records.ts:31`](src/history-records.ts#L31) | No repository consumer found. Storage uses serialized event plus writer/sequence directly. Remove if no intentional external type contract. |
| `ReviewProgress` re-export | [`src/reviewer.ts:12`](src/reviewer.ts#L12) | Consumers use `types.ts`, not this re-export. Remove redundant surface if no embedding contract. The type itself is used. |
| `prerelease` workflow output | [`scripts/release-version.mjs:92`](scripts/release-version.mjs#L92) | No workflow consumer. Remove the output if unnecessary; keep classification used for validation/logging/channel policy. |
| External-directory shell context branch | [`src/context.ts:99-106`](src/context.ts#L99-L106), [`test/context.test.ts:176-193`](test/context.test.ts#L176-L193), [`src/evaluate.ts:34-38`](src/evaluate.ts#L34-L38), [`62-65`](src/evaluate.ts#L62-L65) | Production dispatch uses directory evidence, not this legacy shell route. Confirm compatibility need before removal; otherwise remove or explicitly label helper-only tests so they are not mistaken for production directory coverage. |

**Do not misclassify:** `parseAssessment()` at `src/reviewer.ts:14-18` is a test-only convenience with callers, not an unused parser implementation. `history-worker-probe.ts`, diagnostics, storage probes, and `with*` TUI exports have real build/fixture/embedding uses. The historical usage audit also has substantive assertions. No large abandoned subsystem was confirmed.

**Acceptance:** repeat repository consumer searches when implementing; avoid breaking intentional embedding seams. Typecheck and appropriate existing tests are sufficient for low-impact removal; do not add tautological tests that only assert an unused declaration was deleted.

### A28. Dependency refresh is planned maintenance, not a confirmed vulnerability

**Priority:** P3, dependency planning. **Evidence:** audit, lock/manifest integrity review, `npm outdated` at review time.

**Current positive evidence:** npm audit returned zero known vulnerabilities. All 180 locked dependency entries inspected by the release review had npm-registry URLs, SHA-512 integrity, and development classification. Root declarations matched the lock. Notices matched inspected bundled components; host UI libraries remained external and unused decoder worker adapters were excluded. Development classification does not mean code is absent from the shipped bundle: build-embedded components still need security review.

| Package | Pinned/current | Latest reported during review | Treatment |
| --- | --- | --- | --- |
| `@babel/core` | 7.29.7 | 8.0.7 | Separate major-version build migration |
| `@babel/preset-typescript` | 7.28.5 | 8.0.7 | Coordinate with Babel and universal JSX transform |
| `@opentui/core` | 0.4.5 | 0.5.10 | Validate against the pinned host, do not update independently on version count alone |
| `@opentui/keymap` | 0.4.5 | 0.5.17 | Same host-alignment constraint |
| `@opentui/solid` | 0.4.5 | 0.5.17 | Same host/rendering alignment constraint |
| `@types/node` | 24.12.2 | 26.6.5 | Keep aligned with supported development/runtime APIs rather than newest Node major |
| `babel-preset-solid` | 1.9.10 | 1.9.16 | Evaluate patch update with build and real rendering checks |
| `solid-js` | 1.9.12 | 1.9.17 | Evaluate patch update with host compatibility and override review |
| `typescript` | 5.8.2 | 7.0.2 | Separate compiler migration, including build/test compatibility |

**Implementation direction:** first fix reproducible behavior; then perform scoped dependency updates with lockfile/notices/package checks. Audit host-external versus embedded boundaries, the Solid `seroval` override, and transformation behavior when updating related packages. No clearly unnecessary major dependency was identified. No arbitrary major upgrade is required to close A01-A27.

**Acceptance:** exact pins and integrity remain consistent, bundled notices stay accurate, checks/package reproducibility pass, and host-sensitive upgrades have explicit real-TUI verification. Re-query advisory/latest data at implementation time; the table is a historical observation, not a promise about future registry state.

## 8. Strengths and non-findings to preserve

1. **Strict transport completion:** one assessment parser validates both modes, rejecting duplicate keys, extra fields, bad booleans/escapes/surrogates, and empty descriptions. SSE requires `stop`, `[DONE]`, and body EOF, with UTF-8/framing/event/wire/content limits. No final-assessment validation bypass was confirmed.
2. **Exact retry and accounting semantics:** transport/correction budgets share the original deadline; retries preserve exact request history/body, clear rejected previews, and do not replenish retry allowance. Per-POST received usage survives many failure paths; cumulative frames replace values and unknown is not zero. Observer failures are isolated. A suspected usage-only SSE pricing issue was ruled out by production model propagation and an existing targeted test.
3. **Strong invocation identity/origin checks:** session/message/call ownership, running state, duplicate tool parts, native/custom/MCP distinctions, and exact skill catalog identity are checked. Missing root/delegation context is not replaced by unrelated intent.
4. **Careful file capture:** bounded actual transaction ownership, regular-file/UTF-8/EOF/growth/change checks, cancellation, and skill opened-descriptor containment are substantive defenses. A03/A05/A06 concern association/semantics around these mechanisms, not evidence that all capture safeguards are ineffective.
5. **Conservative approval design:** fresh snapshots, deep request comparison, revision guards, single-flight writes, durable uncertainty, and fast-report retention are valuable. A01/A02/A04 expose specific integration gaps; preserve the underlying guarantees while fixing them.
6. **Transactional storage and attribution:** event effects, deduplication, writer replay cursor, rollback, multi-client behavior, and exact scoped selection have meaningful SQLite coverage. Ambiguous native `once` outcomes do not become invented manual attribution. Deleting detail does not reduce totals. No confirmed SQL-injection path was found; dynamic identifiers use fixed choices and values are bound.
7. **Filesystem protection for history:** private ownership/mode checks reject symlinks, hardlinks, public permissions, and foreign ownership rather than silently resetting data. Do not weaken these to make a migration test pass.
8. **Release privilege separation and archive defense:** immutable artifact identity, digest/run/attempt/policy/source checks, bounded archive inspection, five-file allowlist, duplicate/link/traversal/header rejection, actual npm parser comparisons, disabled scripts, forward-only channels, and no upload retry are strong. A16/A17 concern provenance/scheduler behavior outside byte-integrity correctness.
9. **Useful tests and fixture infrastructure:** fake clocks exercise dequeued callbacks and late results; controlled HTTP gates avoid many timing guesses; payload audits compare exact correction/retry contracts; supervisor tests cover interruption and parallel isolation. Pure-helper inventory completeness is enforced. The next value is composition/scale/adversarial interaction coverage, not inflating test count.
10. **Pinned missing-request behavior was checked:** OpenCode's permission service rejects missing requests. The older-host assumption that replying to an already-removed request necessarily succeeds is not a finding.

No critical-severity exploit was confirmed. Zero npm advisories is limited advisory evidence, not proof of dependency safety. No broad class of pointless tests or large dead subsystem was established.

## 9. Safe-but-manual symptom triage

This combines the notification audit's user-observed symptom with the broader presentation/dispatch findings. Diagnose the footer/state and event sequence; do not infer automation eligibility from Safe alone.

| Observed state | Interpretation and next check |
| --- | --- |
| `! Auto-approval unavailable. Use native controls.` / `failed` | Consistent with A04 if an unrelated event invalidated verification before any write. Also possible for genuine read/transport/uncertain-write failures. Check actual dispatch and revision timing before attributing cause. |
| `Auto-approval canceled` / `cancelled` | Durable cancellation, including a sibling taking priority or visibility loss after countdown start. Do not clear it as an A04 repair. |
| Safe with no approval state | May legitimately await final render/native position; must not itself produce attention. A13 concerns a different baseline/notification gate. |
| `Checking…` | Fresh verification in progress; attention stays suppressed. Recoverable revision churn belongs here or an equivalent pre-dispatch state. |
| `Allowing…` | Currently mixes reserved and effectively dispatched behavior; A01 requires separating those internally. The label alone is not proof a write occurred. |
| `Auto-approved; finishing report…` | Confirmed retained fast report; no attention replay and no native notification blocker. |
| Safe at very short terminal height | A02 can leave automation armed while footer controls are absent. Test actual geometry, not only logical sidebar presence. |

## 10. Implementation sequence and change boundaries

| Work package | Findings | Recommended sequence and completion gate |
| --- | --- | --- |
| W1: approval boundaries | A01, A02, A04 | Add deterministic failing regressions first. Separate reservation/dispatch and pre-dispatch invalidation. Fix actual write guard; fix physical geometry; add bounded fresh verification. Require real short-height and normal/fast/retained lifecycle runs. |
| W2: evidence identity | A03, A05, A06; A24 separately | Match launch cwd to pinned host; make unsupported shell state unknown; correct literal skill parsing/identity. Use actual/decoy fixtures. Keep prompt-override no-follow as its own contract change. |
| W3: persistence/ownership | A07, A08, A09 | Repair compatible serialized bounds; preserve maintenance scan progress without dropping external revision proof; carry true ancestry settlement. Use real SQLite and production wrapper composition. |
| W4: notification admission/delivery | A10-A15 | Add immediate worker rejection ownership. Establish permission baseline and question readmission before delivery scheduling. Define bounded audio/banner/process policies together. Fix action-time click generation. Test all abort/queue-loss interactions. |
| W5: release correctness | A16, A17, A25 | Validate actual provenance source identity; retain queued release runs; cover all embedded sound mappings. Maintain privileged-job boundary and archive verification. |
| W6: maintenance | A18-A23, A26-A28 | Inventory real fixtures, fix observation/palette reliability, then extract orchestration/interfaces/scenario families with prior regressions protecting behavior. Handle low-impact cleanup and dependency updates in scoped changes. |

W1 and W4 share controller/notification facts: avoid simultaneous uncoordinated edits to dispatch attribution. W3 ancestry changes can affect W4 lookup ownership. A21 extraction should follow, or be tightly constrained by, A02 tests rather than hiding the geometry fix in a large refactor. Keep behavioral fixes reviewable separately from dependency upgrades.

### Required completion properties

- A prevented pre-dispatch approval emits no write, confirmation, or misleading retained-dispatched state.
- An unchanged eligible Safe request can recover from unrelated stale-read churn without attention, while genuine cancellation and uncertain writes remain manual.
- Current physical layout controls presentation; short-height loss cannot be repaired merely by restoring terminal size.
- Captured evidence corresponds to actual host/shell/file semantics or is explicitly omitted; decoys are not silently substituted.
- Writer-valid retained metadata migrates; unrelated roots are not blocked by that size mismatch; deletion work remains bounded in scale.
- Caller timeout never manufactures free underlying I/O capacity.
- Event-born question admission can recover without converting baseline/pre-visit requests into births.
- Questions never overtake unknown/existing permission blockers during initialization.
- Pending actionable sound/banner work survives temporary capacity where the chosen bounded policy promises it and dies on queue loss/resolution/disposal.
- Old activation completion cannot override the latest valid click; exact history targets remain exact.
- Published provenance describes the packaged commit and bytes; queued valid releases are retained within platform limits.
- Each behavioral fix has a regression failing at the audited commit and passing after the fix. Assert independent expected behavior, not implementation-shaped snapshots.

## 11. Verification plan for the fixing agent

These are proposed post-fix runs. They are not additional tests executed while creating this report. Run relevant focused suites while changing an area, then required aggregate/package/host checks. Broaden only for changed surfaces or unresolved failures.

### Focused source suites

```sh
# Approval, rendering state, revisions, and notification consequences
npx tsx --test test/approval.test.ts test/fast-mode.test.ts test/controller.test.ts test/pending-refresh.test.ts test/history-cover.test.ts test/notification-controller.test.ts

# Evidence and prompt boundaries
npx tsx --test test/context.test.ts test/evidence.test.ts test/file-access.test.ts test/skill-evidence.test.ts test/tools.test.ts test/prompts.test.ts

# Persistence, maintenance, ancestry composition, and statistics
npx tsx --test test/conversation-statistics.test.ts test/history-storage.test.ts test/history-store.test.ts test/history-maintenance.test.ts test/history-controller.test.ts test/statistics-controller.test.ts test/session-mode.test.ts

# Notification births, native ordering, scheduling, processes, clicks, and audio
npx tsx --test test/notification-host.test.ts test/notification-order.test.ts test/notification-policy.test.ts test/notification-linux.test.ts test/notification-icon.test.ts test/notification-codec.test.ts

# Normal verification, including build
npm run check
```

The supplied notification audit's exact baseline command was:

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test test/notification-order.test.ts test/notification-policy.test.ts test/notification-host.test.ts test/notification-controller.test.ts
```

### Release, bundle, and fixture-infrastructure checks

```sh
npm run test:helpers
npm run check:package
node --test test/release-artifact-smoke.test.mjs
# Requires installed npm 12.2.0; does not publish
node --test test/npm-cli-smoke.test.mjs
npm run test:runtime-cleanup
```

Add provenance coverage that reaches actual predicate construction; existing npm CLI dry runs deliberately bypass that step. Add any pure `.mjs` helper test to `scripts/helper-tests.json`, keeping active-policy sparse checkout complete. Preserve the two supported development Node floors in CI.

### Relevant real-host fixtures after building

Use Linux/Git/Python 3/tmux/OpenCode 1.18.35, isolated HOME/XDG/project state, and the existing supervisor. At most two simultaneous hosts. Source/built-in prompt changes need a rebuild and host restart; these commands do not automatically build.

```sh
# Approval, presentation, mode, retained reports, and clicks
node scripts/smoke.mjs auto-shell
node scripts/smoke-fast-mode.mjs complete
node scripts/smoke-session-mode.mjs
node scripts/smoke-history-auto.mjs covered
node scripts/smoke-history-auto.mjs notification

# Native notification ordering across root and child requests
node scripts/smoke-notification-queue.mjs main --stream
node scripts/smoke-notification-queue.mjs children --stream
node scripts/smoke-notification-queue.mjs mixed --stream

# Evidence, streaming, and category composition
node scripts/smoke.mjs external
node scripts/smoke-skills.mjs root
node scripts/smoke-skills.mjs subagent
node scripts/smoke-streaming.mjs complete --stats
node scripts/smoke-streaming.mjs truncated --static --stats
node scripts/smoke-permissions.mjs mcp --auto --correction --stream --stats
node scripts/smoke-permissions.mjs external-edit --auto --stream --stats

# Persistence and statistics
node scripts/smoke-history-storage.mjs
node scripts/smoke-history.mjs browse
node scripts/smoke-history-maintenance.mjs
node scripts/smoke-statistics.mjs
```

Read scenario parsing before extension. Existing fixtures do not automatically create A01's microtask gap, A04's verification-time churn, A13's held initial baseline, A08's combined scale case, or A02's vertical clipping. Add explicit gates/scenarios for those, rather than treating ordinary overlap as equivalent coverage. Promote the local short-height repro into a maintained fixture with desired post-fix assertions.

For separately requested actual local sound playback:

```sh
npx tsx scripts/smoke-notification-desktop.ts --sounds
```

Mock process results and notification recorders establish scheduling/argv/ownership, not audible sound or GNOME focus. Report the exact scope of every executed fixture and any remaining gap.

## Appendix A. Source reconciliation and deduplication map

| Original item | Consolidated location | Enrichment/preservation |
| --- | --- | --- |
| NA-01 deferred final write | A01 | Reservation versus actual dispatch, synchronous observer reentrancy consideration, links to geometry and stale-read recovery |
| NA-02 Safe-but-manual revision churn | A04, section 9, Appendix B | Full trigger/result table, original expectations to revisit, bounded read ownership, retained standalone repro |
| NA-03 audio capacity | A11 | Kept separate from A15; common scheduling/cancellation requirements made explicit |
| NA-04 question admission | A12 | Birth/readmission distinction plus shared ancestry ownership implications |
| NA-05 permission baseline | A13 | Explicit startup ordering health and atomic publication requirements |
| NA-06 click reorder | A14 | Deduplicated with session 9; generation must begin at action receipt, not EOF |
| Session 1 short terminal | A02 | Replaced initial headless-only uncertainty with the later actual pinned-host reproduction and exact limits |
| Session 2 absolute cwd | A03 | Host normalization versus filesystem operand distinction |
| Session 3 shell semantics | A05a/A05b | Both physical flags and `trap`/`time` examples retained |
| Session 4 skill evidence | A06a/A06b/A06c | Quoted punctuation, Markdown fragment, and lexical main-file collision all retained |
| Session 5 legacy migration size | A07 | Explicit unusual model controls, historical admission, simulated old schema, FIFO-wide effect |
| Session 6 maintenance scaling | A08 | Measured turn/lookup counts separated from calculated wall-clock duration |
| Session 7 ancestry leaks | A09 | Production wrapper composition and operational cancellation qualification |
| Session 8 icon rejection | A10 | Actual unhandled rejection distinguished from unproven host crash |
| Session 9 click order | A14 | One combined finding, preserving both independent reproductions |
| Session 10 banner loss | A15 | Separate policy/process limits and one-shot deduplication consequence |
| Session 11 wrong provenance | A16 | Source/workflow identity distinction and actual npm generator boundary |
| Session 12 dropped release queue | A17 | Platform queue limit and continued semantic-channel serialization |
| Session 13 runtime coverage | A18 | Inventory/CI gap and cross-component test pattern |
| Session 14 fixture synchronization | A19/A20 | Split atomic file publication from palette readiness so fixes have separate acceptance criteria |
| Session 15 orchestration | A21/A22/A23 | TUI ownership, smoke scenario duplication, and positional APIs/historical adapter retained separately |
| Session cleanup: prompt links | A24 | Atomic no-follow fix and explicit privilege/influence qualification |
| Session cleanup: sound package checks | A25 | All-six mapping verification, no claim of currently missing assets |
| Session cleanup: version docs/comment | A26 | Verified-target wording and no UI notices |
| Session/specialist dead-code observations | A27 | Includes unused `prerelease` output; test/build seams explicitly not classified as dead |
| Session dependency review | A28 | Actual outdated snapshot, zero advisory result, host/embedded boundary qualifications |
| Strengths and rejected hypotheses | Section 8 | Transport/parser, evidence capture, accounting, release isolation, tests, missing-request and SSE-pricing non-findings |
| NA symptom guide, implementation sequence, verification plan | Sections 3, 9-11, Appendix B | Retained and extended across the whole codebase |

### Pinned-host references used by the notification audit

Tag `v1.18.35`, host commit `53d1eabb61e21162157817bf677da0a4ad3332e3`:

- [Native session input selection](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/tui/src/routes/session/index.tsx)
- [Native pending-request state updates](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/tui/src/context/sync.tsx)
- [Permission service](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/permission/index.ts)
- [Permission HTTP handler](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts)

## Appendix B. Standalone Safe-but-manual reproduction from NA-02

Run from the repository root. Uses actual controller/policy code and a fake approval transport, writes no permissions, and disables the `tsx` transform cache. Assertions deliberately describe the **audited buggy behavior**. Convert them to desired recovery/no-attention expectations when promoting this into a regression. The source audit ran this reproduction; it was retained here, not rerun during consolidation.

```sh
TSX_DISABLE_CACHE=1 node --import tsx --input-type=module <<'JS'
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import { Controller } from "./src/controller.ts"
import { NotificationPolicy } from "./src/notification-policy.ts"
import { parseNotificationConfig } from "./src/notification-config.ts"

const request = (id, sessionID) => ({
  id, sessionID, permission: "bash", patterns: [], always: [], metadata: {},
})

for (const concurrent of [false, true]) {
  const a = request("a", "root")
  const b = request("b", "unrelated-root")
  const messages = []
  let release, reads = 0, writes = 0
  const policy = new NotificationPolicy(
    parseNotificationConfig({ staleReminderSeconds: 0 }), true,
    {
      async show(message) { messages.push(message.kind); return { close() {} } },
      dispose() {},
    },
  )
  const controller = new Controller(
    async () => ({ safe: true, desc: "Safe fixture" }),
    views => policy.snapshot(views, new Map([
      ["root", { kind: "permission", id: "a" }],
    ])),
    { reviewBash: true, reviewEdits: true, autoApprove: true },
    {
      visibleID: () => "a",
      list: () => ++reads === 1
        ? new Promise(resolve => { release = resolve })
        : Promise.resolve(concurrent ? [a, b] : [a]),
      once: async () => { writes++ },
    },
    { now: () => 0, after: () => () => {} },
  )
  try {
    policy.permission(a, { root: "root", sessionID: "root", title: "Root" }, true)
    controller.asked(a)
    await settle()
    controller.presented("a")
    const operation = controller.approveNow("a", true)
    await settle()
    if (concurrent) controller.asked(b)
    release([a])
    await operation
    await settle()
    controller.presented("a")
    await controller.approveNow("a", true)
    const view = controller.views.find(value => value.request.id === "a")
    assert.equal(writes, concurrent ? 0 : 1)
    assert.deepEqual(messages, concurrent ? ["attention"] : [])
    if (concurrent) {
      assert.equal(view.assessment.safe, true)
      assert.equal(view.autoApproval.status, "failed")
      assert.equal(view.approvalPendingConfirmed, true)
    }
    console.log(JSON.stringify({ concurrent, reads, writes, view, messages }))
  } finally {
    await controller.dispose()
    await policy.dispose()
  }
}
JS
```

## Appendix C. Reproduction artifact availability and reconstruction notes

Local `.runtime` and `/tmp` artifacts are supplementary and may not exist in a fresh checkout. Findings and acceptance criteria above do not rely on their persistence. Temporary scripts assert the audited behavior and must be adapted for post-fix assertions.

| Findings | Available artifact/command at consolidation | Scope |
| --- | --- | --- |
| A02 | `node .runtime/short-height-native.mjs`; captures under `.runtime/short-height-native-N9OnGo/` | Actual pinned host with deterministic local model fixtures; uses the currently built bundle on rerun |
| A03, A05, A06 | `TMPDIR=/tmp/opencode node --import tsx /tmp/opencode/evidence-review-20261009.mts` | Creates/removes temporary marker files; prints collector contents versus actual Bash/Python/filesystem resolution |
| A14, A15, A24 | `node --import tsx /tmp/opencode/reviewer-readonly-review-repros.mts` | Four focused tests for symlink override, click reorder, policy capacity, and process capacity |
| A10 | `node --import tsx /tmp/opencode/reviewer-icon-cancel-repro.mts` | Deferred filesystem rejection after immediate cancellation; captures unhandled rejection behavior |
| A04 | Appendix B, also present in `NOTIFICATION-AUDIT.md` | Full self-contained source reproduction |
| A01, A11-A13 | Detailed controlled interleavings in findings and original notification audit | Original inline scripts were not saved as regression files; rebuild using production classes and deferred fixture boundaries |
| A07-A09 | No saved scripts/database; original runs used inline `node --import tsx --input-type=module -e ...` and in-memory SQLite | Reconstruct from the explicit setups below |
| A16 | No saved script; actual installed npm provenance module with only signing replaced | Reconstruct offline; no network/OIDC/publication required |

**A02 artifact identity:** the tested bundle SHA-256 was `8d0fc8d4c57dc1ea8f7b53d01f9ece868f9cc564c6a6f0383b25ff7bcda9cfe7`. Actual compiled `ReviewFooter`, Solid layout, app-slot wrapper, native sidebar/controller/permission transport were exercised. Samples were about 80 ms apart; they are not a frame-by-frame video. The supervised host was disposed after the run. The earlier headless-only reproduction was provisional; the real-host run is the evidence supporting P1.

**A07 reconstruction:** use real `HistorySQL` over `:memory:`; seed writer-valid accepted/finalized records with the escaped model through production admission; `DROP TABLE conversation_totals`; instantiate current `HistorySQL` again; query baseline and apply new events. Then compose `HistoryStore` with that SQL transport, queue an affected-root event before an unrelated-root event, and verify the old implementation blocks admission/FIFO. Historical validation can be inspected with `git show be1da72^:src/usage.ts` and the statistics commit's schema/record diff. No old binary upgrade was run.

**A08 reconstruction:** create 110 session ownership rows in indexed order, with a surviving prefix of 100 and 10 missing suffix rows. Use exact pinned success/missing envelopes and production maintenance/store behavior, counting `step()` and host lookups until the dirty gate clears. Use deterministic turns to avoid waiting tens of minutes. Test root-first cascade separately and together with the page cursor.

**A09 reconstruction:** compose each real browser/statistics controller with `HistoryCoordinator.root`, `SessionModes.root`, and a metadata reader that records unresolved promises and ignores abort until explicitly released. Reopen/close repeatedly, including statistics Conversation selection. Count actual reader calls before release, not the number of already-rejected wrapper promises. Always settle and clean up deferred operations afterward.

**A16 reconstruction:** load installed npm 12.2.0's `libnpmpublish/lib/provenance.js` through its own module resolution, replace only the signing boundary with an in-memory capture, set differing release/workflow commit identities, and inspect the produced predicate's source dependencies and subject digest. Do not call registry publication or real OIDC. Existing npm CLI smoke patterns demonstrate how to exercise npm internals in an isolated child safely.

## Appendix D. Final handoff checklist

- [ ] Each addressed ID has an explicit implementation and regression or a documented product-contract decision.
- [ ] A01/A02/A03 P1 defects are fixed before relying on unattended approval.
- [ ] A04 recovery distinguishes stale pre-dispatch reads from actual cancellation and dispatched uncertainty.
- [ ] Shared cancellation/ownership rules hold across controller, ancestry, audio, banners, and click activation.
- [ ] Original source findings are traceable through Appendix A; no duplicate click bug or missing shell/skill subcase.
- [ ] Source tests assert independently expected behavior; native fixtures exercise the newly identified boundaries.
- [ ] Existing strong parser, transport, filesystem, history, and publication invariants remain covered.
- [ ] Runtime/UI fixes were rebuilt and checked against the pinned host; fixture results are reported precisely.
- [ ] Publication changes were verified without a real upload; immutable archive and privilege boundaries remain intact.
- [ ] Documentation reflects implemented behavior, with no unsupported compatibility claim or unconditional delivery promise.
- [ ] Cleanup does not remove real fixture/embedding seams or overwrite unrelated user work.
