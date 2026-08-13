# FIRE Review — Monorepo TypeScript Extensions

Date: 2026-08-12
Status: complete
Verdict: **PASS** — the verified P0/P1 queue is resolved; sequential full gates and final security/architecture/F.I.R.E. review pass.
Baseline: `main` / `b1b4b44`; initial main tree contained only user-owned untracked `prompts/general-manager-startup.txt` and `team-results/`.
Scope: all nine `extensions/*` packages and directly coupled `lib/**`, tests, public surfaces, persistence, subprocess/network behavior, architecture and git history. Exclusions: ignored runtime state, credentials, raw sessions, `.workers/`, `working-notes/`, and other repositories.

## Executive summary

- Static foundations remain strong: no extension-to-extension imports, no `extensions`/`lib` cycles, strict checks pass, and Matrix isolates its third-party SDK behind an adapter.
- The verified concurrency, path-confinement, process-lifecycle, state-ownership, and public-contract P0/P1 defects are resolved with deterministic regression coverage.
- Public compatibility is preserved through deprecated, ignored model inputs while trusted operator configuration remains explicit; verified dead code was removed.
- No fitness-test exemptions, budget increases, or dependencies were added. Bounded P2/P3 follow-ups remain non-blocking.

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | Full check/test feedback remains fast; shutdown, cancellation, and transaction races now have bounded deterministic paths. | PASS. |
| Inexpensive | Matrix ingress and child output are bounded; no dependency was added. Remaining session/file-watch/Bionic cost items are bounded follow-ups. | PASS with P2 follow-ups. |
| Restrained | Verified dead modules were removed; model-controlled command/path overrides are deprecated and ignored; confinement is explicit. | PASS. |
| Elegant | Authoritative state, confined persistence, transaction, lifecycle, and ownership boundaries are documented and fitness-tested. | PASS. |

## Extension matrix

| Extension | Size / state and public surface | Initial FIRE disposition | Main evidence |
|---|---|---|---|
| `pi-bionic` | 183 LOC; stateless tool/command | PASS with follow-ups | O(n²) suffix spreading and raw-ANSI policy mismatch (`bionic.ts:104-112`, `bionic.ts:24`). |
| `pi-coas` | 3,404 LOC; schedules/workspaces/approvals/run-state; 16 tools + commands | BLOCKED | Runtime bypasses accepted confined store; shutdown is not awaited; approval tool ignores resume failure; cross-process scheduling is process-local. |
| `pi-doctor` | 221 LOC; read-only diagnostics plus optional gate | CONDITIONAL | “Read-only” public surface executes free-form shell; entrypoint handler coverage is absent. |
| `pi-file-watch` | 422 LOC; configured watchers/timers | PASS with follow-ups | `maxBytes` is parsed but unused while full files are synchronously hashed. |
| `pi-goal` | 1,615 LOC; `.pi/goal` authority/projections; four tools + commands | BLOCKED | Source confinement follows symlinks; projection writes can survive failed authority commit; gate contract/docs disagree. |
| `pi-kanban` | 3,371 LOC; append log authority + projections; 11 tools + overlay | BLOCKED | Compaction and claim/mutation transactions are not cross-process serialized; concurrent claims can clear the winner. |
| `pi-matrix` | 1,801 LOC; network sync/token/cache; channel + command | CONDITIONAL | Attachment downloads lack concurrency/time bounds; event dedup/cache lifetime is unbounded; docs name obsolete SDK. |
| `pi-ollama-models` | 178 LOC; subprocess + models registry rewrite | BLOCKED | Model-visible executable and write-target overrides allow arbitrary same-basename binary and arbitrary file overwrite. |
| `pi-panopticon` | 13,694 LOC; registry/messaging/spawn/teams/swarm; 26 tools + commands | BLOCKED | ADR-043 was inert/insecure before current correction; `team_form` path traversal; private-state crossings; subprocess lifecycle risks; unreachable production modules. |

## Material findings

