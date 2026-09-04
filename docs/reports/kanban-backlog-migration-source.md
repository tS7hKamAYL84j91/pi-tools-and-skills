# Frozen source record — TODO to Kanban migration

Status: active

Active provenance reference for the Kanban migration; the copied checklist remains frozen, not a maintained backlog. Preserve this source record.

This is a historical migration input, not an active backlog. Checkbox states below were copied from `TODO.md` and must not be maintained here. Kanban owns current priorities, ownership, blockers, and completion evidence.

Board migration was **confirmed by Gravitas on T-890** via agent message. Kanban remains authoritative; the following is the migration-time ID/disposition mapping, not a live status list. No implementation of the migrated UX work is implied.

| Source/workstream | Canonical disposition |
| --- | --- |
| Goal semantics, crashes, refinement | T-886; preserve current ownership |
| Goal/Kanban/Agents/Teams UX, read-only inspection, overlay navigation, recovery, validation | T-891 |
| Onboarding, first-use walkthroughs, usability | T-892 |
| CoAS docs, notification policy, human/tool parity, settings migration, deferred Matrix boundary | T-893 |
| Durable ticket-plan authority and backlog reconciliation | T-890 |
| Old goal prototype T-300 | Removed as duplicate of completed T-383 |
| Approval overlay T-816 | Removed as duplicate of T-822; T-840 prerequisite remains unresolved |
| Risk classification T-813/T-824 | Removed as duplicates of completed T-811 |
| Property-test probe T-841 | Removed as superseded by completed T-850; prior blocked history preserved |
| Old boost T-839/T-843/T-844/T-847/T-848 | Retained unresolved by board owner; not claimed delivered or safe for activation |
| Daemon T-819/T-865/T-873 | Retained for unresolved rollout |
| Approval resume / context curation / wakeAgent / governance | Retained T-815 / T-830 / T-833 / T-864 |
| Security and other remaining work | Retained T-795, T-883, T-884, T-885, T-888; cross-repo work remains with its authorized owner |

Gravitas confirmed the source fully mapped on T-890. T-891/T-892/T-893 require separate prioritization before execution. Consult the board for current ownership, blockers, scope, and evidence; this mapping does not authorize work outside this repository.

## Original source: Next Cycle (2026-09-01 final architecture & health review)

**Context:** the 2026-09-01 GM review (pi-goal `g-c59d1288`, epic T-875) is complete — 17 commits, v1.2.0 released, all gates green at `96a8204` (200 test files / 1,517 tests, knip clean, type-coverage 99.28%, CI double-green). This file is the forward backlog from the closing review. Board tickets: T-880, T-881.

## P1 — Immediate

- [x] **Pin `actions/setup-node` in `fitness.yml:18`** to the same commit SHA used in `ci.yml` (`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`) — fixed in the T-880 landing.
- [x] **T-880 — land the ADR-054 no-exemptions fitness rule + dispose test-only modules.** Rule now passes with zero violations; the full superseded boost authority/control cluster and pi-teams test-only modules were deleted, while the reviewed host bridge is exported from the package entry. P1 pin included in the landing (`6fa9a58`, `badd421`).
- [x] **T-881 — fix the pi-matrix issue** captured in `docs/images/Screenshot 2026-09-01 at 19.49.01.png`: legacy matrix-js-sdk `logger.log()` calls now stay silent; regression test added in `extensions/pi-matrix/tests/sdk-logger.test.ts` (`e95ef01`).

## P2 — Debt register (from the full lens scan; not gate failures)

