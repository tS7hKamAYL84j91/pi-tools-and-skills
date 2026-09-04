# pi-event-loop — C4 architecture, isolation audit, and AC coverage

**Scope:** Complete P1-P10 implementation (config, event log, ingress, projections, automator,
queue, dispatcher, lifecycle, timers, operator controls) integrated on `feat/pi-event-loop-v2`.
**Source of truth:** [`extensions/pi-event-loop/SPEC.md`](../extensions/pi-event-loop/SPEC.md)
(§4-§5 diagrams, §20 acceptance criteria AC-1..26, §21 definition of done).

P5-P10 implementation is complete. The audit below records final coverage and verification
against current Pi runtime contracts and acceptance criteria.

## 1. System context (C4)

pi-event-loop is a session-local automation runtime for exactly one Pi agent. There are no
relationships to other extensions or other Pi sessions — isolation is a design constraint
(SPEC §2), audited in §4 of this document.

```mermaid
C4Context
  title pi-event-loop — session-local Event Modeling runtime

  Person(agent, "Current agent", "The one Pi agent this session hosts; handles commands and reports outcomes as facts")
  Person(operator, "Operator", "Owns configuration and pause/resume controls")
  System(piLoop, "pi-event-loop", "Session-local Event Modeling automation runtime")
  System_Ext(piRuntime, "Pi session runtime", "Hosts the agent, its turns, and custom session entries")
  SystemDb_Ext(sessionLog, "Pi session log", "Immutable custom event entries; the source of truth")
  System_Ext(otherExt, "Other optional extensions", "May be installed; no import or coordination path exists")
  System_Ext(otherSession, "Other Pi sessions", "Own independent histories, projections and queues")

  Rel(agent, piLoop, "Calls event_loop_emit; receives command turns")
  Rel(operator, piLoop, "Edits .pi/event-loop.json; /event-loop controls (P7)")
  Rel(piLoop, piRuntime, "Registers tool; sendMessage with triggerTurn")
  Rel(piLoop, sessionLog, "Appends and reads immutable events")
```

Non-relationships (deliberate, SPEC §2): no Rel to `otherExt` or `otherSession` exists — no
imports, messaging, event sharing or agent routing between them.

## 2. Containers

```mermaid
C4Container
  title pi-event-loop — container view

  Person(agent, "Current agent", "Handles commands; emits facts")
  Container(pi, "Pi session runtime", "Pi runtime", "Hosts one agent, its conversation and custom session entries")
  Container(loop, "pi-event-loop", "Pi extension", "Session-local Event Modeling runtime: facts → views → commands → turns")
  ContainerDb(log, "Pi session log", "Pi custom entries", "Immutable event log storage (source of truth)")
  ContainerDb(configFile, ".pi/event-loop.json", "JSON file", "Validated profile configuration")
  System_Ext(otherExt, "Other extensions", "Independent; pi-event-loop stays functional with all of them disabled")

  Rel(agent, pi, "Works inside the current session")
  Rel(pi, loop, "Loads and hosts")
  Rel(loop, log, "Appends events; reads branch order")
  Rel(loop, configFile, "Loads and validates on session start")
```

## 3. Components

Port of SPEC §4; dispatcher/queue/ingress are wired into lifecycle hooks.

```mermaid
C4Component
  title pi-event-loop — session-local Event Modeling runtime

  Container(pi, "Current Pi session", "Pi runtime", "Hosts one agent and its conversation")

  Container_Boundary(loop, "pi-event-loop extension") {
    Component(timer, "Timer source", "Node timers", "Emits deterministic time facts")
    Component(ingress, "Event ingress", "event_loop_emit (P1-P4)", "Validates and appends agent facts")
    ComponentDb(log, "Event log", "Pi custom session entries", "Immutable domain and runtime facts")
    Component(projector, "Projector", "Pure TypeScript", "Builds todo views from facts")
    ComponentDb(views, "Todo views", "Session snapshot", "Outstanding, claimed and stalled work")
    Component(automator, "Automator", "Pure TypeScript", "Issues commands for outstanding rows")
    Component(queue, "Command queue", "Session snapshot", "Orders and deduplicates commands")
    Component(dispatcher, "Pi dispatcher", "ExtensionAPI", "Delivers one command to the current agent")
  }

  Rel(timer, log, "Appends time fact")
  Rel(pi, ingress, "Agent calls event_loop_emit")
  Rel(ingress, log, "Appends accepted fact")
  Rel(log, projector, "Feeds facts in sequence")
  Rel(projector, views, "Updates")
  Rel(views, automator, "Supplies outstanding rows")
  Rel(automator, queue, "Issues idempotent command")
  Rel(queue, dispatcher, "Supplies next command")
  Rel(dispatcher, pi, "sendMessage with triggerTurn")
```

