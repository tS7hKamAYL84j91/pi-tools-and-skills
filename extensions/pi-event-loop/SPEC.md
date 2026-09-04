# pi-event-loop: Event Modeling automation runtime

**Status:** final implementation brief  
**Target:** `pi-tools-and-skills/extensions/pi-event-loop`  
**Supersedes:** all earlier pi-event-loop specifications

## 1. Context and purpose

`pi-event-loop` is a session-local automation runtime for one Pi agent. It implements the Event Modeling automation pattern:

~~~text
events → view → automated trigger → command → events
~~~

The extension records facts, projects them into todo views, issues commands for outstanding work and delivers each command as a new turn to the current agent. The agent handles the command and emits one or more resulting facts.

The extension supplies mechanism. A profile supplies the domain vocabulary and information flow. OODA, experimentation, review and other operating models are configurations built on top of it.

The design must preserve these distinctions:

- an **event** is an immutable fact;
- a **view** is information derived from facts;
- a **todo item** is projected work, not another fact;
- a **command** is an intention to act;
- the **agent** handles a command and reports its outcome as a new fact;
- the **automator** reads todo items and issues commands; it contains no domain reasoning.

## 2. Non-goals

The extension does not:

- discover, start, select or route to other agents;
- communicate between Pi sessions;
- depend on Panopticon, CoAS, File Watch, OODA or another extension;
- interpret whether a domain result is good;
- execute domain tools on the agent's behalf;
- provide distributed messaging or a project-wide event store;
- implement arbitrary expressions, scripts or a general workflow language;
- turn every observed fact directly into a command;
- infer successful work from the end of an agent turn.

Each Pi session owns its event history, projections, work items, command queue and timers.

## 3. The executable event model

A profile is an executable Event Model composed of vertical slices. Each slice can be read as Given–When–Then:

~~~text
Given: stored events produce a view containing an outstanding item
When:  the automator issues a configured command for that item
Then:  the agent emits one of the command's declared outcome events
~~~

Example:

~~~text
WorkCompleted
    → ReviewsDue contains work-42
    → ReviewWork(work-42)
    → ReviewAccepted | ReviewRejected | ReviewInconclusive
    → ReviewsDue no longer contains work-42
~~~

The event model, rather than the agent prompt, defines the permitted information flow.

## 4. Architecture

