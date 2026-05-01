# pi-tools-and-skills

Reusable extensions, skills, prompts, and shared libraries for [pi](https://github.com/mariozechner/pi-coding-agent) — a local-first coding agent.

## Project intent

This is a coded workbench, not a branded product page. Its job is to provide reusable pi building blocks for an experimental knowledge-worker / skeleton Chief of Staff setup.

The Chief of Staff configuration itself lives in [CoAS](https://github.com/tS7hKamAYL84j91/coas). This repo stays workspace-agnostic: it supplies the harness pieces — agent orchestration, council review, project kanban, Matrix messaging, skills, prompts, and shared libraries — that any workspace can choose to load.

The operating model is deliberately cheap-first: run a small/local/open-source coordinator where possible, then delegate through pi to stronger or more expensive models only when the task needs them. The Matrix bridge exists so a private phone chat can reach the local agent without exposing a public web app. The task/state layer is still experimental; kanban works today, but it may evolve or be replaced as the Chief of Staff pattern hardens.

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

The package manifest exposes `extensions/`, `skills/`, and `prompts/` to pi. `make setup` registers this checkout as a local pi package with a global extension filter for `pi-panopticon` and `pi-llm-council`. It does not alter runtime/project settings.

### 2. Set up

```bash
make help   # show targets
make setup  # register extensions, skills, prompts
```

### 3. Run pi

After setup, run pi normally in any workspace:

```bash
pi
```

Add project extensions such as `kanban`, `matrix`, or `pi-coas` per workspace via that workspace's `.pi/settings.json`.

---

## What's included

### Extensions

`make setup` globally enables only reusable operator extensions. Project/runtime extensions stay opt-in per workspace.

| Extension | Type | What it does |
|-----------|------|-------------|
| **pi-panopticon** | Global | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring, lifecycle management |
| **pi-llm-council** | Global | Heterogeneous multi-model debate using the runtime model registry and visible config |
| **kanban** | Project | Event-sourced task board — tools, TUI overlay (`/kanban`), auto-compaction, snapshot renderer |
| **matrix** | Project | Phone ↔ agent bridge via Matrix — notification + inbox pattern, `message_read` / `message_send` tools |
| **pi-coas** | Project | CoAS status, doctor, workspace, and schedule control surface |

### Skills

Reusable skills for pi-platform tooling and compact reference guidance. Operator and methodology skills (clean-room, code-forensics, deep-research, planning, problem-crystalliser, red-team, six-thinking-hats, notebooklm, jules-delegation) live in [CoAS](https://github.com/tS7hKamAYL84j91/coas).

| Skill | Purpose |
|-------|---------|
| **node-esm-gotchas** | Avoid common Node.js ESM and TypeScript module-resolution mistakes |
| **pi-agent-orchestration** | Spawn, brief, monitor, message, and shut down pi worker agents |
| **pi-extension-dev** | Build or modify pi extensions, tools, commands, hooks, and TUI widgets |
| **pi-kanban** | Use the project kanban board: create, claim, update, snapshot, and complete tasks |
| **pi-model-selection** | Verify pi-visible models and route work to the right provider/model |
| **pi-session-management** | Implement session-aware behavior, persistence, compaction, and reload-safe flows |
| **skill-creator** | Meta-skill for creating and improving skills |

---

## Commands

Everything goes through `make`:

| Command | What |
|---------|------|
| `make` / `make help` | Show available targets |
| `make setup` | Install this checkout as a local pi package |
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
  pi-llm-council/       Global — multi-model deliberation from runtime model registry
  kanban/               Project — event-sourced task board + TUI overlay
  matrix/               Project — phone ↔ agent bridge via Matrix
  pi-coas/              Project — CoAS status, doctor, workspaces, schedules
lib/                  Shared: agent-api, maildir transport, tool-result helpers
skills/               Agent skills and compact reference guidance
prompts/              Prompt templates (refactor, commit-and-push)
scripts/              Setup and utility scripts
tests/                Tests (vitest + archunit fitness functions)
```

Global extensions (panopticon, pi-llm-council) are installed by `make setup` through this repo's local pi package entry. Project extensions (kanban, matrix, pi-coas) are added per-workspace in `.pi/settings.json`.

## Development

```bash
make help         # list all targets
make check        # typecheck → biome lint → knip → type-coverage (≥95%)
make lint         # run one quality gate
make test         # run tests
make test-watch   # run tests in watch mode
make setup        # register pi package
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENTS.md](AGENTS.md) for coding standards.

## Security

The design assumes a **trusted host**. External input (Matrix messages, agent-to-agent messages) is treated as untrusted and wrapped in structured tags before entering the LLM context. User-facing fields (task titles, agent names, tool names) are validated or sanitised at system boundaries. Matrix deployment assumptions belong in the workspace or infrastructure repo, not here.

## License

[MIT](LICENSE)
