# Architecture Reference

Short reference docs for `pi-tools-and-skills` architecture decisions and extension designs.

---

## F.I.R.E. Review

**Date:** 2026-05-09

Reviewing the codebase against Dan Ward's F.I.R.E. principles (Fast, Inexpensive,
Restrained, Elegant).

### Strengths

- **Fast & Inexpensive:** Local file-backed state (JSON/Markdown) means zero
  infrastructure.
- **Restrained & Elegant:** Extension boundaries are tight. Kanban uses a simple
  append-only log.
- **Restrained Teams module:** Team execution now uses direct protocol handlers inside `pi-panopticon/teams`; the generic DAG executor and lowering layers are removed from the baseline.
- **Sparse Panopticon alerts:** Reconciliation follow-ups only interrupt for
  actionable states, reducing idle token cost (ADR 014).

### Risk Areas

The main risk is **custom framework growth**:

- **File Concurrency:** Multiple writers require strict lock discipline.
- `pi-coas`: Must keep its internal scheduler minimal — schedule files plus one
  pi-hosted timer loop, no external crontab reconciliation.
- `pi-matrix`: Justified for human interaction, but too heavy for local
  agent-to-agent comms. Keep local peer routing on IPC-backed channels such as
  `agent_send`, spawned-agent RPC, and Panopticon Teams live-agent bindings.

### Recommendations

1. **Keep Teams direct:** Prefer direct coordination functions over a
   complex engine unless dynamic topologies are strictly required. ✅ Baseline —
   DAG removed.
2. **Keep Kanban dumb:** Stick to the event-sourced log and deterministic state
   reconstruction. **No SQLite.**
3. **Keep `pi-panopticon` boring:** Track agent existence, heartbeats, and
   recent operational summaries from existing state only. No long-term metrics
   store. ✅ ADR 014 suppresses idle reconciliation noise.
4. **Keep naming tools canonical:** `set_name` and `get_name` are the only
   naming tools; deprecated alias wrappers are removed.
5. **Limit `pi-coas`:** Run schedules only inside pi with a small timer loop.
6. **Enforce Boundaries:** Prevent extensions from coupling. Add explicit
   "What this does NOT do" to every README.

---

## Current Architecture Map

`pi-tools-and-skills` is a local-first extension workspace for the pi coding agent. This map records current extension ownership, shared library boundaries, state ownership, trust boundaries, active risks, and validation anchors.

```mermaid
flowchart TD
  Pi[pi coding agent runtime] --> Settings[pi settings and package registry]
  Settings --> GlobalExt[User/global extensions]
  Settings --> ProjectExt[Project-local extensions]

  subgraph SharedLib[Shared lib layer]
    Core[Pure contracts and render helpers]
    Runtime[Runtime/session/persistence helpers]
    Transports[Transport adapters]
    Core --> Runtime
    Core --> Transports
  end

  subgraph GlobalExt[User/global extensions]
    Goal[pi-goal]
    Matrix[pi-matrix]
    Panopticon[pi-panopticon]
    Bionic[pi-bionic]
  end

  subgraph ProjectExt[Project-local extensions]
    Kanban[pi-kanban]
    COAS[pi-coas]
  end

  Pi --> Goal
  Pi --> Matrix
  Pi --> Panopticon
  Panopticon --> TeamsModule[teams module]
  Pi --> Bionic
  Pi --> Kanban
  Pi --> COAS

  Goal --> SharedLib
  Matrix --> SharedLib
  Panopticon --> SharedLib
  TeamsModule --> SharedLib
  Bionic --> SharedLib
  Kanban --> SharedLib
  COAS --> SharedLib

  TeamsModule -. uses runtime substrate .-> Panopticon
  Kanban -. agent assignment/status .-> Panopticon
  Goal -. spawned-worker orchestration .-> Panopticon
  COAS -. task scheduling .-> Kanban
```

### Extension roles