~~~mermaid
C4Component
  title pi-event-loop — session-local Event Modeling runtime

  Container(pi, "Current Pi session", "Pi runtime", "Hosts one agent and its conversation")

  Container_Boundary(loop, "pi-event-loop extension") {
    Component(timer, "Timer source", "Node timers", "Emits deterministic time facts")
    Component(ingress, "Event ingress", "event_loop_emit", "Validates and appends agent facts")
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
~~~

## 5. Runtime cycle

~~~mermaid
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
~~~

An event emitted during an active turn is processed immediately, but any resulting command waits until `agent_settled`. A command never interrupts a running turn.

## 6. Configuration

Configuration lives at `.pi/event-loop.json`.

~~~json
{
  "version": 1,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "emissionPolicy": "command-contract",
      "events": {
        "work.requested": {
          "description": "A unit of work is ready to be performed.",
          "allowAgentEmit": false,
          "requiredPayload": ["workId"]
        },
        "work.completed": {
          "description": "The requested work completed successfully.",
          "allowAgentEmit": true,
          "requiredPayload": ["workId", "resultPath"]
        },
        "work.failed": {
          "description": "The requested work could not be completed.",
          "allowAgentEmit": true,
          "requiredPayload": ["workId", "reason"]
        },
        "review.accepted": {
          "description": "The review accepted the completed work.",
          "allowAgentEmit": true,
          "requiredPayload": ["workId"]
        },
        "review.rejected": {
          "description": "The review rejected the completed work.",
          "allowAgentEmit": true,
          "requiredPayload": ["workId", "reason"]
        },
        "progress.review-became-due": {
          "description": "A periodic progress review became due.",
          "allowAgentEmit": false,
          "requiredPayload": ["scheduledFor"]
        },
        "progress.reviewed": {
          "description": "The periodic progress review completed.",
          "allowAgentEmit": true,
          "requiredPayload": ["scheduledFor", "assessment"]
        }
      },
      "commands": {
        "perform-work": {
          "message": "Perform the requested work described in the attached work item.",
          "expectedEvents": ["work.completed", "work.failed"]
        },
        "review-work": {
          "message": "Review the completed work described in the attached work item.",
          "expectedEvents": ["review.accepted", "review.rejected"]
        },
        "review-progress": {
          "message": "Review progress for the scheduled occurrence in the attached work item.",
          "expectedEvents": ["progress.reviewed"]
        }
      },
      "views": {
        "work-due": {
          "type": "todo",
          "openOn": [
            { "event": "work.requested", "keyFrom": "/workId" }
          ],
          "closeOn": [
            { "event": "work.completed", "keyFrom": "/workId" },
            { "event": "work.failed", "keyFrom": "/workId" }
          ]
        },
        "reviews-due": {
          "type": "todo",
          "openOn": [
            { "event": "work.completed", "keyFrom": "/workId" }
          ],
          "closeOn": [
            { "event": "review.accepted", "keyFrom": "/workId" },
            { "event": "review.rejected", "keyFrom": "/workId" }
          ]
        },
        "progress-reviews-due": {
          "type": "todo",
          "openOn": [
            { "event": "progress.review-became-due", "keyFrom": "/scheduledFor" }
          ],
          "closeOn": [
            { "event": "progress.reviewed", "keyFrom": "/scheduledFor" }
          ]
        }
      },
      "automations": [
        { "id": "perform-requested-work", "view": "work-due", "issue": "perform-work" },
        { "id": "review-completed-work", "view": "reviews-due", "issue": "review-work" },
        { "id": "perform-progress-review", "view": "progress-reviews-due", "issue": "review-progress" }
      ],
      "timers": [
        {
          "id": "hourly-progress-review",
          "intervalMinutes": 60,
          "emit": "progress.review-became-due"
        }
      ]
    }
  },
  "limits": {
    "maxPendingCommands": 20,
    "maxOpenItemsPerView": 100,
    "maxPayloadBytes": 16384,
    "maxChainDepth": 12,
    "maxConsecutiveTurns": 8,
    "maxRecentEvents": 1000
  }
}
~~~

JSON Pointer is the only v1 field-selection syntax. V1 must not add expressions, templates or embedded code.

## 7. Events and event discovery

Register one model-callable tool:

~~~ts
event_loop_emit({
  event: "review.accepted",
  dedupeKey: "review-work-42-accepted",
  payload: {
    workId: "work-42"
  }
});
~~~

The tool schema and description must be generated from the active profile. They show the agent:

- events it may emit;
- descriptions of those events;
- required payload fields;
- events expected by the active command.

When a command is active, the extension attaches its `commandId`, `workItemId`, `correlationId` and `causationId` to the event. The agent cannot supply or override those fields.

With `emissionPolicy: "command-contract"`, an agent-emitted event must be one of the active command's `expectedEvents`. A profile may separately declare an event `allowWithoutCommand: true` for observations that are valid outside a command turn.

For an active command outcome, the relevant `closeOn.keyFrom` value must equal the active todo item's key. Reject an outcome that names the expected event type but points to a different item. This prevents one command turn from accidentally completing unrelated work.

The tool performs this transaction:

1. validate the event against the active profile and command contract;
2. validate required payload keys and size;
3. derive a stable event ID from profile, event type and agent dedupe key;
4. append the event before producing any effects;
5. run all affected projections;
6. scan affected todo views for newly outstanding work;
7. queue idempotent commands;
8. return the accepted event ID and resulting work and command IDs.