| Finding | Priority | Severity | Confidence | Evidence | Recommendation |
|---|---|---|---|---|---|
| Kanban compaction can replace a log after another process appends, losing events. | P0 | Critical | High | `extensions/pi-kanban/compaction.ts:31,73-76,164`; `lib/file-lock.ts:17` unused. | Put all append/read-check-write/compaction transactions behind one cross-process board lock. |
| Concurrent Kanban claim rollback can unconditionally clear the winning claim. | P0 | Critical | High | `claim-tools.ts:28,103-125`; `board-event-handlers.ts:55-59,100-101`. | Re-read and append one validated batch under the same board lock; remove compensating unconditional rollback. |
| `team_form` agent IDs permit path traversal outside the agents directory. | P0 | Critical | High | `team-runtime.ts:68-73,242-248`; `team-form.ts:123-129`; `team-form-files.ts:19-23,68-72`. | Validate safe IDs and real resolved containment before read/write/delete. |
| CoAS accepted symlink confinement is implemented only in a test-oriented class while production schedules/status use unguarded helpers. | P0 | Critical | High | ADR 038; `store.ts:91-185,200-247`; `schedules.ts:113,136,177-212`; `status.ts:121`; misleading `docs/architecture.md:112`. | Route production through scoped `ConfinedStore`, delete duplicate unsafe helpers, add consumer-level symlink tests. |
| The retired standalone `SwarmRunner` could ignore private-model eligibility, but it is unreachable and prohibited by ADR-040’s single canonical Teams lifecycle. | P1 | High | High | Production reachability audit; `swarm/index.ts` compatibility aliases route through `TeamsFacade`; ADR-040. | Delete the six retired standalone swarm modules/tests; retain live aliases and canonical hierarchical-swarm eligibility checks. |
| Goal file-source lexical confinement follows repository symlinks and can expose external local files to a provider. | P1 | High | High | `goal-persist.ts:105-106,154-162`. | Reject symlink components and enforce real-path containment before reading. |
| Ollama model-visible overrides allow arbitrary file target and arbitrary executable named `ollama`. | P1 | High | High | `pi-ollama-models/index.ts:108-110,118,122,138-145,165-171`. | Remove overrides from model-visible schema; retain trusted env/test injection only. |
| Child-process abort resolves before exit, misses pre-aborted signals, captures unbounded output, and has no TERM→KILL escalation. | P1 | High | High | `lib/runtime-child-process.ts:51-52,69-85`. | Bound output, handle pre-abort, wait for close, and escalate termination. |
| CoAS shutdown starts interruption persistence without awaiting it. | P1 | High | High | `pi-coas/lifecycle.ts:55-56`; `scheduler.ts:77-84`. | Make `stop()` async and await persistence in shutdown. |
| `coas_approval_approve` reports success even when approved-run resume returns false. | P1 | High | High | `tools-approval.ts:49-58`; `scheduler.ts:143`. | Return failed tool result and add handler-level test. |
| Matrix attachment handlers have no semaphore, aggregate byte cap, deadline, or shutdown abort. | P1 | High | High | `js-sdk-adapter.ts:176`; `client.ts:141`; `attachments.ts:237,251-258`. | Add bounded concurrency/bytes, timeout, and lifecycle abort. |
| Goal projections can be left stale when projection writes succeed before authoritative `goal.json` fails. | P1 | High | High | `goal-persist.ts:40-47,51-65`. | Commit authority first and regenerate projections, or version projections. |
| Panopticon team results and operational state cross CoAS/Kanban private-state boundaries. | P1 | High | High | `team-run-completion.ts:11-13`; `team-result-artifact.ts:8`; `registry/state.ts:28,64-66`; `docs/architecture.md:272-273`. | Use Panopticon/session-owned result root and remove unused Kanban snapshot coupling. |
| ADR-043 external peers were not integrated, used inconsistent roots, regressed Maildir watcher readiness, and lacked identity/path/lock safeguards. | P1 | High | High | Council review of `b1b4b44`; current isolated correction and 76 focused tests. | Finish independent review and integrate the corrective patch. |
| Free-form gate commands conflict with documented non-executing/read-only contracts and are model-supplied shell strings. | P1 | High | High | `pi-doctor/doctor.ts:141-146`; `goal-tools.ts:146,153-154`; `kanban/complete-tool.ts:66-67,118-129`; related READMEs. | Council decision: constrain to named scripts or explicitly revise contract/docs; do not silently preserve ambiguity. |
| Entry-point reachability reports 1,796 LOC of production-unreachable extension code, while Knip treats tests/all-lib entries as usage. | P1 | High | High | Verified report `/tmp/production-reachability-report.md`: six retired standalone swarm modules and `teams/context-loader.ts` are deletion-safe; other POCs have explicit ADR retention/decision obligations. | Delete only the seven verified dead modules/tests now; retain quarantined/internal modules and escalate documented POC retirement decisions. |
| Five spawn/catchup tests are unconditionally skipped; core spawner execution and several command wrappers lack behavior tests. | P2 | Medium | High | `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts:51`; `tests/panopticon/spawner.test.ts`; coverage audit. | Complete test-first implementation or remove stale WIP test; add hermetic public-path characterization before refactor. |
| Matrix dedup/cache, session tail reads, file-watch hashing, and Bionic transformation lack resource bounds. | P2 | Medium | High | `pi-matrix/client.ts:56,113-114`; `lib/session-log.ts:28-30`; `file-watch/watcher.ts:86-107`; `bionic.ts:104-112`. | Apply bounded sets/reads/hashes and single-pass transform. |
| Documentation and registration drift across Kanban, Goal, CoAS approvals, Panopticon commands, Matrix SDK/prerequisites, and package enablement. | P2 | Medium | High | Root/extension READMEs, registration tests, architecture docs. | Update docs from verified public registration after behavior fixes. |

