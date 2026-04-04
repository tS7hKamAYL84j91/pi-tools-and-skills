# tools-and-skills

Pi agent infrastructure: multi-agent messaging, spawning, and monitoring as a single pi extension.

## Structure

```
extensions/pi-panopticon/   Unified extension (auto-discovered by pi)
  index.ts                 Lifecycle orchestrator
  registry.ts              Agent registration + heartbeat
  messaging.ts             agent_send, agent_broadcast, /send
  spawner.ts               spawn_agent, rpc_send, kill_agent, list_spawned
  spawner-utils.ts         Pure helpers: arg building, gracefulKill, child process
  peek.ts                  agent_peek
  ui.ts                    Powerline widget, /agents overlay, /alias
  types.ts                 Shared interfaces

lib/                       Shared libraries
  agent-registry.ts        AgentRecord type + cleanup hooks
  message-transport.ts     MessageTransport interface (DI boundary)
  transports/maildir.ts    At-least-once delivery via Maildir
  session-log.ts           Pi session JSONL reader
  task-brief.ts            TaskBriefSchema + renderBriefAsPrompt
  tool-result.ts           ok()/fail() helpers

skills/                    Specialized agent skills
prompts/                   Prompt templates (refactor, commit-and-push)
tests/                     135 tests (vitest + archunit)
docs/                      C4 architecture diagrams
planning/                  PLAN.md, PROGRESS.md, KNOWLEDGE.md
```

## Setup

Already configured in `~/.pi/agent/settings.json`:
```json
{ "extensions": ["/Users/jim/git/tools-and-skills/extensions"] }
```

## Development

```bash
npm run check     # typecheck → lint → knip → type-coverage (98.91%)
npm test          # 135 tests (unit + architectural fitness)
```

## Docs

- [C4 Architecture](docs/C4.md) — Context, Container, Component, Code diagrams
- [Maildir Transport](docs/MAILDIR-TRANSPORT.md) — Protocol deep-dive
- [AGENT.md](AGENT.md) — Coding standards + quality gates