- [x] **Adopt-or-accept decision on boundary decoding:** accept the existing typeof/narrowing style for now; the P2 security-sensitive dynamic-regex and escaping sites were hardened without introducing a new global lint gate. Revisit incrementally if the style becomes a correctness risk.
- [x] **Triage the 13 lens-blocking rule hits:** named JSON/domain types, explicit error handling, and the required SAFETY comment were added across the listed files (`f5eabdc`).
- [x] **DRY extraction candidates:** the highest-value scheduler run-state duplication was extracted into `extensions/pi-coas/lib/coas-run-state.ts` (`f5eabdc`); remaining low-risk pairs stay documented for later review.
- [x] **Complexity watch list recorded:** `lib/agent-registry.ts`, `pi-teams/team-registry.ts`, `pi-boost/boost-descriptor.ts`, `pi-teams/team-node-runner.ts`, `lib/session-log.ts`, and `pi-coas/scheduler-run-state.ts` are tracked for split-before-growth; current architecture fitness is green.
- [x] **Security hardening:** dynamic section/member matching now uses literal scans (no user-derived RegExp), prompt XML escaping is single-pass, and the listed P2 security sites are covered by the passing gate (`f5eabdc`).

## P3 — Recorded false positives (no action; re-verify only if tooling changes)

- [x] `package.json:33` gitleaks "generic-api-key" = the author's GitHub username; the repo's own policy (`.gitleaks.toml`) passes green in CI.
- [x] lens-knip "unused file `boost/command-types.ts`" — it is imported by `boost/command.ts:29-30`; the repo's `npm run knip` gate is clean.

## Outstanding Kanban triage

- [ ] **Inventory outstanding pi-tools-and-skills tickets.** Use read-only board export; inspect descriptions, notes, dependencies, and current repository evidence for backlog, todo, blocked, and in-progress tickets. Include legacy GM names; exclude other repositories' work.
- [ ] **Assign every in-scope ticket a disposition.** Retain actionable work in this backlog with its ticket ID, priority, acceptance criteria, and blockers; merge duplicates under a canonical ticket. Recommend closing obsolete, superseded, or out-of-scope work as **won't do**, with a short rationale. Mark already-delivered work complete only with implementation/validation evidence; never describe won't-do work as implemented.
- [ ] **Reconcile the board and TODO without losing history.** Record each ticket's disposition and cross-links; avoid duplicating existing UX/cleanup items. Preserve active ownership and WIP limits. Route shared Executive Office board updates through its authorized owner rather than mutating working-notes from this repo. Acceptance: every inventoried ticket has a recorded disposition, and every retained item links to its canonical board ticket.

## UX improvement backlog

Source: source/documentation review of onboarding, Goals, Kanban, Agents, and Teams; not yet validated by live usability testing. Preserve existing completed work below. These are proposals, not authorization to change runtime defaults.

### P0 — Predictable execution and safe inspection

- [ ] **Clarify goal approval and execution.** Coordinate with T-886; review existing ADR-055 before changing behavior. Propose explicit approve/run/resume semantics rather than implicit plan approval. Show run mode, approval state, and turn budget before execution. Acceptance: command tests cover creation, approval, run, pause/resume, and unapproved-plan handling; help matches behavior.
- [ ] **Separate Kanban inspection from persistence and maintenance.** Propose read-only inspection by default, with explicit snapshot export and compaction. Show the resolved board path and scope before mutations, particularly when `KANBAN_DIR` points outside the workspace. Acceptance: inspection tests assert no file writes, board events, backups, or compaction; existing export/maintenance behavior remains explicitly accessible.
- [ ] **Review public behavior changes before implementation.** Obtain council review for command/tool contracts and defaults; recheck and reserve the next repo-local ADR slot (currently 058, not reserved). Record migration/compatibility decisions. Do not change root-model defaults, residency, or schedule cadence.

### P1 — Usable terminal workflows