Mandatory separation (SPEC §9, AC-9): projectors never issue commands and automators never
interpret events. Enforced by `tests/architecture/pi-event-loop-isolation.ts` (import direction).

### Runtime cycle

Port of SPEC §5; command delivery settles on the `agent_settled` lifecycle hook before advancing.

```mermaid
sequenceDiagram
  participant A as Current agent
  participant I as Event ingress
  participant L as Event log
  participant P as Projector
  participant V as ReviewsDue view
  participant M as Automator
  participant Q as Command queue
  participant Pi as Pi runtime

  A->>I: event_loop_emit(WorkCompleted)
  I->>L: Append immutable fact
  L->>P: Apply next event
  P->>V: Open todo work-42
  V->>M: Outstanding row
  M->>Q: Queue ReviewWork(work-42)
  I-->>A: Accepted; command queued
  A-->>Pi: Current turn settles
  Pi->>Q: agent_settled
  Q->>Pi: sendMessage(ReviewWork, nextTurn)
  Pi->>A: Start command turn
  A->>I: event_loop_emit(ReviewAccepted)
  I->>L: Append outcome with causation metadata
  L->>P: Apply next event
  P->>V: Complete todo work-42
```

## 4. Isolation audit (SPEC §2; AC-23, AC-24, AC-25)

Evidence collected at `7da1b6b`; guards live in `tests/architecture/pi-event-loop-isolation.ts`.

**External import inventory** (`grep -rhn 'from "' extensions/pi-event-loop/*.ts | grep -o 'from "[^"]*"' | sort | uniq -c`):
only intra-extension relative imports (`./…`), node builtins (`node:path`, `node:crypto`,
`node:fs`, `node:fs/promises`), the Pi host API (`@earendil-works/pi-coding-agent`), the tool
schema library (`@sinclair/typebox`), and shared extension-neutral helpers
(`../../lib/tool-result.js`). Nothing else.

**Zero imports from other extension directories** — `grep -rnE "import .*(extensions/|pi-goal|pi-teams|pi-kanban|pi-coas|panopticon|pi-matrix|pi-boost|pi-doctor|pi-bionic|file-watch)" extensions/pi-event-loop/*.ts` → no matches. The only textual `pi-boost` occurrence is a comment in `dispatcher.ts:120` crediting a polling pattern; it imports nothing.

**No OODA / Panopticon / CoAS / cross-session logic** — `grep -rniE "\b(ooda|panopticon|coas|agent_send|mailbox|intersession|crosssession)\b" extensions/pi-event-loop/*.ts` → no matches. The automator performs no domain reasoning (SPEC §10); no experiment/review/panopticon semantics exist in any module.

**Two-session independence (AC-23):** all mutable state lives in one `EventLoopRuntime` instance created per extension instance (`createEventLoopRuntime()`); the event log is stored as Pi custom session entries scoped to the session branch; two sessions reading the same `.pi/event-loop.json` share nothing. Guard test: `tests/pi-event-loop-ac-coverage.test.ts` ("two sessions keep independent projections, queues and deliveries").

**Runs with every other extension disabled (AC-24):** module-level dependencies are the pi host
API, node builtins, `@sinclair/typebox`, and `lib/tool-result.js` — all present without any
optional extension. Enforced by the import-allowlist guard test.

## 5. Example Event Model profile

Condensed `.pi/event-loop.json` profile (SPEC §6) plus a compensation slice (SPEC §13, AC-22):
retraction is expressed as configured facts, views and commands — history is never rewritten.