| Extension | Scope | Primary role | State owner |
| --- | --- | --- | --- |
| `pi-goal` | user/global | Active goal tracking and completion audit workflow | Goal files under the active workspace, including `.pi/goal/` |
| `pi-panopticon` | user/global | Agent registry, heartbeat/status inspection, peer messaging, spawned-agent orchestration, and modular declarative team workflows | Panopticon registry/session state plus isolated team run session state |
| `pi-matrix` | user/global | Human-facing Matrix transport integration | Matrix configuration/session state |
| `pi-bionic` | user/global | Local-only clean-room bionic-reading text transform | Stateless first slice; no persisted state |
| `pi-kanban` | project-local | Event-sourced project task board | Kanban event log in the owning workspace |
| `pi-coas` | project-local | Cooperative agent scheduling over kanban tasks | COAS schedule/runtime files in the owning workspace |

### State ownership summary

| State class | Owner | Expected write pattern |
| --- | --- | --- |
| Append-only task/event logs | Owning extension (`pi-kanban`, similar event sources) | `appendLogLine()` or an owning append API |
| Full-file JSON/Markdown state | Owning extension or shared runtime helper | `writeFileAtomic()` / `updateJsonFile()` where practical |
| Session spool/log state | Shared session runtime helpers | Session-spool/session-log APIs |
| Agent registry and spawn state | Panopticon/shared spawn services | Registry/spawn APIs |
| Team run state | Panopticon Teams module | Team run APIs and documented result paths |

### Trust boundaries

```mermaid
flowchart LR
  UserText[Untrusted user/objective text] --> Tools[pi tools and commands]
  Repo[Workspace files] --> Tools
  Tools --> FS[Local filesystem]
  Tools --> IPC[Local IPC / spawned agents]
  Tools --> Network[Optional external transports]
  Network --> Matrix[Matrix]
  IPC --> Agents[Peer/spawned agents]
```

- Treat user objectives, task text, Matrix messages, and agent messages as untrusted input.
- Tool implementations must validate paths and avoid interpreting untrusted text as shell/code.
- Workspace files are the durable authority for local-first state, but extension-private files remain private to their owning extension.
- Matrix and other network transports are optional outer-boundary integrations; local agent coordination should prefer IPC-backed mechanisms.
- Spawned agents and peer messages are coordination channels, not authority to bypass repository validation or completion audits.
- Panopticon local IPC under `~/.pi/agents` is private-local state: registry/Maildir directories are `0700`, registry/message files are `0600`, and symlinked IPC paths fail closed.

### Current risks and validation anchors

1. **Concurrency discipline:** Continue moving state writes through `lib/file-persistence.ts` helpers or documented domain-specific transactions.
2. **README contract clarity:** Keep each extension README explicit about stable tools/commands, provisional surfaces, and cross-extension dependencies.
3. **Progress UX:** Keep long-running Teams/`pi-goal` work visible with phase, elapsed time, last action, cancellation affordance, and artifact paths.
4. **Transport diagnostics:** Keep `globalThis`/transport registry behavior documented with diagnostics and fallback behavior.

`tests/architecture.test.ts` enforces practical dependency layering, extension runtime-state boundaries, UX/tool policy checks, hotspot budgets, docs hygiene, and persistence-discipline exceptions.

---

## Package Setup Boundary

```mermaid
flowchart TD
  Make[Make setup targets] --> Setup[scripts/setup-pi]
  Setup --> Settings[~/.pi/agent/settings.json]
  Setup --> RootPackage[pi-tools-and-skills package\nfiltered global extensions]
  Setup --> UserPackage[Individual user packages\npi-goal/pi-matrix/pi-panopticon]
  Setup -. rejects .-> ProjectOnly[Project-only packages\npi-kanban/pi-coas]
  ProjectOnly --> Workspace[Workspace .pi/settings.json]
```

- `make setup` registers the repo package with the global operator extension allowlist.
- `make setup-package PACKAGE=<name>` registers only user-installable extension packages.
- `pi-kanban` and `pi-coas` remain project-only and must be enabled by the workspace that owns their state.

---

## Shared Library Layering

