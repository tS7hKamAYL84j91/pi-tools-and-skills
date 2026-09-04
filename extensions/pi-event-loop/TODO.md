# TODO — pi-event-loop implementation

**Source of truth:** `SPEC.md` (final implementation brief). P1–P10 below record the original implementation pass; they do **not** establish current conformance. A 2026-09-04 review against the implementation, current Pi extension/TUI documentation, and `docs/architecture.md` reopened the work in P11–P14. Definition of done = SPEC.md §21; acceptance criteria = SPEC.md §20 (AC-1..26).

**Current verdict:** not definition-complete. Focused tests pass (19 files / 150 tests), but mocks do not cover several host-runtime and operator-control failures. Do not restore the completion claim until every P11 blocker and P14 regression test is closed.

## P1 — Scaffold and configuration

- [x] **Package scaffold:** `package.json` (name `pi-event-loop`, `pi.extensions: ["./index.ts"]`, node >=22), `index.ts` entry, `README.md`. (§19)
- [x] **`types.ts`:** `TodoItem`, event/command/view/automation/timer shapes; deterministic ID helpers `sha256(profile + …)` for events, work items, commands. (§8, §9, §10)
- [x] **`config.ts`:** load + strictly validate `.pi/event-loop.json` — reject unknown fields, duplicate identifiers, references to undefined events/commands/views, incompatible `closeOn.keyFrom`, commands with no `expectedEvents`, invalid JSON Pointers/timers, limits outside hard-coded ceilings. (§6, §18)

## P2 — Event log and ingress

