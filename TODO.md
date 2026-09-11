# Work tracking

Work directly from Jim's requests and current repository evidence. Do not load
or manage Kanban from this project's agents; Gravitas owns the optional
human-facing overview. Board updates, planning documents, and status logs are
not prerequisites for doing the work. Do not duplicate execution records here.

## Boost plan mode — actually write TODO.md

Requested by Jim (2026-09-10). Root cause: the `/boost plan` prompt (PLAN_FRAME in
`extensions/pi-boost/boost-modes.ts`) said "planning only — do not start
implementing, modify files, or treat it as authorization to execute", so the model
refused to modify files and only replied in chat. The prompt was the problem.
Fixed: PLAN_FRAME now explicitly directs the model to write the plan to `TODO.md`
while forbidding implementing code or modifying other files.

- [x] **Prompt fix in PLAN_FRAME** (`extensions/pi-boost/boost-modes.ts`).
  Implemented: updated PLAN_FRAME to explicitly instruct writing the plan to
  `TODO.md`, while retaining the execution guard (write `TODO.md`, but do not
  start implementing or modify other files).
- [x] **Preserve legacy frame skipping in context extraction** (`boost-modes.ts`).
  Implemented: `isBoostFramed` checks the shared plan prefix so both new and
  legacy plan-framed messages in session history are skipped when finding the
  most recent user problem.
- [x] **Regression tests** (`tests/boost/pi-boost-modes.test.ts`).
  Implemented: verified PLAN_FRAME framing with `write it to TODO.md` clause and
  added test asserting legacy plan-frame prompts in branch history are skipped.
- [x] **Update documentation** (`extensions/pi-boost/README.md`).
  Implemented: documented that `/boost plan` authorizes writing `TODO.md` while
  forbidding modifying other files or executing code.
- [x] **Default boost mode = verbatim prompt injection (T-915)**.
  Implemented: plain prompt injection is default (no framing, no mode word
  consumed); plan and challenge remain opt-in via first word.
- [x] **Validation**: 79 boost unit tests pass; `npm run check`, `npm test`,
  `git diff --check` clean.

## Extension UX coherence

Conventions established in ADR-061: one command per concern, uniform
subcommand grammar, consistent status channels, shared settings I/O.

- [x] **Audit all nine extensions' commands, overlays, settings I/O, and status channels**.
  Implemented: documented inconsistencies and established target patterns in
  `docs/adr/061-extension-command-surface-conventions.md`.
- [x] **Conventions ADR** (`docs/adr/061-extension-command-surface-conventions.md`).
  Implemented: one primary stem per concern, standard subcommands, non-breaking
  aliases, standardized toggle helper, and shared advisory-locked settings persistence.
- [x] **Shared toggle command helper** (`lib/toggle-command.ts`).
  Implemented: `registerToggleCommand` provides uniform `on|off` handling, status
  reporting, and error notification. Reused in `extensions/pi-kanban/watcher-control.ts`
  and `extensions/pi-panopticon/registry/reconciler-control.ts`. Unit tested in
  `tests/shared/toggle-command.test.ts`.
- [x] **Shared settings persistence block** (`lib/pi-settings.ts`).
  Implemented: `savePiSettingsBlock` provides advisory-locked, atomic read-modify-write
  block persistence with safe mode 0o600. Reused in `extensions/pi-kanban/watcher-settings.ts`
  and `extensions/pi-panopticon/registry/reconciler-settings.ts`. Unit tested in
  `tests/shared/pi-settings.test.ts`.
- [x] **Single-stem command consolidation with backward-compatible aliases**:
  - `/goal clear` handler reused by `/goal-clear` alias (`extensions/pi-goal/goal-commands.ts`).
  - `/agents external [list|register|remove]` wired to `/agents` with `/agent-external-*` aliases preserved (`extensions/pi-panopticon/ui/agents-command.ts`, `external-agent-command.ts`).
  - `/coas [status|doctor|workspaces|schedules|scheduler]` root command with `/coas-*` and `/pi-scheduler` aliases preserved (`extensions/pi-coas/commands.ts`).
- [x] **Validation**: all unit test suites, namespace checks, typecheck, lint,
  knip, type-coverage, and full test suite pass.

## Kanban — refactoring required after implementation review

Review of `00f293e`: the existing passing tests are a baseline, not a correctness
sign-off. The smaller `overlay.ts` masked substantial overall growth (seven new
modules). Fix behavioral gaps before adding features; keep live boards untouched.