```json
{
  "version": 1,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "emissionPolicy": "command-contract",
      "events": {
        "work.requested": { "description": "A unit of work is ready.", "allowAgentEmit": false, "requiredPayload": ["workId"] },
        "work.completed": { "description": "The requested work completed.", "allowAgentEmit": true, "requiredPayload": ["workId", "resultPath"] },
        "review.accepted": { "description": "The review accepted the work.", "allowAgentEmit": true, "requiredPayload": ["workId"] },
        "review.acceptance-retracted": {
          "description": "A previously accepted review is retracted.",
          "allowAgentEmit": true,
          "allowWithoutCommand": true,
          "requiredPayload": ["workId", "correctsEventId", "reason"]
        }
      },
      "commands": {
        "review-work": { "message": "Review the completed work.", "expectedEvents": ["review.accepted", "review.rejected"] },
        "correct-review": { "message": "Correct the retracted review.", "expectedEvents": ["review.accepted", "review.rejected"] }
      },
      "views": {
        "reviews-due": {
          "type": "todo",
          "openOn": [{ "event": "work.completed", "keyFrom": "/workId" }],
          "closeOn": [{ "event": "review.accepted", "keyFrom": "/workId" }, { "event": "review.rejected", "keyFrom": "/workId" }]
        },
        "corrections-due": {
          "type": "todo",
          "openOn": [{ "event": "review.acceptance-retracted", "keyFrom": "/workId" }],
          "closeOn": [{ "event": "review.accepted", "keyFrom": "/workId" }, { "event": "review.rejected", "keyFrom": "/workId" }]
        }
      },
      "automations": [
        { "id": "review-completed-work", "view": "reviews-due", "issue": "review-work" },
        { "id": "correct-retracted-review", "view": "corrections-due", "issue": "correct-review" }
      ],
      "timers": []
    }
  },
  "limits": {
    "maxPendingCommands": 20, "maxOpenItemsPerView": 100, "maxPayloadBytes": 16384,
    "maxChainDepth": 12, "maxConsecutiveTurns": 8, "maxRecentEvents": 1000
  }
}
```

## 6. Acceptance-criteria coverage audit (SPEC §20, AC-1..26)

Statuses: **COVERED** = automated test evidence exists; **QUALIFIED** = behavior is implemented
with an explicit pinned-API qualification or bounded operational caveat.

| AC | Requirement (abridged) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Allowed agent call appends one immutable event with stable ID | COVERED | `event-ingress-tool.test.ts` "appends the event before pipeline effects…"; `event-ingress.test.ts` "produces identical event ids…"; `event-log.test.ts` |
| 2 | Duplicate emission returns prior result; no double projection | COVERED | `event-ingress-tool.test.ts` "skips append and pipeline for duplicate submissions"; `event-ingress.test.ts` "flags duplicate dedupe keys…"; `automator.test.ts` "emits no new effects when the same event is applied twice" |
| 3 | Invalid/out-of-contract event rejected before append | COVERED | `event-ingress-tool.test.ts` "rejects invalid events before append"; `event-ingress.test.ts` rejection suite |
| 4 | Valid event with no projection retained, no command | COVERED | `projector.test.ts` "a fact that maps to no view is retained history with no effects (AC-4)" |
| 5 | Opening event creates exactly one deterministic item | COVERED | `projector.test.ts` "creates exactly one deterministic item per opening event (AC-5)" |
| 6 | Closing event completes matching items without fabricating | COVERED | `projector.test.ts` "closes matching open rows without fabricating items (AC-6)" |
| 7 | Replay of same history is byte-equivalent | COVERED | `projector.test.ts` "replaying the same history is byte-equivalent (AC-7)"; "incremental applyEvent matches full replay" |
| 8 | Automator issues one deterministic command per outstanding item | COVERED | `automator.test.ts` "issues one command per outstanding row in row sequence"; "command id depends only on profile, automation and work item" |
| 9 | Projectors never issue commands; automators never interpret events | COVERED | `tests/architecture/pi-event-loop-isolation.ts` layer-boundary guards (new) |
| 10 | Command message identifies command, work item, expected events | COVERED | `dispatcher.test.ts` "carries the self-describing contract as structured details (SPEC §10)" |
| 11 | Dynamic emit tool exposes active command's permitted outcomes | COVERED | `tests/pi-event-loop-ac-coverage.test.ts` emit-tool description contract (new); live per-turn contract reporting is the command message (AC-10) + `event_loop_context` (P7) |
| 12 | Command from an active turn waits for `agent_settled` | COVERED | `lifecycle.test.ts`, `lifecycle-recovery.test.ts`, and `tests/pi-event-loop-integration.test.ts` |
| 13 | Multiple commands delivered sequentially, one active | COVERED | `command-queue.test.ts` FIFO/one-active; `dispatcher.test.ts` "refuses delivery when a command is already active"; `tests/pi-event-loop-ac-coverage.test.ts` sequential two-command cycle (new) |
| 14 | Settlement without expected event stalls item, pauses delivery | COVERED | `dispatcher.test.ts` "without an expected outcome event: stalls the item and pauses delivery"; `tests/pi-event-loop-runtime.test.ts` stall test |
| 15 | Accepted closing event, not settlement, completes item | COVERED | `tests/pi-event-loop-runtime.test.ts` full-cycle test; `projector.test.ts` AC-6; `dispatcher.test.ts` "settles cleanly and clears the active command" |
| 16 | Timer occurrence appends deterministic event before commands | COVERED | `timers.test.ts` and `lifecycle.test.ts` |
| 17 | Timer catch-up appends at most one event per timer | COVERED | `timer-schedule.test.ts`, `timers.test.ts` |
| 18 | Restart replays only events after latest checkpoint | COVERED | `session-state.test.ts`, `lifecycle.test.ts` |
| 19 | Config change causes deterministic full projection rebuild | COVERED | `session-state.test.ts` fingerprint-change rebuild cases |
| 20 | Uncertain active delivery repeats only with same command ID | COVERED | `session-state.test.ts` + stable-ID tests in `command-queue.test.ts`/`automator.test.ts` |
| 21 | Chain, item and queue limits pause, not unbounded turns | COVERED | `loop-guards.test.ts`, `lifecycle-recovery.test.ts`, `automator.test.ts`, and `tests/pi-event-loop-integration.test.ts` |
| 22 | Compensation as configured facts, views, commands | COVERED | `tests/pi-event-loop-runtime.test.ts` and `tests/pi-event-loop-operator-controls.test.ts` accept declared `correctsEventId` facts; queued cancellation is covered by `command-queue.test.ts` |
| 23 | Two sessions keep independent histories, projections, queues | COVERED | `tests/pi-event-loop-ac-coverage.test.ts` instance-independence test (new); §4 design evidence |
| 24 | Works with every other optional extension disabled | COVERED | import-allowlist guard + inventory in §4 (new) |
| 25 | No OODA/experiment/Panopticon/cross-session logic | COVERED | forbidden-logic guard + grep evidence in §4 (new) |
| 26 | Repo check, test and security gates pass without exceptions | COVERED | `npm run check` and full `npm test` pass after P5-P7 integration; architecture and test-quality fitness pass |

