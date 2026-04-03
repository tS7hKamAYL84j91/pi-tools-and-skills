# tools-and-skills

Pi agent infrastructure: multi-agent messaging, spawning, and monitoring as a single pi extension.

## Structure

```
extensions/pi-jb-agents/   Unified extension (auto-discovered by pi)
  index.ts                 Lifecycle orchestrator
  registry.ts              Agent registration + heartbeat
  messaging.ts             agent_send, agent_broadcast, /send
  spawner.ts               spawn_agent, rpc_send, kill_agent
  peek.ts                  agent_peek
  socket.ts                Unix socket server
  ui.ts                    Powerline widget, /agents overlay, /alias
  types.ts                 Shared interfaces

lib/                       Shared libraries
  agent-registry.ts        AgentRecord type + file IO
  message-transport.ts     MessageTransport interface (DI boundary)
  transports/maildir.ts    At-least-once delivery via Maildir
  session-log.ts           Pi session JSONL reader
  tool-result.ts           ok()/fail() helpers

skills/                    Specialized agent skills
tests/                     102 tests (vitest)
```

## Setup

Already configured in `~/.pi/agent/settings.json`:
```json
{ "extensions": ["/Users/jim/git/tools-and-skills/extensions"] }
```

## Development

```bash
npm test          # 102 tests
npm run check     # typecheck + lint + type-coverage (98.8%)
```

## Docs

- `docs/MAILDIR-TRANSPORT.md` — Maildir protocol deep-dive
- `docs/PI-MESSAGING-ARCHITECTURE.md` — Transport interface design
- `docs/PI-MESSAGING-GUIDE.md` — Messaging usage examples