## No-go conditions

- Any fitness-test exception or budget increase used instead of splitting/simplifying.
- Public API removal, persistence-format change, or security-policy change without council/ADR disposition.
- Refactor advancement while focused or full gates fail.
- Touching excluded private/runtime/credential paths or overwriting owner changes.

## Refactor queue proposed for council

1. Finish and review ADR-043 correction.
2. Kanban transaction lock for append/claim/compaction.
3. Team-form ID confinement and Goal source real-path confinement.
4. CoAS `ConfinedStore` production adoption, awaited shutdown, and approval failure semantics.
5. Delete the retired standalone swarm path while preserving live ADR-040 aliases; harden shared child-process cancellation/output bounds.
6. Ollama public override removal/confinement; decide gate-command contract.
7. Matrix attachment resource bounds and bounded dedup/cache.
8. Goal projection consistency and Panopticon state-owner cleanup.
9. Verify and delete production-unreachable code; apply small bounded-cost fixes and documentation corrections.

## Verification

- Baseline `npm run check` — PASS; type coverage 99.17%.
- Baseline `npm test` — PASS: 150 files passed/1 skipped; 1087 tests passed/5 skipped.
- Final integrated `npm run check` — PASS; type coverage 99.17%.
- Final integrated `npm test` — PASS: 152 files passed/1 skipped; 1142 tests passed/5 skipped.
- Final integrated `git diff --check` — PASS.
- Architecture fitness — PASS: 52/52; every introduced budget violation was stop-and-fixed by extraction/simplification without changing tests or budgets.
- Bounded source/test credential scan — no apparent embedded production credentials; only synthetic fixture markers.
- Git forensics — six-month hotspot/coupling/churn and twelve-month ownership evidence collected under `/tmp/pi-extension-forensics/`.

## Final status

**PASS / release-ready.** The verified P0/P1 queue is complete. Final narrow security sign-off confirmed process-tree cancellation and approval-decision serialization; final architecture review confirmed scheduler shutdown, Goal projection serialization, team result-root consistency, transaction/state ownership, and public compatibility. Two council runs produced empty synthesis and are retained as a tooling limitation, not affirmative review evidence. Skipped tests and bounded P2/P3 cost/documentation debt remain tracked follow-ups.
