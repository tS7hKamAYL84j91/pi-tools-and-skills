# pi-tools-and-skills

Extensions, skills, memories, and setup tooling for [pi](https://github.com/mariozechner/pi-coding-agent) — a local-first coding agent. Adds multi-agent orchestration, kanban task tracking, phone-to-agent messaging (Matrix), machine memories, and reusable skills.

In the current CoAS layout:
- `pi-tools-and-skills` = reusable code
- `coas` = deployment/runtime infra
- `working-notes` = operational workspace, state, and research

## Getting started

### Prerequisites

- [pi](https://github.com/mariozechner/pi-coding-agent) installed and working
- Node.js 22+
- Python 3
- A git workspace at `~/git/` (configurable)
- Secret store for your OS:
  - macOS: Keychain (`security`)
  - Linux: [`pass`](https://www.passwordstore.org/) + `gpg`, with `pass` initialized

### 1. Clone and install

```bash
cd ~/git
git clone https://github.com/tS7hKamAYL84j91/pi-tools-and-skills.git
cd pi-tools-and-skills
npm install
```

### 2. Set up

```bash
make help                     # show all available targets
make setup                    # register extensions, skills, memories with pi
# or:
make setup OPENROUTER=0       # disable OpenRouter setup
make setup OPENROUTER=1       # force-enable OpenRouter setup

exec "$SHELL"                # reload shell to pick up env vars
```

`make setup` now checks OS-specific dependencies before changing anything. On Linux it requires `pass` and `gpg`, and it will fail fast if `pass` is installed but not initialized.

### 3. Run pi

After setup, just run pi normally in any workspace configured to load the project extensions. The default CoAS workspace is `~/git/working-notes`:

```bash
cd ~/git/working-notes && pi
```

Pi loads global extensions (panopticon, machine-memory), skills, and memories. Add kanban/matrix per-project via `.pi/settings.json`. No Docker required — just the local agent.

### 4. Add phone messaging via Matrix (optional)

To message the agent from your phone, use the separate `~/git/coas` infra repo (Matrix homeserver + Tailscale). First run bootstraps everything there:

```bash
cd ~/git/coas
make up BOT_PASSWORD=X PERSONAL_USER=jim PERSONAL_PASSWORD=Y
```

Then run pi in the operational workspace with Matrix secrets resolved:

```bash
cd ~/git/working-notes
make pi
```

`make pi` runs pi with `MATRIX_ACCESS_TOKEN` and `MATRIX_BOT_PASSWORD` loaded from the secret store via `coas/scripts/coas-pi`.

Install [Element X](https://element.io/download) on your phone, sign in to your Tailscale-hosted homeserver, and message the agent. See `~/git/coas/coas-infra/README.md` for deployment details.

---

## What's included

### Extensions

Loaded automatically by pi when configured via `make setup`.

| Extension | Type | What it does |
|-----------|------|-------------|
| **pi-panopticon** | Global | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring, lifecycle management |
| **machine-memory** | Global | `.mmem.yml` cheat sheets — tool/domain knowledge injected into agent context on demand |
| **kanban** | Project | Event-sourced task board — 14 tools, TUI overlay (`/kanban`), auto-compaction, snapshot renderer |
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
| **pi-agent-orchestration** | Spawn, brief, monitor, nudge, and shut down pi worker agents |
| **pi-extension-dev** | Build or modify pi extensions, tools, commands, hooks, and TUI widgets |
| **pi-session-management** | Implement session-aware behavior, persistence, compaction, and reload-safe flows |
| **skill-creator** | Meta-skill for creating and improving skills |

### Memories

Global `.mmem.yml` files providing compact reference knowledge:

- `pi-kanban` — kanban extension patterns and tool usage
- `pi-extension-dev` — compact extension API reminders and gotchas
- `pi-agent-orchestration` — compact agent tool reminders and orchestration gotchas
- `pi-session-management` — compact lifecycle API reminders and session gotchas
- `node-esm-gotchas` — common ESM pitfalls

The three `pi-*` memories above now have matching skills for workflow guidance; the memories remain as compact companion reference.

---

## Commands

Everything goes through `make`:

| Command | What |
|---------|------|
| `make` / `make help` | Show available targets and setup options |
| `make setup` | Register extensions/skills/memories with pi |
| `make setup OPENROUTER=0` | Run setup with OpenRouter disabled |
| `make setup OPENROUTER=1` | Run setup with OpenRouter forced on |
| `make check` | Typecheck + Biome lint + knip + type-coverage (≥95%) |
| `make test` | Run tests |
| `make clean-mailboxes` | Clean stale agent mailboxes |

---

## Structure

```
extensions/           All extensions:
  pi-panopticon/        Global — multi-agent messaging, spawning, health
  machine-memory/       Global — .mmem.yml cheat sheets
  kanban/               Project — event-sourced task board + TUI overlay
  matrix/               Project — phone ↔ agent bridge via Matrix
lib/                  Shared: agent-api, maildir transport, tool-result helpers
skills/               Agent skills (clean-room, deep-research, planning, ...)
memories/             Global .mmem.yml files
prompts/              Prompt templates (refactor, commit-and-push)
scripts/              Setup and utility scripts
tests/                Tests (vitest + archunit fitness functions)
```

Global extensions (panopticon, machine-memory) are registered by `make setup` for every pi session. Project extensions (kanban, matrix) are added per-workspace in `.pi/settings.json`.

## Development

```bash
make help         # list all targets
make check        # typecheck → biome lint → knip → type-coverage (≥95%)
make test         # run tests
make setup        # configure pi extensions, skills, shell hooks (first time)
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENT.md](AGENT.md) for coding standards.

## Security

The design assumes a **trusted host** and **trusted self-hosted Matrix homeserver** behind a private Tailscale mesh. External input (Matrix messages, agent-to-agent messages) is treated as untrusted and wrapped in structured tags before entering the LLM context. User-facing fields (task titles, agent names, tool names) are validated or sanitised at system boundaries. Findings that require host-level compromise are accepted risks — at that point the attacker already has full file access.

## License

[MIT](LICENSE)
