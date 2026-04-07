# tools-and-skills

Pi agent infrastructure: multi-agent messaging, spawning, monitoring, kanban task tracking, and reusable skills — all as pi extensions.

## Structure

```
extensions/pi-panopticon/    Unified panopticon extension (auto-discovered by pi)
  health.ts                  Agent health checks + nudge delivery
  index.ts                   Lifecycle orchestrator
  messaging.ts               agent_send, agent_broadcast, /send
  peek.ts                    agent_peek
  peers.ts                   Peer agent discovery
  registry.ts                Agent registration + heartbeat
  spawner-utils.ts           Pure helpers: arg building, gracefulKill, child process
  spawner.ts                 spawn_agent, rpc_send, kill_agent, list_spawned
  types.ts                   Shared interfaces
  ui.ts                      Powerline widget, /agents overlay, /alias

project-extensions/kanban/   Kanban board extension (add per-project in settings.json)
  board.ts                   Event-sourcing parser + path helpers + types
  index.ts                   14 kanban tools + auto-compaction logic
  monitor.ts                 Agent health inspection + nudge delivery
  snapshot.ts                Markdown snapshot renderer
  watcher.ts                 board.log watcher: widget + auto-injection

vscode-extension/            CoAS Kanban VSCode panel
  src/extension.ts           Extension entry point (registers "CoAS: Open Kanban Board")
  src/kanbanPanel.ts         WebviewPanel host — parses board.log, handles UI messages
  media/kanban.js            Frontend: drag-and-drop columns, inline edit, create form
  media/kanban.css           Panel styles
  coas-kanban-0.1.0.vsix     Pre-built VSIX package

lib/                         Shared libraries
  agent-api.ts               Public API: findAgentByName, sendAgentMessage
  agent-registry.ts          AgentRecord type + cleanup hooks
  message-transport.ts       MessageTransport interface (DI boundary)
  session-log.ts             Pi session JSONL reader
  task-brief.ts              TaskBriefSchema + renderBriefAsPrompt
  tool-result.ts             ok()/fail() helpers
  transports/maildir.ts      At-least-once delivery via Maildir

skills/                      Specialized agent skills (see skills/README.md)
  planning/                  Manus-style PLAN.md / PROGRESS.md / KNOWLEDGE.md
  research-expert/           Academic paper search, web reader, GitHub search
  red-team/                  Security vulnerability assessment (MITRE ATLAS)
  skill-creator/             Create and refine new skills

prompts/                     Prompt templates
  commit-and-push.md         Git commit + push workflow
  refactor.md                Code refactoring guidance

scripts/                     Maintenance utilities
  c4-auto.ts                 C4 diagram generator
  clean-mailboxes.sh         Orphaned Maildir mailbox cleanup

tests/                       188 tests (vitest + archunit)
```

## Components

### Pi-Panopticon Extension

The core multi-agent infrastructure extension. Auto-loaded from `extensions/` by pi.

Provides these tools to every pi session:
- **agent_send** / **agent_broadcast** — Maildir-backed message delivery
- **spawn_agent** / **rpc_send** / **kill_agent** / **list_spawned** — agent lifecycle
- **agent_peek** / **agent_status** / **agent_nudge** — discovery and health

See [AGENT.md](AGENT.md) for coding standards.

### Kanban Extension

A full kanban board backed by an append-only `board.log`. Add to projects by pointing `settings.json` at `project-extensions/`.

**14 tools:** `kanban_create`, `kanban_pick`, `kanban_claim`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_note`, `kanban_move`, `kanban_edit`, `kanban_delete`, `kanban_compact`, `kanban_snapshot`, `kanban_monitor`, `kanban_reassign`

Key features:
- **Event sourcing** — `board.log` is the source of truth; every action is an appended line
- **Watcher** — detects external writes to `board.log` and auto-injects `kanban_monitor` prompts
- **Auto-compaction** — rewrites `board.log` when >500 lines or dirty ratio >2× (Kafka-style)
- **Snapshot** — regenerates `snapshot.md` in Markdown for human/LLM consumption
- **Monitor** — checks agent heartbeats, detects STALLED/DONE/MISSING, delivers nudges

See [project-extensions/kanban/README.md](project-extensions/kanban/README.md) for full docs.

### VSCode Extension

A live kanban board panel for VSCode. Reads `board.log` directly and auto-refreshes on changes.

- Open via **Command Palette → CoAS: Open Kanban Board**
- Drag-and-drop tasks between columns
- Inline edit title/priority/tags/description
- Add notes, delete tasks, create new tasks via form
- Enforces WIP limit (prompts for block reason when dragging to blocked)

See [vscode-extension/README.md](vscode-extension/README.md) for build and install instructions.

### Skills

Reusable instruction sets that agents load on demand. See [skills/README.md](skills/README.md) for descriptions of all four skills.

## Setup

Panopticon is already configured in `~/.pi/agent/settings.json`:
```json
{ "extensions": ["/Users/jim/git/tools-and-skills/extensions"] }
```

To add the kanban extension to a project, add `project-extensions/` to the extensions list in that project's settings:
```json
{ "extensions": [
    "/Users/jim/git/tools-and-skills/extensions",
    "/Users/jim/git/tools-and-skills/project-extensions"
  ]
}
```

## Development

```bash
npm run check     # typecheck → lint → knip → type-coverage (≥95%)
npm test          # 188 tests (vitest + archunit)
```

Quality gates (enforced by `npm run check`):
- **TypeScript strict** — `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- **Biome lint** — `noExplicitAny`, `useImportType`, `useNodejsImportProtocol`
- **Knip** — zero unused exports, files, or dependencies
- **Type coverage** — minimum 95%
