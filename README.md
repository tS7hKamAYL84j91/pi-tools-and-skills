# pi-tools-and-skills

Reusable extensions, skills, memories, prompts, and shared libraries for [pi](https://github.com/mariozechner/pi-coding-agent) — a local-first coding agent.

This repo is intentionally workspace-agnostic. It does not configure model choices, provider defaults, Matrix deployments, shell hooks, secrets, launchers, or project-specific state. Those belong in the workspace or infrastructure repo that uses this package.

## Getting started

### Prerequisites

- [pi](https://github.com/mariozechner/pi-coding-agent) installed and working
- Node.js 22+
- Python 3

### 1. Install

For local development:

```bash
git clone https://github.com/tS7hKamAYL84j91/pi-tools-and-skills.git
cd pi-tools-and-skills
npm install
```

For pi package installation:

```bash
pi install git:github.com/tS7hKamAYL84j91/pi-tools-and-skills
# or from a local checkout:
pi install /absolute/path/to/pi-tools-and-skills
```

The package manifest exposes `extensions/`, `skills/`, and `prompts/` to pi. `make setup` registers this checkout as a local pi package with a global extension filter for `pi-panopticon`, `pi-cheatsheets`, and `pi-llm-council`; it also registers memories. It does not alter runtime/project settings.

### 2. Set up

```bash
make help   # show targets
make setup  # register extensions, skills, prompts, memories
```

### 3. Run pi

After setup, run pi normally in any workspace:

```bash
pi
```

Add project extensions such as `kanban` or `matrix` per workspace via that workspace's `.pi/settings.json`.

---

## What's included

### Extensions

`make setup` globally enables only reusable operator extensions. Project/runtime extensions stay opt-in per workspace.

| Extension | Type | What it does |
|-----------|------|-------------|
| **pi-panopticon** | Global | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring, lifecycle management |
| **pi-cheatsheets** | Global | `.mmem.yml` cheat sheets — tool/domain knowledge injected into agent context on demand |
| **pi-llm-council** | Global | Heterogeneous multi-model debate using the runtime model registry and visible config |
| **kanban** | Project | Event-sourced task board — tools, TUI overlay (`/kanban`), auto-compaction, snapshot renderer |
| **matrix** | Project | Phone ↔ agent bridge via Matrix — notification + inbox pattern, `message_read` / `message_send` tools |

### Skills

Reusable prompt templates that agents can follow for specific tasks.

| Skill | Purpose |
|-------|---------|
| **clean-room** | IBM Cleanroom methodology — spec, independent implementation, statistical verification |
| **code-forensics** | Git archaeology — hotspots, temporal coupling, knowledge maps, churn analysis |
| **deep-research** | RhinoInsight VCM/EAM pattern — iterative search, gap detection, evidence-bound synthesis |
| **planning** | Persistent markdown planning with PLAN.md, PROGRESS.md, KNOWLEDGE.md |
| **problem-crystalliser** | Turn vague requests into actionable problem statements |
| **red-team** | Security assessment — vulnerability identification, MITRE ATLAS mapping |
| **six-thinking-hats** | De Bono's structured multi-perspective analysis |
| **notebooklm** | NotebookLM integration — create notebooks, upload sources, generate audio |
| **jules-delegation** | Delegate scoped coding tasks to Google Jules and monitor sessions/PRs |
| **pi-agent-orchestration** | Spawn, brief, monitor, nudge, and shut down pi worker agents |
| **pi-extension-dev** | Build or modify pi extensions, tools, commands, hooks, and TUI widgets |
| **pi-session-management** | Implement session-aware behavior, persistence, compaction, and reload-safe flows |
| **skill-creator** | Meta-skill for creating and improving skills |

### Pi Cheatsheets

Global `.mmem.yml` cheatsheets providing compact reference knowledge:

- `pi-kanban` — kanban extension patterns and tool usage
- `pi-extension-dev` — compact extension API reminders and gotchas
- `pi-agent-orchestration` — compact agent tool reminders and orchestration gotchas
- `pi-session-management` — compact lifecycle API reminders and session gotchas
- `node-esm-gotchas` — common ESM pitfalls

The `pi-*` cheatsheets have matching skills for workflow guidance; the `.mmem.yml` files remain as compact companion reference.

---

## Commands

Everything goes through `make`:

| Command | What |
|---------|------|
| `make` / `make help` | Show available targets |
| `make setup` | Install this checkout as a local pi package and register memories with pi |
| `make check` | Typecheck + Biome lint + knip + type-coverage (≥95%) |
| `make typecheck` / `make lint` / `make knip` / `make type-coverage` | Run one quality gate |
| `make test` | Run tests |
| `make test-watch` | Run tests in watch mode |
| `make clean-mailboxes` | Clean stale agent mailboxes |
| `make clean-mailboxes DRY_RUN=1` | Preview stale mailbox cleanup |

---

## Structure

```text
extensions/           Extensions:
  pi-panopticon/        Global — multi-agent messaging, spawning, health
  pi-cheatsheets/       Global — .mmem.yml cheat sheets
  pi-llm-council/       Global — multi-model deliberation from runtime model registry
  kanban/               Project — event-sourced task board + TUI overlay
  matrix/               Project — phone ↔ agent bridge via Matrix
lib/                  Shared: agent-api, maildir transport, tool-result helpers
skills/               Agent skills (clean-room, deep-research, planning, ...)
memories/             Global .mmem.yml cheatsheet files
prompts/              Prompt templates (refactor, commit-and-push)
scripts/              Setup and utility scripts
tests/                Tests (vitest + archunit fitness functions)
```

Global extensions (panopticon, pi-cheatsheets, pi-llm-council) are installed by `make setup` through this repo's local pi package entry. Project extensions (kanban, matrix) are added per-workspace in `.pi/settings.json`.

## Development

```bash
make help         # list all targets
make check        # typecheck → biome lint → knip → type-coverage (≥95%)
make lint         # run one quality gate
make test         # run tests
make test-watch   # run tests in watch mode
make setup        # register pi package and memories
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENTS.md](AGENTS.md) for coding standards.

## Security

The design assumes a **trusted host**. External input (Matrix messages, agent-to-agent messages) is treated as untrusted and wrapped in structured tags before entering the LLM context. User-facing fields (task titles, agent names, tool names) are validated or sanitised at system boundaries. Matrix deployment assumptions belong in the workspace or infrastructure repo, not here.

## License

[MIT](LICENSE)
