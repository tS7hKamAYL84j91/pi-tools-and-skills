# TODO — pi-event-loop implementation

**Source of truth:** `SPEC.md` (final implementation brief). Nothing implemented yet — only the spec exists. Sections below reference SPEC.md sections. Definition of done = SPEC.md §21; acceptance criteria = SPEC.md §20 (numbered AC-1..26).

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

- [ ] **`automator.ts`:** one automation reads one view, issues one configured command per outstanding row in sequence; no domain branching. (§10)
- [ ] **`command-queue.ts`:** FIFO, session-local; dedupe by `sha256(profile + automationId + workItemId)`; one active command; persist before delivery; bounded by `maxPendingCommands`; cancel queued undelivered commands whose item is already completed. (§10, §11, §13)
- [ ] **`dispatcher.ts`:** deliver command as self-describing Pi message (`customType: "pi-event-loop-command"`, details with commandId/type/workItemId/correlationId/causedBy/workItem/expectedEvents) via `sendMessage(…, { triggerTurn: true, deliverAs: "nextTurn" })`. Commands issued mid-turn wait for `agent_settled`. (§5, §10, §11)

## P5 — Lifecycle, timers, state

- [ ] **`session-state.ts`:** persist events, active profile + config fingerprint, projection checkpoint + bounded view snapshot, pending/active commands, recent IDs, timer occurrence state, paused state + reason. Recovery: load latest snapshot, replay later events; fingerprint change → full projection rebuild. (§15)
- [ ] **`timers.ts`:** `intervalMinutes` and `dailyAt`; timer occurrence appends a declared fact (never invokes agent directly); catch-up emits at most the latest missed occurrence (daily: none); unref'd handles cleared on shutdown/reload/profile change; run only while session is open. (§12)
- [ ] **Pi lifecycle hooks:** `session_start` (load/validate/restore/replay/catch-up/rebuild/deliver), `input` (reset consecutive automated-turn counter), `agent_start`, `agent_settled` (settle; missing expected event → stall item, pause delivery with `missing-outcome`), `session_shutdown` (checkpoint + clear timers). Do **not** use `agent_end` as settlement boundary. (§17)

## P6 — Loop protection

- [ ] **Enforce all limits:** causal chain depth, consecutive event-loop turns, per-view open items, queue size, one active command; pause on exhaustion with operator-visible reason. (§14, AC-21)

## P7 — Operator controls

- [ ] **`status.ts` + commands:** `/event-loop status|views|history|pause|resume|retry|reload|use|emit|issue`. `emit` uses source `operator` via the normal path; `issue` is a diagnostic hatch that must not fabricate domain events. (§16)
- [ ] **`event_loop_context` read-only tool:** active command/work item, expected event contracts, pause state, view row status; no command selection or mutation. (§16)

## P8 — Correction and compensation

- [ ] **Retraction path:** accept `correctsEventId` compensation facts as normal configured slices; runtime may cancel queued undelivered commands but never pretends to undo performed domain work. (§13, AC-22)

## P9 — Tests (fake timers, no real sleep)

- [ ] Unit tests per module: config validation, ingress contract/rejection/dedupe, projection purity + replay equivalence, automator/queue idempotency, dispatcher turn-gating, timer catch-up bounds, lifecycle hooks, missing-outcome stall, loop-protection limits, persistence/recovery, two-session independence.
- [ ] Cover all 26 acceptance criteria (§20) explicitly; include fake-timer, replay, idempotency, missing-outcome, and loop-protection suites. (§21)

## P10 — Gates and docs

- [ ] **Repo gates clean:** `npm run check` (typecheck strict + knip + type-coverage ≥95%) and `npm test`; no lint suppressions. (AC-26)
- [ ] **C4 architecture doc** in `docs/` with Mermaid (port SPEC.md §4/§5 diagrams) + example Event Model profile. (§21)
- [ ] **Isolation audit:** no OODA/Panopticon/CoAS/cross-session logic, no imports from other extension directories; works with all other extensions disabled. (§2, AC-23–25)