```mermaid
flowchart TD
  Core[Core contracts and pure helpers\nagent names, manifests, redaction, tool results, TUI render helpers]
  Runtime[Runtime/session helpers\nsession source, spool, hooks, agent API]
  Transport[Transport adapters\nmaildir, spawn service]
  Extensions[Extensions]
  Core --> Runtime
  Core --> Extensions
  Runtime --> Extensions
  Transport --> Extensions
  Runtime -. no imports .-> Extensions
  Core -. no Node IO .-> FS[node:fs/os/child_process]
  Tests[tests/architecture.test.ts\nlib layering suite] --> Core
```

### Context policy

- Core `lib/` files expose contracts and pure formatting/render helpers; they
  must not import Node filesystem, OS, or process-spawning APIs.
  Current core files: `agent-names.ts`, `completion-signal.ts`,
  `message-transport.ts`, `oracle-judge.ts`, `secret-redaction.ts`,
  `task-brief.ts`, `tool-result.ts`, `tui-confirmation.ts`, and
  `tui-overflow.ts`.
- IO/runtime `lib/` files own shared filesystem, process, settings, session,
  spawn, and agent-registry behavior. Current IO/runtime files: `agent-api.ts`,
  `agent-registry.ts`, `file-persistence.ts`, `pi-settings.ts`,
  `session-hook-installer*.ts`, `session-log.ts`, `session-source*.ts`,
  `session-spool*.ts`, `spawn-events.ts`, `spawn-rpc.ts`, and
  `spawn-service.ts`.
- Pure runtime mappers that do not touch IO may live beside runtime helpers when
  their data shape is runtime-specific; currently `session-journal.ts` is in
  this bucket.
- Transport adapters live under `lib/transports/`; they may perform
  protocol-specific IO but must depend only on lower-level contracts/services,
  not extension runtime modules.
- Runtime/session and transport `lib/` files may perform IO, but must stay below
  extensions and must not import extension runtime code.
- Dependency direction is one-way: extensions may import `lib/`; `lib/` must not
  import `extensions/`. Core contracts should stay below IO/runtime helpers; any
  exception must be documented rather than hidden.
- `tests/architecture.test.ts` enforces the currently practical parts of this
  layering policy: all `lib/` TypeScript modules are classified, core files do
  not import Node IO modules, core files do not value-import higher IO/runtime
  layers, and `lib/` modules do not import extension runtime code.

---

## Runtime State Boundary

```mermaid
flowchart TD
  ExtensionA[Extension A] --> PublicApi[Owning extension public API\ntools, commands, session events, shared services]
  PublicApi --> ExtensionB[Extension B]
  ExtensionA -. forbidden .-> PrivateState[Other extension private state files]
  Tests[tests/architecture.test.ts] --> PrivateState
```

### Context policy

- Static import isolation remains mandatory but is not the whole runtime boundary.
- Extension-owned state files are private; other extensions must not read, write,
  parse, or infer behavior from them.
- Cross-extension cooperation must stay at the owning extension's public runtime
  API: tools, commands, documented session events, or documented shared library
  services.
- Architecture fitness tests enforce that extension runtime code does not
  reference another extension's private state markers.

---

## Persistence Discipline

```mermaid
flowchart TD
  StateOwner[State-owning extension/lib code] --> Helpers[lib/file-persistence.ts]
  Helpers --> Atomic[writeFileAtomic\ntemp file + rename]
  Helpers --> Append[appendLogLine\nopen append + newline]
  Helpers --> Json[updateJsonFile\nread/update/atomic rewrite]
  StateOwner -. documented exception .-> Exception[Protocol/lifecycle-specific IO]
  Tests[architecture runtime-state-boundaries suite] --> StateOwner
```

### Context policy

- Common full-file state writes should use `writeFileAtomic()` so readers see a
  complete old or new file, not a partial rewrite.
- Append-only event logs should use `appendLogLine()` for one-line appends with
  consistent directory creation and file mode behavior.
- JSON read/update/write cycles should use `updateJsonFile()` unless the caller
  needs a stronger domain-specific transaction.
- Atomic rename does not serialize competing read/modify/write cycles. Where
  concurrent writers can update the same derived state, use an owning append log,
  an advisory lock, or document why last-writer-wins is acceptable.