Test evidence paths are relative to `extensions/pi-event-loop/tests/` unless prefixed `tests/`.

## 7. Operator TUI and Status Boundary (SPEC §16; TODO P13)

The operator interface consists of a persistent status indicator and an on-demand inspection overlay:

- **Status Ownership:** `pi-event-loop` manages a compact single-line indicator via `ctx.ui.setStatus("pi-event-loop", ...)`. It surfaces paused state with reason, active command, and pending count using callback theme colors without raw ANSI sequences. The status line is refreshed on runtime state transitions and cleared on shutdown or when inert.
- **Overlay Flow & Bounds:** Bounded on-demand inspection opens via `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { width: "80%", minWidth: 40, maxHeight: "80%", anchor: "center", margin: 1 } }`. It presents 3 navigable tabs (Status, Views, History) with keyboard navigation (`1/2/3`, `Tab`, `↑/↓`, `Enter` gradual disclosure, `Esc/q` close). Visible rows are bounded by `maxVisibleRows` with overflow scroll cues (`formatScrollCue`).
- **Non-TUI Fallback:** In non-interactive environments (`ctx.hasUI === false` or `ctx.mode !== "tui"`), inspection formats a bounded multiline text report (`formatEventLoopFallback`) delivered through `ctx.ui.notify()`.
- **Pure Render Paths:** Render closures consume precomputed immutable state (`EventLoopStatus` and `history` array) prepared before opening the component. No synchronous filesystem reads or blocking operations occur in `render()`, enforced by `tests/architecture/tui-render-paths.ts`.
- **Shutdown Cleanup:** Timer handles are unref'd and cleared, and the footer status indicator is reset to `undefined` upon session shutdown or profile reload.

## 8. Validation at audit time

- `npx vitest run tests/pi-event-loop-ac-coverage.test.ts tests/architecture.test.ts` — 71 passed.
- `npx vitest run extensions/pi-event-loop tests/pi-event-loop-runtime.test.ts tests/pi-event-loop-ac-coverage.test.ts tests/pi-event-loop-operator-controls.test.ts` — all touched tests pass.
- `npx tsc --noEmit` — clean; `npm run check` — passes (knip clean, type-coverage 99.23%).
- Full `npm test` — 201 files / 1469 tests passed; architecture and test-quality fitness pass with no exceptions.
- File budgets: `tests/pi-event-loop-ac-coverage.test.ts` 162 lines, `tests/architecture/pi-event-loop-isolation.ts` 140 lines (< 300 default).