Completed 2026-09-10 on top of `00f293e`; the checklist records the delivered
state. Live boards and deployments were never touched; all fixtures are
ephemeral.

### P1 — correctness and lifecycle

- [x] **Prevent stale-view claim reassignment** (`overlay-actions.ts`, `board-actions.ts`).
  Implemented: `claimTask` gained a `claimOnly` policy option enforced inside
  the locked transaction; the overlay always sets it, tools keep reassignment.
  A stale selection that another actor claimed yields an `in-progress-owner`
  outcome with the owner's name — no UNCLAIM/CLAIM is appended. Regression:
  controller test seeds a competing claim after the view renders and asserts
  the overlay is denied and steals nothing.
- [x] **Single-source completion orchestration** (`board-actions.ts`,
  `complete-tool.ts`, `overlay-actions.ts`). Implemented:
  `orchestrateTaskCompletion` (fresh preflight validation → trusted gate with
  caller-supplied signal → cancellation checkpoint → locked revalidating commit)
  is the only completion path; both entry points call it and keep their own
  presentation. Tool result text and messages are unchanged (complete-gate tool
  tests pass unmodified). Regressions: overlay gate pass/fail, owner and
  verification denials through the shared messages, abort-mid-gate commits
  nothing, gate failure/ownership changes while running.
- [x] **Own pending actions and shutdown** (`overlay.ts`, input modules).
  Implemented: `runOperation` serializes one board mutation per overlay —
  repeated keys flash `Busy — … already running` and start nothing — and hands
  each operation an `AbortSignal`; `dispose()` aborts a pending gate and
  suppresses further flashes/renders. Events already committed to board.log
  are retained. Regressions: double-`x` during a slow gate commits exactly one
  COMPLETE; disposal during a running gate commits nothing.
- [x] **Make live/stale reporting truthful** (`overlay-watcher.ts`).
  Implemented: `live` is true only while the stream is healthy AND the last
  parse succeeded. Parse failures mark the view stale (recovering on the next
  successful parse); an empty parse is re-read once before acceptance, so
  compaction's truncate-then-write is never mistaken for an empty board; a
  deleted/replaced log detaches the inode watch, so every outage schedules one
  bounded restart that re-attaches and catches up on missed changes;
  successful local actions refresh the view even while the watch is dead.
  Regressions (`pi-kanban-overlay-watcher.test.ts`): start failure → restart
  recovery, disappearance → stale → recovery, mid-rewrite empty never accepted,
  atomic replacement followed, dispose cancels pending parses; controller test
  shows the `· not live` header.

### P2 — simpler design and usable interactions

- [x] **Simplify by responsibility, not metric thresholds**. Implemented: the
  duplicated completion prechecks and gate code were removed (single
  orchestration); the create retry-on-error-text loop is gone (id allocation
  under the lock); `applyPromptInput`'s hand-rolled buffer editor was replaced
  by Pi's `Input`; claim/complete/block/unblock/create moved to
  `board-actions.ts` next to the other domain operations, leaving tool files as
  registration + result mapping. The architecture assertion requiring
  `withBoardTransaction` in claim-tools.ts was updated to point at the real
  boundary (board-actions.ts); safety gates, concurrency semantics, and the
  no-compensating-append policy tests are unchanged. `claim-tools.ts` went from
  253 to ~150 lines; `overlay-actions.ts` from 255 to ~200; no wrapper was kept
  without a consumer. A budgeted line exception was added for the consolidated
  `board-actions.ts` (460) with remediation guidance and a 90-day target.