- Direct `writeFile`/`appendFile` use in state-writing code must either move
  through the shared helper or appear as an explicit architecture-test exception
  with rationale.

---

## UX and Tool Policy

Detailed TUI consistency, command/tool namespace, confirmation, overflow, and raw-ANSI rules live in [`docs/deep-dives/ux-tools-policy.md`](deep-dives/ux-tools-policy.md). This architecture reference only records the boundary: shared helpers such as `lib/tui-confirmation.ts`, `lib/tui-overflow.ts`, and `lib/tool-result.ts` define reusable primitives, while `tests/architecture.test.ts` enforces the stable policy.

## Kanban Extension

```mermaid
flowchart TD
  User[Human / orchestrator] --> Pi[pi agent session]
  CoAS[pi-coas scheduler\nrecurring operational policy owner] -->|scheduled prompt may call kanban_* tools| Pi
  Pi --> Tools[Kanban tool adapters\n10 model-visible tools]
  Pi --> Watcher[board.log watcher\nevent-driven only]
  Pi --> Overlay[/kanban TUI overlay\nkeyboard navigation + / filter]
  Overlay --> Confirm[Shared destructive confirmation\ny confirm / esc/n cancel]
  Theme[KANBAN_BOARD_THEME\ndefault/focus/mono] --> Overlay

  Tools --> Board[board.ts event-sourced board model]
  Watcher --> Board
  Overlay --> Board
  Board --> Log[(pi-kanban/board.log)]
  Board --> Tasks[(pi-kanban/tasks/T-NNN.md)]

  Tools --> Snapshot[snapshot.ts renderers]
  Snapshot --> Compact[Compact summary\nIDs + short status only]
  Snapshot --> TaskDetail[Single-card detail\nrequested by task_id]
  Snapshot --> Full[Full board detail\nrequested by detail=full]
  Snapshot --> SnapshotFile[(pi-kanban/snapshot.md\nfull board)]

  Watcher --> Injection[followUp message\ncompact guidance only]
  Injection --> Pi
  Pi -->|default kanban_snapshot| Compact
  Pi -->|explicit task_id| TaskDetail
  Pi -->|explicit detail=full or /kanban| Full
```

### Context policy

- LLM-visible surface unified around `kanban_claim` (pick/claim/reassign) and
  `kanban_edit` (metadata/notes).
- Watcher injects guidance only; does not inject board contents.
- `/kanban` uses pi's active TUI theme with a restrained `KANBAN_BOARD_THEME` semantic remap (`default`, `focus`, `mono`).
- `kanban_snapshot` defaults to compact output: counts, card IDs, short
  titles/owners, no descriptions or notes.
- Full board and single-card details are explicit on-demand views.
- Recurring schedules, cron-like cadence, morning briefs, state capture, recurring reviews, and CoAS operational policy belong to `pi-coas`, not `pi-kanban`.
- `pi-kanban` watcher follow-ups are event-driven board-change notifications, not a scheduler.

---

## Panopticon Controls

```mermaid
flowchart TD
  Caller[Model / RPC caller] --> GetName[get_name tool]
  Caller --> SetName[set_name tool]
  SetName --> Session[Pi session display name]
  SetName --> Registry[Panopticon registry record]
  Registry --> Display[Agent lists and peer routing]
  Display --> AgentsOverlay[/agents overlay\nstatus, fuzzy filter, detail/list navigation, messaging, stop/kill]
  AgentsOverlay --> Confirm[Shared destructive confirmation\ny confirm / esc/n cancel]
  Confirm --> Signals[Process signals\nSIGTERM / SIGKILL]
  AgentsOverlay --> Maildir[Agent transport\nMaildir channel]
  Maildir --> Peers[Peer / spawned agents]
  Signals --> Peers
  GetName --> Details[Session, registry, and spawn-name metadata]

  Registry --> Reconciler[Reconciliation loop]
  State[Operational workspace state] --> Reconciler
  Reconciler --> Classifier[Actionable vs informational findings]
  Classifier -->|pending / blocked / confirmed stale / silent termination| FollowUp[followUp message]
  Classifier -->|idle healthy peers| Suppress[Suppress idle noise]
```