- [ ] **Make Kanban responsive.** Use a selected-column list with column tabs on narrow terminals; retain the five-column board on wide terminals. Keep titles and essential navigation visible. Acceptance: bounded rendering at 60, 80, and 120 columns, long titles/agent names, empty boards, and large boards; selection remains visible while scrolling.
- [ ] **Keep Agents current without losing navigation context.** Refresh open overlays using existing registry mechanisms; retain selected agent and search when returning from detail. Prioritize task/blocker information over model and uptime, and show observation age. Acceptance: status changes appear without reopening; removed agents and empty results recover gracefully; refresh resources are cleaned up on close.
- [ ] **Clarify Teams entry points and preview behavior.** Build on the existing `/teams` management/direct-run versus `/team` session-routing split; document compatibility surfaces separately. Resolve `/swarm` versus `swarm_run` default differences through the approved contract review above, not an unreviewed default flip. Acceptance: equivalent human/tool operations have tested, documented semantics and unmistakable preview/execution feedback.
- [ ] **Standardize overlay navigation.** Use `/` search, Enter detail, Escape back/close, and `?` help consistently where applicable. Preserve filters and selection on return; keep essential hints visible in narrow layouts. Acceptance: keyboard-only walkthroughs cover Agents, Kanban, and Teams without navigation dead ends.
- [ ] **Explain halted work and recovery.** Distinguish awaiting approval, budget exhausted, verification failed, paused, and stopped. Show the specific next action without bypassing approval or evidence gates. Acceptance: lifecycle tests verify the displayed reason and permitted recovery action.

### P2 — First successful use

- [ ] **Rewrite onboarding around one five-minute workflow.** Separate operator installation from local development. Explain global/project scope and write locations; replace personal absolute paths with portable examples. Include start work → inspect progress → handle a blocker → verify completion, with actual terminal screenshots and links to extension guides.
- [ ] **Make empty states actionable for humans.** Replace tool-only instructions such as “Use kanban_create” with an available human action or copyable natural-language request. Distinguish an empty board from a filter with no matches; offer a clear-filter action.

### Validation and delivery

- [ ] **Run first-time-user walkthroughs.** Record completion, wrong turns, unexpected mutations, and recovery friction for the onboarding workflow; distinguish observed issues from source-review hypotheses.
- [ ] **Preserve existing strengths.** Keep quiet notifications, progressive disclosure, filtering, text status labels, and destructive-action confirmations. Test keyboard-only and monochrome use, terminal resizing, and long Unicode content.
- [ ] **Delegate and review bounded patches.** Implement one approved slice at a time; run focused interaction/render tests, LSP/lens diagnostics, `npm run check`, and `npm test`. Update affected help/READMEs and C4 documentation before implementation commits; obtain pair review for substantive changes.

## Next review — user-facing extension cleanup

- [ ] **Clarify pi-coas scheduler documentation (no behavior change).** Document that `pi-coas` owns cron-like scheduled prompt delivery and that enabled schedules run while Pi is open; retain the current scheduler implementation and reconciliation behavior.
- [ ] **Make Panopticon reconciliation notifications opt-in.** Default to silent sessions; persist the setting in global/project `.pi/settings.json`; retain explicit health/status inspection and event handling.
- [ ] **Align agent and human tool behavior.** Agent-facing tools must perform the same operation and use the same defaults as their corresponding user commands (especially `/swarm` and `swarm_run`); dry-run must remain an explicit, clearly named mode.
- [x] **Consolidate duplicate user commands.** `/teams` owns team management/direct runs and `/team` owns session routing; `/agents` opens the overlay and `/agents-mode` selects its filter. Removed redundant `/agent-list-mode` alias; documentation and help now state the split.
- [ ] **Move extension configuration from environment variables to Pi settings.** Prefer namespaced global/project `.pi/settings.json` values for user-facing configuration; remove environment-variable configuration where practical. Keep team manifests and runtime state files as intentional configuration/state surfaces.
- [ ] **Leave Matrix review deferred.** No Matrix behavior or permission changes in this cycle; revisit its UX and authorization model separately.

## Done in the prior cycle (record)

- 2026-09-01: review goal `g-c59d1288` complete — ADR-053 daemon-protocol extraction (published boundary enforced by architecture guard + tarball proof); ADR-054 disposition (4 test-only modules + tests/fixtures deleted, pi-teams child-process boundary zero); CI hygiene via Jules PRs #52/#53/#54; lint+knip scope extended to `scripts/`; ADR index created; **1.2.0 released** (all 13 package versions aligned); the in-flight boost stream completed and landed (ADR-052 single-model default, line-budget module splits, live smoke test removed); the recurring `t873-step1-execution` date-assertion flake root-cause fixed. See `CHANGELOG.md` [1.2.0] and `docs/adr/README.md`.
