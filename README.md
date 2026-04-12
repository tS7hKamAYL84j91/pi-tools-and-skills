# tools-and-skills

Pi agent infrastructure: multi-agent messaging, spawning, monitoring, kanban task tracking, Matrix-to-phone bridge, and reusable skills — all as pi extensions.

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

extensions/machine-memory/   Machine memory extension (.mmem.yml cheat sheets)
  discover.ts                Memory file discovery from settings + project paths
  format.ts                  Index rendering + token estimation
  index.ts                   mmem_create, mmem_list, mmem_inject, mmem_update, mmem_validate
  overlay.ts                 /mmem TUI overlay
  parse.ts                   YAML frontmatter parser
  types.ts                   MemoryFile, MemoryMeta, MemorySource
  validate.ts                Format spec validation
  write.ts                   Skeleton generation + append updates

project-extensions/kanban/   Kanban board extension (add per-project in settings.json)
  board.ts                   Event-sourcing parser + path helpers + mutation helpers
  compaction.ts              Log compaction: rewrite board.log to minimal reconstruction
  index.ts                   14 kanban tools
  monitor.ts                 Agent health inspection + nudge delivery
  overlay.ts                 /kanban TUI overlay (controller + state machine)
  overlay-render.ts          Pure rendering functions for the kanban overlay
  snapshot.ts                Markdown snapshot renderer
  watcher.ts                 board.log watcher: widget + auto-injection

project-extensions/matrix/   Matrix bridge extension (phone ↔ agent via Matrix room)
  bridge.ts                  MXID parsing utility
  client.ts                  matrix-bot-sdk wrapper: connect, sync, send
  config.ts                  Settings loader + env-var resolution
  index.ts                   matrix_send, matrix_read, matrix_status tools
  types.ts                   MatrixConfig type
  SETUP.md                   One-time setup playbook (matrix.org + E2EE + self-hosted)

lib/                         Shared libraries
  agent-api.ts               Public API: findAgentByName, sendAgentMessage
  agent-registry.ts          AgentRecord type + cleanup hooks
  message-transport.ts       MessageTransport interface (DI boundary)
  session-log.ts             Pi session JSONL reader
  task-brief.ts              TaskBriefSchema + renderBriefAsPrompt
  tool-result.ts             ok()/fail() helpers
  transports/maildir.ts      At-least-once delivery via Maildir

skills/                      Specialized agent skills (see SKILLS.md)

prompts/                     Prompt templates
  commit-and-push.md         Git commit + push workflow
  refactor.md                Code refactoring guidance

scripts/                     Utilities
  c4-auto.ts                 C4 diagram generator
  clean-mailboxes.sh         Orphaned Maildir mailbox cleanup
  matrix-login.ts            Matrix bot account provisioning (password → token)
  coas-secrets.sh            Platform-agnostic secret store (Keychain / pass)

memories/                    Global machine memory files (.mmem.yml)

tests/                       232 tests (vitest + archunit)
```

## Components

### Pi-Panopticon Extension

The core multi-agent infrastructure extension. Auto-loaded from `extensions/` by pi.

Provides these tools to every pi session:
- **agent_send** / **agent_broadcast** — Maildir-backed message delivery
- **spawn_agent** / **rpc_send** / **kill_agent** / **list_spawned** — agent lifecycle
- **agent_peek** / **agent_status** / **agent_nudge** — discovery and health

### Kanban Extension

A full kanban board backed by an append-only `board.log`. Add to projects by pointing `settings.json` at `project-extensions/kanban`.

**14 tools:** `kanban_create`, `kanban_pick`, `kanban_claim`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_note`, `kanban_move`, `kanban_edit`, `kanban_delete`, `kanban_compact`, `kanban_snapshot`, `kanban_monitor`, `kanban_reassign`

Key features:
- **Event sourcing** — `board.log` is the source of truth; every action is an appended line
- **TUI overlay** — `/kanban` command or `ctrl+shift+k` for a full 5-column board view with keyboard navigation and task detail
- **Auto-compaction** — rewrites `board.log` when >500 lines or dirty ratio >2× (Kafka-style)
- **Watcher** — detects external writes to `board.log` and auto-injects prompts when idle
- **Mutation helpers** — `deleteTask()` / `moveTask()` in board.ts as the single source of truth for log format + validation

### Matrix Extension

Bridges a private Matrix room to pi's prompt — type on your phone, the agent reads and replies.

**3 tools:** `matrix_send`, `matrix_read`, `matrix_status`

Key features:
- **Notification + inbox pattern** — sync loop buffers messages, pokes the agent when idle, agent calls `matrix_read` when ready
- **matrix-bot-sdk** with optional E2EE via Rust crypto
- **Homeserver-agnostic** — works against matrix.org or a self-hosted Continuwuity
- **Platform-native secrets** — `coas-secrets.sh` reads tokens from macOS Keychain or Linux `pass`

See [project-extensions/matrix/README.md](project-extensions/matrix/README.md) for the runtime contract and [project-extensions/matrix/SETUP.md](project-extensions/matrix/SETUP.md) for the setup playbook.

### Machine Memory Extension

Gradual-exposure agent cheat sheets (`.mmem.yml` files). Auto-loaded from `~/.pi/agent/memories/`, project `.pi/memories/`, and settings.json paths.

**5 tools:** `mmem_create`, `mmem_list`, `mmem_inject`, `mmem_update`, `mmem_validate`

### Skills

Reusable instruction sets that agents load on demand. See [SKILLS.md](SKILLS.md) for the full catalogue.

## Install

### 1. Clone and install

```bash
git clone https://github.com/tS7hKamAYL84j91/tools-and-skills.git
cd tools-and-skills
npm install
```

### 2. Add panopticon extension (global — all pi sessions)

Edit `~/.pi/agent/settings.json`:
```json
{
  "extensions": [
    "/path/to/tools-and-skills/extensions"
  ]
}
```

### 3. Add project extensions (per-project)

Create `.pi/settings.json` in your project root:
```json
{
  "extensions": [
    "/path/to/tools-and-skills/project-extensions/kanban",
    "/path/to/tools-and-skills/project-extensions/matrix"
  ]
}
```

### 4. Add skills and memories (optional)

```json
{
  "skills": ["/path/to/tools-and-skills/skills"],
  "memories": ["/path/to/tools-and-skills/memories"]
}
```

## Development

```bash
npm run check     # typecheck → lint → knip → type-coverage (≥95%)
npm test          # 232 tests (vitest + archunit)
```

Quality gates (enforced by `npm run check`):
- **TypeScript strict** — `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- **Biome lint** — `noExplicitAny`, `useImportType`, `useNodejsImportProtocol`
- **Knip** — zero unused exports, files, or dependencies
- **Type coverage** — minimum 95%
- **Architecture tests** — dependency direction, file size limits, isolation rules

See [AGENT.md](AGENT.md) for coding standards and [prompts/refactor.md](prompts/refactor.md) for refactoring guidance.