### Context policy

- `set_name` and `get_name` are the only model-visible naming tools.
- Deprecated `set_alias` and `get_alias` wrappers have been removed after their
  deprecation window.
- Registry routing remains based on stable peer IDs; display names are UI labels.
- `/agents` can send direct human-authored messages through the same agent transport as `agent_send`; replies still arrive through normal unread-message handling.
- `/agents` list view supports `/`-activated fuzzy filtering for long visible agent lists without changing registry routing or unread-first sorting.
- `/agents` detail view uses `backspace`/left-arrow to return to the agent list while `esc` closes the overlay.
- `/agents` detail view can stop visible peer agents with SIGTERM or force-kill with SIGKILL after confirmation; it refuses to target the current agent.
- Reconciliation follow-ups are sparse and action-oriented; stale worker alerts
  require a fresh confirmation read, and idle stale-activity checks are
  suppressed when peers are healthy and have no pending messages (ADR 014).

---

## Matrix Outbound Rich Text

```mermaid
flowchart TD
  Agent[Agent plain Markdown reply] --> Formatter[pi-matrix Markdown formatter]
  Formatter --> Html[Matrix-safe HTML fragment]
  Formatter --> Plain[Plain-text fallback]
  Html --> Content[m.text content\nformat=org.matrix.custom.html]
  Plain --> Content
  Content --> SDK[matrix-bot-sdk sendMessage]
  SDK --> Client[Matrix client rendering]
```

### Context policy

- Outbound formatting is intentionally local and dependency-free.
- Raw HTML is escaped except simple `<u>...</u>` underline tags needed by Matrix rich text.
- Plain-text fallback strips Markdown markers and uses readable Unicode symbols for bullets, quotes, and horizontal rules.

---

## Matrix Attachment Ingestion

```mermaid
flowchart TD
  Human[Human Matrix client] --> HS[Homeserver media repository]
  HS --> SDK[matrix-bot-sdk sync loop]
  SDK --> Matrix[pi-matrix MatrixBridgeClient]
  Matrix --> Filter[trusted sender + msgtype filter]
  Filter --> Text[m.text / m.notice / m.emote]
  Filter --> Media[m.image / m.file / m.audio / m.video]
  Media --> Gates[MIME allowlist + maxAttachmentBytes]
  Gates --> Download[Matrix media API stream]
  Gates --> Deferred[encrypted blob deferred]
  Download --> Cache[(attachmentCachePath)]
  Text --> Transport[MatrixTransport]
  Cache --> Transport
  Transport --> Panopticon[pi-panopticon message_read]
  Panopticon --> Agent[Agent reads local paths explicitly]
```

### Context policy

- Matrix attachments are external input and are not executed or parsed automatically.
- `message_read` includes filename, MIME, size, local path, MXC URL, room, and event metadata.
- Workers use built-in `read` on local image/PDF/file paths only when the task requires it.
- Encrypted media blobs are deferred because the SDK decrypt helper does not expose a bounded download path; a visible attachment error is surfaced.

---

## Research Tool Boundary

```mermaid
flowchart TD
  DeepResearch[Panopticon teams deep-research\nExplorer / Verifier / Synthesis] --> PromptTools[Implicit prompt tool names]
  PromptTools --> Registered[pi-research-tools in pi-extension-poc\nregistered dry-run tools]
  PromptTools --> Manifest[pi-extension-poc lib/research-tool-fixtures.ts\nmetadata fixtures]
  Registered --> Json[Typed params + JSON output\nempty dry-run envelopes]
  Manifest -. declares only .-> Artifacts[sources/manifest.json\nsourceId + provenance metadata]

  Registered -. no runtime .-> NoNetwork[No live network/API calls]
  Registered -. no runtime .-> NoCreds[No credentials]
  Registered -. no runtime .-> NoWrites[No artifact writes]
```

### Context policy