Unknown or context-invalid events are rejected and never enter the log. A declared, accepted event that has no projection is retained as a fact and produces no action.

## 8. Event log and identity

Every accepted event is an immutable custom Pi session entry:

~~~json
{
  "eventId": "evt-...",
  "type": "work.completed",
  "occurredAt": "2026-09-04T14:00:00Z",
  "source": "agent",
  "payload": {
    "workId": "work-42",
    "resultPath": "results/work-42.json"
  },
  "commandId": "cmd-...",
  "workItemId": "item-...",
  "correlationId": "work-42",
  "causationId": "cmd-..."
}
~~~

Agent event identity is:

~~~text
sha256(profile + eventType + dedupeKey)
~~~

Timer event identity is:

~~~text
sha256(profile + timerId + scheduledFor)
~~~

Duplicate submissions return the previously accepted result and produce no duplicate projection or command. Events are never edited or deleted. A bounded projection snapshot may be stored for fast recovery, but the session event entries remain the source of truth.

## 9. Todo projections

A todo view is a deterministic projection over the ordered event history. Each row contains:

~~~ts
interface TodoItem {
  readonly workItemId: string;
  readonly viewId: string;
  readonly key: string;
  readonly openedByEventId: string;
  readonly sourcePayload: Readonly<Record<string, unknown>>;
  readonly status: "outstanding" | "dispatched" | "completed" | "stalled";
  readonly commandId?: string;
  readonly completedByEventId?: string;
}
~~~

Work item identity is deterministic:

~~~text
sha256(profile + viewId + key + openingEventId)
~~~

Projection rules are pure and replayable:

- `openOn` creates a row if its deterministic ID does not exist;
- `closeOn` completes every open row in that view with the matching key;
- unmatched close events are recorded but do not fabricate rows;
- a fact may update several views;
- a fact that updates no view is still valid history;
- configuration order must not change the result.

Projectors do not issue commands. Automators do not interpret events. This separation is mandatory.

## 10. Automation and command discovery

An automation reads one todo view and issues one configured command for each outstanding row, in row sequence. It contains no domain branching logic.

The agent does not browse or select the command catalogue. It discovers the current command because the extension delivers it as a self-describing Pi message:

~~~text
[pi-event-loop command]

Command: review-work
Command ID: cmd-7f91
Work item: item-35ac
Correlation: work-42

Review the completed work described in the attached work item.

Expected outcome events:
- review.accepted { workId }
- review.rejected { workId, reason }
~~~

The structured message contains the same contract:

~~~ts
pi.sendMessage(
  {
    customType: "pi-event-loop-command",
    content: command.message,
    display: true,
    details: {
      commandId: command.commandId,
      commandType: command.type,
      workItemId: command.workItemId,
      correlationId: command.correlationId,
      causedBy: command.causedBy,
      workItem: command.sourcePayload,
      expectedEvents: command.expectedEvents
    }
  },
  {
    triggerTurn: true,
    deliverAs: "nextTurn"
  }
);
~~~

Command identity is:

~~~text
sha256(profile + automationId + workItemId)
~~~

One todo item can therefore create at most one logical command. An uncertain retry reuses the same command ID.

## 11. Command lifecycle

The command queue is FIFO and session-local. It:

- deduplicates by stable command ID;
- has at most one active command;
- waits for `agent_settled` before delivering another command;
- persists before delivery;
- is bounded by `maxPendingCommands`.

The work-item lifecycle is:

~~~text
outstanding → dispatched → completed
                         ↘ stalled
~~~

Delivering a command marks its item `dispatched`. `agent_settled` records only that the agent turn ended. It does not mark the item complete.

The item becomes `completed` only when a correlated configured closing event is accepted. If the command turn settles without an outcome that closes its item, mark the item `stalled`, pause automated delivery and expose `missing-outcome` as the reason. An expected event with the wrong correlation is rejected at ingress. Do not immediately redeliver and create a spin loop.

