# tools-and-skills

Pi agent infrastructure: multi-agent orchestration, kanban task tracking, phone-to-agent Matrix bridge, machine memories, and reusable skills.

## Quick start

```bash
git clone https://github.com/tS7hKamAYL84j91/tools-and-skills.git
cd tools-and-skills
npm install
./setup-pi.sh        # registers extensions, skills, memories, secrets, shell hooks
exec zsh             # reload shell
coas                 # start pi in the coas workspace (alias set by setup-pi.sh)
```

## Extensions

### Global (loaded in every pi session)

| Extension | What it does |
|---|---|
| **pi-panopticon** | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring (`agent_status`), and lifecycle management |
| **machine-memory** | `.mmem.yml` cheat sheets — gradual-exposure tool/domain knowledge injected into agent context on demand |

### Project (add per-workspace in `.pi/settings.json`)

| Extension | What it does |
|---|---|
| **kanban** | Event-sourced task board — 14 tools, TUI overlay (`/kanban`), auto-compaction, file watcher, snapshot renderer |
| **matrix** | Phone ↔ agent bridge via a private Matrix room — notification + inbox pattern, `matrix_read` / `matrix_send` tools |

## Deployment

The `coas-infra/` directory contains a Docker Compose stack for self-hosted deployment:

- **Continuwuity** — lightweight Rust Matrix homeserver
- **Caddy** — reverse proxy with `.well-known` discovery
- **Tailscale** — private mesh networking (no public IP needed)
- **coas-agent** — pi running in a container with bind-mounted repos

```bash
cd coas-infra
./scripts/coas-stack          # supervised foreground mode
./scripts/coas-bootstrap-matrix --help   # one-shot account + room provisioning
```

See [coas-infra/README.md](coas-infra/README.md) for the full setup walkthrough.

## Structure

```
extensions/
  pi-panopticon/        Agent messaging, spawning, health, registry, TUI
  machine-memory/       .mmem.yml discovery, injection, validation

project-extensions/
  kanban/               Event-sourced board, compaction, overlay, watcher
  matrix/               Matrix bridge, sync loop, notification + inbox

coas-infra/             Docker deployment (Continuwuity + Caddy + Tailscale)
lib/                    Shared: agent-api, maildir transport, tool-result helpers
skills/                 10 agent skills (clean-room, research-expert, planning, ...)
memories/               5 global .mmem.yml files (pi-kanban, pi-extension-dev, ...)
scripts/                coas-secrets, matrix-login, clean-mailboxes, validate-skills
prompts/                refactor, commit-and-push
tests/                  232 tests (vitest + archunit fitness functions)
```

## Development

```bash
npm run check     # typecheck → biome lint → knip → type-coverage (≥95%)
npm test          # 232 tests
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENT.md](AGENT.md) for coding standards.