- Research-tool metadata in `/home/jim/git/pi-extension-poc` remains the source for compatibility checks and future provider design.
- `pi-research-tools` exposes a narrow registered-tool slice with typed parameters and JSON dry-run output only; this repo no longer owns its implementation.
- Deep-research workflow policy stays in `extensions/pi-panopticon/teams` prompts and protocol handlers.
- Source IDs, provenance fields, artifact paths, and result semantics are declared before any provider/runtime promotion.
- Runtime providers, credential handling, extension loading changes, durable artifact persistence, and deletion of old research behavior require separate approval/ADR.

---

## Goal Workflow Extension

```mermaid
flowchart TD
  User[Human / root agent] --> Command[/goal command]
  Agent[Active agent turn] --> Tools[goal_get / goal_complete]
  Command --> State[(.pi/goal/goal.json)]
  Command --> Summary[(.pi/goal/GOAL.md)]
  Command --> Todo[(.pi/goal/TODO.md)]
  Command --> Runner[Bounded run loop]
  Runner --> Fresh[Fresh pi session per turn]
  Fresh --> Agent
  Agent --> Tools
  Tools --> State
  Tools --> Summary
  Agent --> Transcript[(.pi/goal/runs/YYYY/MM/DD/*)]
  State --> Context[before_agent_start goal context]
  Context --> Agent
  State --> UI[status/widget progress]
```

### Context policy

- `.pi/goal/` is project-local runtime state and is automatically added to `.git/info/exclude` when possible.
- `pi-goal` owns `.pi/goal/`; other extensions, including `pi-panopticon`, must not read, parse, write, or infer behavior from those files.
- Cross-extension goal orchestration must use public runtime surfaces: `/goal`, `goal_get`, `goal_complete`, agent messages/tools, or extension host APIs.
- `/goal` bounds autonomous progress by turn budget; `/goal stop` requests graceful stopping at safe turn boundaries.
- `goal_complete` is root-owned and requires concrete evidence after re-reading source requirements and checking validation state.
- Goal text and source files are treated as untrusted input; current repository/filesystem state remains authoritative.

---

## CoAS Internal Scheduler

### Goal
Replace crontab-oriented CoAS scheduling with a pi-hosted internal scheduler.
Schedule files remain the desired state; active in-memory timers become runtime
reality while pi is open. CoAS owns recurring operational policy over other
extension surfaces, including scheduled prompts that may use `kanban_*` tools for
WIP pick routines, morning briefs, state capture, and recurring reviews.

### Constraints

- Preserve existing schedule file format and model-callable parameters.
- Do not execute schedules outside pi.
- Do not modify user crontab.
- Keep schedule execution explicit: inject a user message into pi when due.
- Keep implementation small and testable.

### Architecture

```mermaid
C4Component
    title pi-coas internal scheduler
    Container(pi, "pi session", "Extension host", "Runs extension lifecycle and message injection")
    Component(coas, "pi-coas", "Extension", "Owns schedule tools, commands, and lifecycle")
    Component(files, "Schedule files", "~/.coas/schedules", "Desired schedule state")
    Component(scheduler, "Internal scheduler", "Timer loop", "Reconciles enabled schedules and queues due prompts")
    Component(agent, "Pi agent turn", "LLM runtime", "Executes scheduled prompt as normal user message")
    Component(kanban, "pi-kanban tools", "Board surface", "Reusable board state/actions; no recurring schedule ownership")
    Rel(pi, coas, "loads")
    Rel(coas, files, "reads/writes")
    Rel(coas, scheduler, "starts/stops/reconciles")
    Rel(scheduler, files, "polls desired state")
    Rel(scheduler, agent, "sendUserMessage")
    Rel(agent, kanban, "may call kanban_* tools from scheduled prompt")
```

### Acceptance criteria

- `pi-coas` starts/stops an internal scheduler on session lifecycle.
- Schedule add/remove reconciles in-memory timers.
- `/coas-schedules`, `coas_status`, `coas_doctor`, and the compact TUI status field report internal scheduler
  state instead of crontab state.
- Cron install/uninstall commands replaced by internal scheduler commands/status.
- Tests cover due-time matching and schedule prompt rendering.
- CoAS remains the owner for recurring operational policy; `pi-kanban` remains schedule-free.