If the process exits after delivery but before settlement is recorded, the same command may be delivered again on resume with the same command ID.

## 12. Timers as facts

Time does not directly invoke an agent. A configured timer occurrence appends a declared fact. That fact may update a todo view, from which an automation may issue a command:

~~~text
scheduled occurrence
    → ProgressReviewBecameDue
    → ProgressReviewsDue row
    → ReviewProgress command
    → ProgressReviewed
~~~

V1 supports:

- `intervalMinutes`;
- `dailyAt` in the configured host timezone.

Timers run only while the Pi session is open. On resume, an interval timer emits at most the latest missed occurrence; daily timers default to no missed occurrence. Catch-up never creates an unbounded burst. Timer handles are unref'd and cleared on shutdown, reload and profile change.

## 13. Correction and compensation

History is never rewritten. If an accepted fact was wrong, a later configured fact corrects it:

~~~json
{
  "type": "review.acceptance-retracted",
  "payload": {
    "workId": "work-42",
    "correctsEventId": "evt-original",
    "reason": "The reviewed artifact was incomplete."
  }
}
~~~

Compensation is expressed as another Event Model slice:

~~~text
ReviewAcceptanceRetracted
    → CorrectionsDue view
    → CorrectReview command
    → ReviewCorrectionCompleted | ReviewCorrectionFailed
~~~

`pi-event-loop` provides causation, correlation, projections and command delivery. The profile defines the domain compensation. The runtime may cancel a queued, undelivered command whose work item has already been completed, but it must never pretend to undo domain work already performed.

The rule is:

~~~text
reject invalid facts;
retain valid unmapped facts without effects;
correct accepted facts with later facts;
compensate performed work through an explicit slice.
~~~

## 14. Loop protection

The runtime must enforce:

- maximum causal chain depth;
- maximum consecutive event-loop-triggered turns;
- per-view open-item limits;
- command queue limits;
- stable event, item and command IDs;
- one active command;
- pause on a missing command outcome;
- pause on any limit exhaustion;
- an operator-visible reason for every pause.

Manual user input resets the consecutive automated-turn counter. It does not alter event history or causal depth for queued work.

## 15. Session persistence

Persist:

- immutable event entries;
- the active profile identifier and configuration fingerprint;
- latest projection checkpoint and bounded view snapshot;
- pending and active commands;
- recent deterministic IDs;
- timer occurrence state;
- paused state and reason.

On recovery, load the latest valid snapshot and replay all subsequent events. If the configuration fingerprint changed, rebuild every projection from the session event history before resuming automation.

Two Pi sessions reading the same `.pi/event-loop.json` remain completely independent.

## 16. Operator controls

Register:

~~~text
/event-loop status
/event-loop views [view]
/event-loop history [count]
/event-loop pause
/event-loop resume
/event-loop retry <work-item-id>
/event-loop reload
/event-loop use <profile>
/event-loop emit <event-type> [json-payload]
/event-loop issue <command-type> [json-work-item]
~~~

`emit` creates source `operator` and follows the normal append-and-project path. `issue` is a diagnostic escape hatch that creates an operator-originated work item and command; it must not fabricate a domain event.

Also register a read-only model-callable `event_loop_context` tool returning:

- active command and work item;
- expected event contracts;
- current pause state;
- relevant view row status.

It must not allow the agent to select arbitrary commands or mutate state.

## 17. Pi lifecycle

| Hook | Behaviour |
| --- | --- |
| `session_start` | Load and validate configuration, restore the latest snapshot, replay later events, calculate timer catch-up, rebuild affected views, run automations and deliver the next command. |
| `input` | Reset the consecutive automated-turn counter for genuine interactive user input. |
| `agent_start` | Mark the session busy. |
| `agent_settled` | Record active command delivery as settled; if no expected event was emitted, stall and pause; otherwise deliver the next queued command. |
| `session_shutdown` | Persist a checkpoint and clear all timers. |