- [x] **`event-log.ts`:** append-only custom Pi session entries (eventId, type, occurredAt, source, payload, commandId, workItemId, correlationId, causationId). Never edit or delete. (§8)
- [x] **`event-ingress.ts`:** `event_loop_emit` tool with schema/description generated from the active profile (agent-emittable events, descriptions, required payload fields, active command's expected events). Enforce command-contract emission policy, `allowWithoutCommand`, payload key/size validation, correlation-key match against the active todo item, dedupe by stable event ID. Transaction order: validate → validate payload → derive ID → append → project → scan views → queue commands → return IDs. (§7)
- [x] **Rejection discipline:** unknown or context-invalid events rejected before append; duplicates return prior result with no second projection/command. (AC-2, AC-3)

## P3 — Projections and views

- [x] **`projector.ts` + `todo-view.ts`:** pure, replayable `openOn`/`closeOn` projections; create row only if deterministic ID absent; `closeOn` completes every open row with matching key without fabricating rows; unmapped facts retained with no effects; configuration order must not change results. (§9)
- [x] **Replay equivalence:** replaying the same history produces byte-equivalent view state. (AC-7)

## P4 — Automation, command queue, dispatch

- [x] **`automator.ts`:** one automation reads one view, issues one configured command per outstanding row in sequence; no domain branching. (§10)
- [x] **`command-queue.ts`:** FIFO, session-local; dedupe by `sha256(profile + automationId + workItemId)`; one active command; persist before delivery; bounded by `maxPendingCommands`; cancel queued undelivered commands whose item is already completed. (§10, §11, §13)
- [x] **`dispatcher.ts`:** deliver command as self-describing Pi message (`customType: "pi-event-loop-command"`, details with commandId/type/workItemId/correlationId/causedBy/workItem/expectedEvents) via `sendMessage(…, { triggerTurn: true, deliverAs: "nextTurn" })`. Commands issued mid-turn wait for `agent_settled`. (§5, §10, §11)

## P5 — Lifecycle, timers, state

- [x] **`session-state.ts`:** persist events, active profile + config fingerprint, projection checkpoint + bounded view snapshot, pending/active commands, recent IDs, timer occurrence state, paused state + reason. Recovery: load latest snapshot, replay later events; fingerprint change → full projection rebuild. (§15)
- [x] **`timers.ts`:** `intervalMinutes` and `dailyAt`; timer occurrence appends a declared fact (never invokes agent directly); catch-up emits at most the latest missed occurrence (daily: none); unref'd handles cleared on shutdown/reload/profile change; run only while session is open. (§12)
- [x] **Pi lifecycle hooks:** `session_start` (load/validate/restore/replay/catch-up/rebuild/deliver), `input` (reset consecutive automated-turn counter), `agent_start`, `agent_settled` (settle; missing expected event → stall item, pause delivery with `missing-outcome`), `session_shutdown` (checkpoint + clear timers). Do **not** use `agent_end` as settlement boundary. (§17)

## P6 — Loop protection

- [x] **Enforce all limits:** causal chain depth, consecutive event-loop turns, per-view open items, queue size, one active command; pause on exhaustion with operator-visible reason. (§14, AC-21)

## P7 — Operator controls

- [x] **`status.ts` + commands:** `/event-loop status|views|history|pause|resume|retry|reload|use|emit|issue`. `emit` uses source `operator` via the normal path; `issue` is a diagnostic hatch that must not fabricate domain events. (§16)
- [x] **`event_loop_context` read-only tool:** active command/work item, expected event contracts, pause state, view row status; no command selection or mutation. (§16)

## P8 — Correction and compensation

- [x] **Retraction path:** accept `correctsEventId` compensation facts as normal configured slices; runtime may cancel queued undelivered commands but never pretends to undo performed domain work. (§13, AC-22)

## P9 — Tests (fake timers, no real sleep)

- [x] Unit tests per module: config validation, ingress contract/rejection/dedupe, projection purity + replay equivalence, automator/queue idempotency, dispatcher turn-gating, timer catch-up bounds, lifecycle hooks, missing-outcome stall, loop-protection limits, persistence/recovery, two-session independence.
- [x] Cover all 26 acceptance criteria (§20) explicitly; include fake-timer, replay, idempotency, missing-outcome, and loop-protection suites. (§21)

## P10 — Gates and docs

- [x] **Repo gates clean:** `npm run check` (typecheck strict + knip + type-coverage ≥95%) and `npm test`; no lint suppressions. (AC-26)
- [x] **C4 architecture doc** in `docs/` with Mermaid (port SPEC.md §4/§5 diagrams) + example Event Model profile. (§21)
- [x] **Isolation audit:** no OODA/Panopticon/CoAS/cross-session logic, no imports from other extension directories; works with all other extensions disabled. (§2, AC-23–25)

## P11 — Functional gaps reopened by implementation review

### Blockers

- [x] **Replace polling with the current `agent_settled` hook and correct delivery semantics.** `lifecycle.ts` registers only `agent_start`; `dispatcher.ts` still claims Pi has no `agent_settled`. Current Pi exposes the hook. `deliverAs: "nextTurn"` also ignores `triggerTurn`, so it cannot start the automated command turn; dispatch from the settlement boundary using a supported triggering mode without interrupting an active turn. (SPEC §5, §11, §17; AC-12–15)
- [x] **Make the delivery pump re-entrant.** `scheduleDeliveryCycle()` sets `state.pumping = true` and never clears it. Once the initial cycle exits, later accepted events, timers, retries, resumes, and diagnostic issues cannot start another cycle. Clear the guard in `finally`, handle work queued during teardown, and test idle-start → later-event delivery. (`lifecycle.ts`; AC-12, AC-13)
- [x] **Settle by item closure, not merely by any expected event.** `commandEmittedOutcome()` treats an expected event as success even when it did not close the active row; `checkCorrelation()` silently accepts expected events with no `closeOn` rule. Validate automation command outcomes against the automated view and require the active item to be completed before clearing the command. Otherwise pause as `missing-outcome`. (`dispatcher.ts`, `event-ingress.ts`, `config-profile.ts`; AC-14, AC-15)
- [x] **Deliver the complete self-describing command contract.** `buildCommandMessage()` puts only `command.message` in visible/model text; identifiers, expected events, and work-item data exist only in `details`. Render the SPEC §10 text contract and clearly delimit source payload as untrusted data, not instructions. (SPEC §10, §18; AC-10)
- [x] **Make operator controls operational and durable.** `/event-loop reload` is a no-op success string; `use` only rewrites JSON; `resume`, `retry`, and `issue` do not restart delivery; pause/resume/retry/issue changes are not checkpointed immediately; `issue` uses hard-coded limits instead of configured limits. Route all mutations through one runtime service that persists, restarts timers/pump as needed, and reports actual outcomes. (`event-loop-commands.ts`, `event-loop-issue.ts`; SPEC §16–17)

### High-priority correctness

- [x] **Generate and refresh the emit tool contract from live state.** `EMIT_PARAMS` is static, the description is built once from `process.cwd()`, and it never reflects the active command, session cwd, reload, or profile switch. Generate both schema and description from the active profile and permitted active-command outcomes; re-register dynamically when that contract changes. (`event-ingress-tool.ts`, `index.ts`; SPEC §7; AC-11)
- [x] **Enforce `allowAgentEmit` during command turns.** The active-command branch currently checks only `expectedEvents`, allowing an expected event whose declaration has `allowAgentEmit: false`. Reject invalid profiles or enforce both constraints at ingress. (`event-ingress.ts`; SPEC §7, §18; AC-3)
- [x] **Preserve replay and causal lineage across bounded snapshots.** `boundedItems()` drops completed rows beyond 100 while recovery replays only post-checkpoint events; this changes recovered view state and loses ancestry used by `eventChainDepth()`. Store the minimal complete lineage/index needed for deterministic projection and chain-limit enforcement, or replay enough history to reconstruct it. (`session-state.ts`, `loop-guards.ts`; SPEC §14–15; AC-7, AC-18, AC-21)
- [x] **Fix timer contract and timezone edges.** Reject timer targets whose required payload cannot be produced from `{scheduledFor}`; do not advance occurrence state when append fails; compute the next `dailyAt` by local calendar date rather than adding 24 hours so DST preserves wall-clock time. (`config-profile.ts`, `timers.ts`, `timer-schedule.ts`; SPEC §12, §18; AC-16–17)
- [x] **Use one loaded configuration authority.** Tool and command executions reload the file independently from lifecycle state, permitting validation against a new profile while projecting/dispatching with stale runtime state. Reload atomically, stop timers, rebuild on fingerprint change, refresh tools/UI, and resume only after success. Distinguish missing files from permission and other I/O errors. (`config.ts`, `event-ingress-tool.ts`, `event-loop-context.ts`, `event-loop-commands.ts`)
- [x] **Use the Pi project config directory contract.** Replace hard-coded registration-time `.pi`/`process.cwd()` assumptions with session `ctx.cwd` and `CONFIG_DIR_NAME` where compatible with the specified file name; verify project trust before honoring project-local executable configuration. (`config.ts`, `index.ts`; current Pi extension guidance)
- [x] **Align the repository SDK baseline with the runtime documentation.** Root dependencies still pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` 0.74 while the installed runtime/docs are 0.84.4; this hides the typed `agent_settled` hook and current TUI contracts. Upgrade the paired packages together, remove temporary compatibility casts, and run the full repository suite before claiming host compatibility.

## P12 — Refactoring and simplification

- [x] **Collapse obsolete settlement machinery.** After adopting `agent_settled`, remove `waitForTurnStart`, hour-long idle polling, duplicate timeout constants, and the polling-specific `delivery-cycle.ts` state machine. Keep one small event-driven queue transition service.
- [x] **Remove duplicate runtime reset logic.** Use `resetEventLoopRuntime()` from `runtime.ts` instead of maintaining a second field-by-field reset in `lifecycle.ts`.
- [x] **Centralize operator JSON-object parsing and deterministic canonicalization.** `emitOperatorEvent()` and `issueDiagnostic()` duplicate parsing/validation; stable IDs currently depend on `JSON.stringify` property order.
- [x] **Split `validateProfile()` by responsibility.** The 240-line, complexity-38 validator mixes structural parsing, identifier collection, and cross-slice compatibility. Extract pure cross-reference/automation-contract validation without adding a framework.
- [x] **Consolidate todo status transitions.** `todo-view.ts` duplicates map-copy/update logic for dispatched, stalled, and outstanding transitions; use one private immutable update helper.
- [x] **Reduce accidental public API.** Remove exports used only by tests/internal wiring (`EventLoopCommandDeps`, `executeOperatorCommand`, and similar) or test through the registered boundary. Keep exported symbols to independently consumed contracts.
- [x] **Resolve review diagnostics without exemptions.** Remove the operator JSON duplicate block and todo transition clones reported by jscpd. Review the JSON Pointer prototype-pollution warning; record a justified false-positive disposition if read-only `Object.hasOwn` traversal is retained rather than weakening pointer support.

## P13 — TUI and operator UX alignment

- [x] **Add a compact persistent status indicator.** Use `ctx.ui.setStatus("pi-event-loop", …)` with callback-provided theme colors: paused/error reason, active command, and pending count only. Refresh on every runtime transition and clear it on shutdown/inert configuration. Do not replace the global footer. (`docs/architecture.md` UX policy; Pi TUI Pattern 4)
- [x] **Provide bounded on-demand inspection.** The current slash command sends multiline views/history through `ui.notify`, which is transient and can be very large. Keep `/event-loop status` compact; render views/history in a native, width-bounded, scrollable `ctx.ui.custom()` surface in TUI mode, with compact text fallback for RPC/print. Use `formatScrollCue`/`formatHiddenCountCue` and gradual disclosure instead of dumping payloads by default.
- [x] **Use native TUI components and theme/keybinding APIs.** Prefer `Text`, `Container`, `SelectList`, and `DynamicBorder`; use callback `theme`, injected keybindings, `tui.requestRender()` after state changes, and `truncateToWidth`/ANSI-aware wrapping. No raw ANSI, synchronous filesystem reads in `render()`, or custom controls where native components suffice.
- [x] **Bound any overlay explicitly.** If inspection is an overlay, declare `width`, `minWidth`, `maxHeight`, `anchor`, and `margin`; close with configured cancel keys and create a fresh component on each opening. Guard terminal-only UI with `ctx.mode === "tui"` and notification/dialog calls with `ctx.hasUI`.
- [x] **Add compact custom renderers.** Register a message renderer for `pi-event-loop-command` and compact `renderCall`/`renderResult` output for both tools. Default output should show type/id/state; expanded output may show expected events and bounded, clearly data-labelled payloads.
- [x] **Keep render paths pure and state precomputed.** Read configuration/session entries before opening the component; render closures consume an immutable snapshot only. Add the event-loop surface to TUI render-path fitness coverage.
- [x] **Document the TUI contract.** Extend `README.md` and `docs/pi-event-loop-c4.md` with status ownership, inspection flow, non-TUI fallback, disclosure bounds, and cleanup lifecycle. Remove the obsolete “Pi 0.74 has no `agent_settled`” qualification.

## P14 — Regression tests and completion gates

- [x] Host-semantics test: a command queued after idle startup triggers a turn, waits for real `agent_settled`, then delivers the next command; no polling or real sleep.
- [x] Pump test: empty initial cycle → later agent/operator/timer event → delivery; repeat after pause/resume, retry, issue, reload, and profile switch.
- [x] Contract tests: every automation outcome closes its own view/key; an expected-but-non-closing event stalls rather than strands a dispatched item.
- [x] Dynamic-tool tests: session cwd, profile switch, active command, and reload all refresh permitted event enum/description; `allowAgentEmit: false` remains uncallable.
- [x] Recovery tests with more than 100 completed rows and a deep causal chain prove bounded snapshot restoration, post-checkpoint-only replay, shortest-path retention, and preserved chain-limit behavior.
- [x] Timer tests cover DST transitions, incompatible required payloads, append failure, duplicate occurrence, and at-most-one catch-up.
- [x] TUI tests cover narrow widths, long IDs/payloads, scrolling/hidden counts, theme invalidation, configured keys, status cleanup, and TUI/RPC/JSON/print behavior.
- [x] Re-run `npm run check`, focused event-loop tests, full `npm test`, and `lens_diagnostics mode=all`; update AC evidence only from tests that exercise the production boundary rather than permissive mocks.