- [x] **Allocate new IDs under the board lock** (`board-actions.ts`).
  Implemented: `createTaskWithNextId` computes the id inside the transaction;
  explicit-id `createTask` keeps its uniqueness check inside the lock. The
  false "atomically" comment is replaced by an honest durability note: log
  event under lock, task file after; a file-write failure returns
  `fileWarning` and both surfaces report partial success ("do not retry
  creation"), instead of throwing and inviting a duplicate-id retry.
  Regressions: sequential + concurrent `Promise.all` creators get distinct
  ids; duplicate explicit ids still reject; overlay partial-success path with
  an unwritable tasks directory.
- [x] **Use native text input and viewport-aware rendering**. Implemented:
  prompts embed pi-tui `Input` (cursor/word/undo editing, bracketed paste) with
  `Focusable` propagation for IME cursor positioning; dialog hints wrap within
  the frame instead of truncating; the board renders a bounded window
  (VIEWPORT_ROWS=10) with per-column scroll keeping the selection visible;
  detail content scrolls (`↑ ↓`) through a bounded window with a position
  indicator. The all-rows blessing test was replaced by viewport/scroll tests.
  Regressions: bracketed paste + unicode title creation, viewport window +
  scroll-into-view, detail scroll/clamp, narrow-width hint wrapping.

### Evidence and documentation

- [x] New regression cases added before marking complete: 7 watcher lifecycle
  tests, 3 board-action allocation tests, and 8 new controller tests (stale
  claim, busy serialization, abort-mid-gate, overlay gate pass/fail,
  partial-success creation, paste/unicode prompt, detail scroll, not-live
  indicator), with real key sequences (`\x1b[B`/`\x1b[A`/paste sequences) and
  `vi.waitFor` instead of sleeps where practical; gate tests use real
  `sleep`/`exit` commands.
- [x] README/API comments corrected to match tested behavior: configured gates
  run from the overlay; `KANBAN_OVERLAY_AGENT` is an audit label, not an
  authenticated identity; completion orchestration is single-sourced; the
  log/task-file durability boundary is documented; busy/cancel and truthful
  live/stale behavior are documented.
- [x] Focused kanban + architecture suites pass (185 tests); full `npm run
  check`, `npm test`, `git diff --check` run at completion. Tool responses,
  event compatibility, ownership/WIP/evidence guards, and existing history
  preserved. Optional mouse support remains out of scope (see below).

## Kanban overlay UX improvements

Requested by Jim after the overlay UX review (2026-09-09). Priorities below follow
that review. Keep the board's guards (ownership, WIP, completion gates) intact and
reuse the tool-layer transactions rather than duplicating board logic in the overlay.

### P1 — unblock the overlay's main jobs

- [x] **Resolve the hardcoded overlay identity** (`extensions/pi-kanban/overlay.ts`, `OVERLAY_AGENT = "lead"`). Every overlay mutation is logged as `lead` regardless of who acts. Decide and implement an accurate operator identity (explicit setting or derived label) before adding claim/complete keys, since ownership guards and audit attribution depend on it.
  Implemented: overlay mutations are recorded under `KANBAN_OVERLAY_AGENT` (default `operator`); ownership guards use the same identity, and the tool layer keeps its own explicit agents.
- [x] **Add claim/complete keys** (`c` claim next eligible todo task, `x` complete the selected owned in-progress task). Route through the same claim/complete transactions and gates the tools use; never bypass WIP, owner, or configured check evidence. Denied actions must explain why in the status line.
  Implemented: `c`/`x` route through `claimTask`/`completeTask` (shared with the tools); WIP, owner, verification, and gate denials show explanatory status lines; evidence-required completion is denied with a pointer to `kanban_complete`; configured gates run from the overlay. Gate orchestration is still duplicated and needs the refactor above.
- [x] **Add create and block keys** (`n` new task via the editor, `b` block with a reason prompt, `B` or `u` unblock). Keep confirmations only where the tools require them.
  Implemented: `n` inline title prompt (backlog, medium, next free id), `b` inline reason prompt, `u` unblock. Delete keeps its explicit `y` confirmation.
- [x] **Fix the empty-board dead end** (`overlay-render.ts`). Offer `n` directly instead of telling the human to ask an agent for `kanban_create`.
  Implemented: "No tasks yet — press n to create one (or use kanban_create)."

### P2 — feedback and affordance

- [x] **Confirm successful actions** (`overlay.ts`). Moves, deletes, claims, and completions should show a transient status line (e.g. `Moved T-12 → todo`); today only failures produce output.
  Implemented: every action flashes a transient status; any next board key clears it.
- [x] **Surface dead live-refresh** (`overlay.ts`, `startWatcher`). When `board.log` cannot be watched, show a stale/live indicator in the header instead of failing silently.
  Implemented: header shows `· live` / `· not live` from the watcher state (`overlay-watcher.ts`).
- [x] **Align delete confirmation keys** (`overlay.ts`, `lib/tui-confirmation.ts`). The dialog shows `[y] confirm · [esc/n] cancel` but the controller also accepts Enter; either render the Enter affordance or remove it so the destructive default does not share the key that opens detail views.
  Implemented: Enter no longer confirms deletion; only explicit `y` proceeds. Covered by controller regression test.
- [x] **Make the low-priority badge visible** (`overlay-render.ts`, `priorityBadge`). Blank is indistinguishable from unset; use a dim marker.
  Implemented: dim `+ ` badge for `low`.
- [x] **Guard move-picker no-ops** (`overlay.ts`). Picking the task's current column should not fire a transaction; consider arrow-key support alongside `1`/`2`.
  Implemented: current-column choice is a guarded no-op; `↑/↓` + enter select alongside `1`/`2`.

### P3 — polish (optional)

- [x] Cycle board theme in-session (`t` key: default/focus/mono) instead of requiring `KANBAN_BOARD_THEME` before startup.
- [x] Mention `q` in the detail-view hint; wrap or drop the header hint line on narrow terminals instead of truncating title+hints together.
  Implemented: detail hint lists esc/←/q; header split into title row (with live indicator) plus two dedicated hint rows that degrade independently.
- [ ] Mouse click-to-select column/row — deliberately skipped: pi-tui mouse support would grow the controller for little gain; reopen if it becomes valuable.

### Validation

- [x] Extend `tests/kanban/pi-kanban-overlay-controller.test.ts` (and render/selection tests where applicable): new keys, denied-action messages, identity attribution, watcher-off indicator, confirmation key handling.
  15 controller tests now cover claim/complete (guards + ownership + verification), create, block/unblock, delete keys, move no-op, identity env, live indicator, theme cycling, and transient status; render/snapshot tests cover the standard confirmation wording.
- [x] Reuse disposable board fixtures; never touch live `KANBAN_DIR` boards or Gravitas's deployment.
- [x] Run `npm run check`, `npm test`, `git diff --check`. Preserve tool-layer behavior, permissions, and persistence compatibility; report pre-existing warnings separately.

Implemented as a concern split the architecture tests prescribe: `overlay.ts` (controller, 229 lines) +
`overlay-input-state.ts` (interaction state) + `overlay-input.ts` (submode keys) +
`overlay-board-keys.ts` (navigation/action keys) + `overlay-actions.ts` (action wrappers with
status messages) + `overlay-watcher.ts` (live refresh) + `overlay-dialogs.ts` (modal renderers).
Claim/complete/block/unblock/create transactions were extracted so tools and overlay share one
transaction implementation (`claim-tools.ts` keeps claim conflict handling;
`board-actions.ts` hosts the rest). This does not single-source gate orchestration.
Existing tool tests passed; moved-renderer imports and explicit overlay identity fixtures
were adapted. The original validation run passed all 167 kanban + architecture tests
including line budgets, hotspot reduction, cohesion (LCOM96b < 0.8), parameter limits, and
cycle rules. Pre-existing repo lint warnings (13) are unchanged and unrelated.

## Code-health follow-ups

Requested by Jim after the repository-wide review. Keep fixes bounded and preserve
public contracts, persistence compatibility, permissions, and live configuration.

### High priority

- [x] **Enforce File Watch path restrictions** (`extensions/pi-file-watch/watcher.ts`). Validate resolved targets independently of watch behavior; prevent an internal symlink from bypassing `allowExternalPaths: false` when `followSymlinks: false`. Add regression tests for file and parent-directory symlinks, both flags, and target changes. Rejected targets must not be read or hashed.
- [x] **Preserve Boost recovery state after failed dispatch** (`extensions/pi-boost/index.ts`). Treat `setModel()` returning `false` during baseline restoration as a failure, retain the original model, and block further boosts until restoration succeeds. Test both false returns and thrown errors, status reporting, and `/boost reset` recovery.

### Medium priority

- [x] **Bound subagent output retention** (`extensions/pi-panopticon/spawner/spawn-service.ts`). Apply the recent-event cap to stderr as well as stdout; bound retained bytes and unfinished stdout lines. Preserve RPC framing for valid messages and define explicit handling for oversized frames. Test stderr floods and large unterminated lines with mocked children.
- [x] **Truncate Fleet inbox text on UTF-8 boundaries** (`fleet-mcp/gateway.ts`). Ensure returned text is a valid prefix of the input and never exceeds `maxTextBytes`. Preserve the response shape and truncation flag. Test ASCII, multibyte characters, emoji, and exact-boundary inputs; `éé` truncated to three bytes must return `é`, not `é�`.
- [x] **Remove unbounded synchronous File Watch hashing** (`extensions/pi-file-watch/watcher.ts`, `config.ts`). Choose and document streaming asynchronous hashing or an explicit size limit with hash omission. Resolve the unused `maxBytes` setting deliberately; preserve metadata-only notifications and cancellation/reload behavior. Test large files, unreadable/deleted targets, and pending work during reload.

### Documentation

- [x] **Refresh bundled Pi development references** (`skills/pi-extension-dev/references/`). Verify examples against the installed SDK and current documentation; replace obsolete `@mariozechner/*` imports with supported APIs. Do not assume a namespace-only replacement is sufficient. Preserve skill names, activation descriptions, and safety instructions.

### Validation

- [x] Add focused regression tests for each fix, using disposable files and mocked models/processes; do not touch live configuration or private state.
- [x] Run `npm run check`, `npm test`, `npm run build:fleet-mcp`, and `git diff --check`. Run architecture tests for boundary changes and knip for changed exports/deletions. Report pre-existing warnings separately from regressions.
- [x] Complete targeted diagnostics where the broad review scan timed out; do not interpret partial scan results as a clean audit.

Implemented with bounded metadata reads in `file-metadata.ts`, shared Boost
restoration, bounded spawned-worker output, and UTF-8-safe Fleet truncation.
Validation: 100 focused tests and all 1,311 tests passed; repository checks
(including knip), architecture tests, Fleet build, and diff checks passed.
Both documented TypeScript examples typechecked against SDK 0.84.4. Targeted LSP
checks passed, including the previously inconclusive Python setup script.
The 12 existing lint warnings remain; live configuration and deployments are unchanged.

## F.I.R.E. simplification — Goal, Teams, Kanban

Requested by Jim and implemented. This checklist records completed scope, not an
execution log. Model/profile defaults and live configuration were not changed.

### 1. Goal — remove generated process scaffolding

- [x] Remove task-claim, dated-note, and ready-for-review instructions from generated goal content (`extensions/pi-goal/goal-render.ts`).
- [x] Stop generating the disabled `PLAN.md` and consolidate redundant generated SPEC/STATUS/TODO projections into authoritative state plus one useful human-readable summary (`goal-persist.ts`, `goal-files.ts`). Preserve user-supplied source documents and existing history.
- [x] Remove the obsolete `/goal plan` and `/goal approve` no-op commands.
- [x] Preserve immediate execution, stop/pause/resume, single-driver ownership, session lineage, liveness containment, and evidence-based completion gates.
- [x] Test creation, file-backed goals, resume/recovery and completion; verify new goals do not recreate the removed scaffolding. Update usage docs.

### 2. Teams — one clear execution path and one state authority

- [x] Choose and document one canonical run/status/stop interface; identify redundant `/team`, `/teams`, `team_*` and `runtime_*` surfaces before removing them.
- [x] Consolidate redundant modes and aliases while retaining useful synchronous/asynchronous execution and cancellation. Do not add replacement compatibility machinery.
- [x] Make `TeamStateManager` authoritative; derive runtime views rather than maintaining competing team lifecycle records.
- [x] Keep Navigator optional, and Council/research explicitly requested or justified by the task. Ask Jim before changing model, routing, or profile defaults.
- [x] Test run/status/stop consistency, completed-run stop rejection, cancellation, session restoration and async delivery. Update commands, tools, skills and docs together.

### 3. Kanban — separate viewing from housekeeping

- [x] Make routine board/task viewing read-only: no snapshot-file writes, SNAPSHOT events, or compaction just to inspect the board (`extensions/pi-kanban/board-tools.ts`).
- [x] Keep snapshot export and compaction explicit, clearly named operations; remove maintenance coupling from the viewing path.
- [x] Keep Kanban an optional human overview owned by Gravitas, not an execution prerequisite for project agents.
- [x] Preserve owner checks, configured verification/completion gates, confirmations, durable history and backups.
- [x] Test that viewing leaves files/events unchanged, while explicit export and compaction retain their intended behavior. Update tool descriptions and docs.

### Validation

- [x] Run focused tests for each changed feature, then `npm run check`, `npm test`, and `git diff --check`. Report remaining risks without creating parallel progress reports.

## Historical references

The former board migration is recorded under T-890, with T-886 (Goals), T-891
(UX), T-892 (onboarding/usability), and T-893 (extension cleanup). These are
historical lookup references, not current priorities or authorization to start.

The [frozen migration source record](docs/reports/kanban-backlog-migration-source.md)
preserves the previous checklist and migration-time dispositions.