Do not use `agent_end` as the settlement boundary because retries, compaction or queued continuation may follow it.

## 18. Validation and security

Reject:

- unknown configuration fields;
- duplicate event, command, view, automation or timer identifiers;
- references to undefined events, commands or views;
- view close rules whose key path is incompatible with the opening rule;
- commands with no expected outcome events;
- agent events outside the current command contract unless `allowWithoutCommand` is set;
- command outcomes whose projected key does not match the active todo item's key;
- invalid JSON Pointers, timer values, messages and payloads;
- limits outside hard-coded ceilings.

Prompts, payloads, event history and configuration are untrusted data. They cannot expand extension capabilities. Source payloads delivered to the agent must be clearly identified as data, not instructions.

## 19. Implementation shape

~~~text
extensions/pi-event-loop/
  package.json
  README.md
  index.ts
  config.ts
  types.ts
  event-ingress.ts
  event-log.ts
  projector.ts
  todo-view.ts
  automator.ts
  timers.ts
  command-queue.ts
  dispatcher.ts
  session-state.ts
  status.ts
  tests/
~~~

Use native Node and Pi APIs. Shared `lib/` helpers are permitted only when extension-neutral. Do not import another extension directory.

## 20. Acceptance criteria

1. An allowed agent tool call appends one immutable event with a stable ID.
2. Duplicate emission returns the prior result and changes no projection twice.
3. An invalid or out-of-contract event is rejected before append.
4. A valid event with no projection is retained and causes no command.
5. An opening event creates exactly one deterministic todo item.
6. A closing event completes every matching open item without fabricating a new item.
7. Replaying the same history creates byte-equivalent view state.
8. An automator issues one deterministic command per outstanding item.
9. Projectors never issue commands and automators never interpret events.
10. A command message identifies its command, work item and expected outcome events.
11. The dynamic emit tool exposes the active command's permitted outcomes.
12. A command produced during an active turn waits for `agent_settled`.
13. Multiple commands are delivered sequentially with one active command.
14. Settlement without an expected event stalls the work item and pauses delivery.
15. An accepted closing event, not settlement, completes a work item.
16. A timer occurrence appends a deterministic event before any command is created.
17. Timer catch-up appends at most one event per timer.
18. Restart replays only events after the latest checkpoint.
19. A configuration change causes a deterministic full projection rebuild.
20. An uncertain active delivery may repeat only with the same command ID.
21. Chain, item and queue limits pause rather than produce unbounded turns.
22. Compensation is implemented as configured facts, views and commands.
23. Two sessions maintain independent histories, projections and queues.
24. The extension works with every other optional extension disabled.
25. The source contains no OODA, experiment, Panopticon or cross-session logic.
26. Repository check, test and security gates pass without exceptions.

## 21. Definition of done

The implementing agent returns:

- an independently installable `pi-event-loop` extension;
- an append-only session event log with deterministic identities;
- pure, replayable todo projections;
- simple automators that issue commands for outstanding rows;
- one model-callable `event_loop_emit` tool with a dynamic event contract;
- one read-only `event_loop_context` tool;
- timer occurrences represented as facts;
- self-describing command turns with causal metadata;
- bounded queues, projection snapshots and restart recovery;
- fake-timer, projection, replay, lifecycle, idempotency, missing-outcome and loop-protection tests;
- an example Event Model and C4 documentation;
- no multi-agent orchestration, intersession communication or dependency on another extension.

## 22. Design references

This specification applies Event Modeling's command, view and automation patterns. Event Modeling describes an information system along a timeline of stored facts; its automation pattern is `events → view → automated trigger → command → events`.

- [Event Modeling: What is it?](https://eventmodeling.org/posts/what-is-event-modeling/)
- [Event Modeling Cheat Sheet](https://staging.eventmodeling.org/posts/event-modeling-cheatsheet/)
- [About Event Modeling](https://eventmodeling.org/about/)
