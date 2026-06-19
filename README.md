# pi-tools-and-skills

![pi-panopticon](docs/images/pi-panopticon.png)

Reusable extensions, skills, prompts, and shared libraries for [pi](https://github.com/mariozechner/pi-coding-agent), a local-first coding agent.

This repository provides reusable operator tooling for a personal Chief of Staff setup: extension packages, agent skills, prompt templates, and shared TypeScript utilities.

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

The package manifest exposes `extensions/`, `skills/`, and `prompts/` to pi. `make setup` registers this checkout as a local pi package with a global extension filter for `pi-panopticon` and `pi-goal`. `make setup-package PACKAGE=<name>` registers one user-installable extension package globally (`pi-goal`, `pi-matrix`, `pi-ollama-models`, or `pi-panopticon`). It does not alter runtime/project settings. `pi-research-tools` is now canonical in `/home/jim/git/pi-extension-poc`.

### 2. Set up

```bash
make help                            # show targets
make setup                           # register extensions, skills, prompts
make setup-package PACKAGE=pi-matrix # register one user-installable package globally
```

### 3. Run pi

After setup, run pi normally in any workspace:

```bash
pi
```

Add project-only extensions such as `pi-kanban` or `pi-coas` per workspace via that workspace's `.pi/settings.json`; they are intentionally rejected by global individual package setup.

---

## What's included

### Extensions

`make setup` globally enables reusable operator extensions. Project/runtime extensions stay opt-in per workspace.

| Extension             | Type         | What it does                                                                                            |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| **pi-panopticon**     | Global       | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring, lifecycle management, and modular team workflows (`team_run`) |
| **pi-goal**           | Global       | Bounded `/goal` workflow with project-local state, progress, stop/resume, and completion audit tools    |
| **pi-matrix**         | User/Project | Phone ↔ agent bridge via Matrix — notification + inbox pattern, `message_read` / `message_send` tools   |
| **pi-kanban**         | Project      | Event-sourced task board — tools, TUI overlay (`/kanban`), auto-compaction, snapshot renderer           |
| **pi-file-watch**     | Project      | Explicit file watcher that wakes the active session with bounded redacted updates                       |
| **pi-ollama-models**  | User         | Auto-sync local Ollama models into pi's models.json on session start/reload                              |
| **pi-coas**           | Project      | CoAS status, doctor, workspace, and schedule control surface                                            |

### Skills

Reusable skills for pi-platform tooling and compact reference guidance. Extension-specific skills are bundled with their extension package so independent `pi install ./extensions/<name>` installs include the matching guidance. Broader operator and methodology skills that are not specific to this repo live in [CoAS](https://github.com/tS7hKamAYL84j91/coas).

| Skill                      | Bundle        | Purpose                                                                           |
| -------------------------- | ------------- | --------------------------------------------------------------------------------- |
| **node-esm-gotchas**       | shared        | Avoid common Node.js ESM and TypeScript module-resolution mistakes                |
| **pi-agent-orchestration** | pi-panopticon | Spawn, brief, monitor, message, and shut down pi worker agents                    |
| **pi-extension-dev**       | shared        | Build or modify pi extensions, tools, commands, hooks, and TUI widgets            |
| **pi-model-selection**     | shared        | Verify pi-visible models and route work to the right provider/model               |
| **pi-session-management**  | shared        | Implement session-aware behavior, persistence, compaction, and reload-safe flows  |
| **pi-team-consultation**   | pi-panopticon teams | Route review and decisions through `navigator` or `llm-council` teams        |
| **skill-creator**          | shared        | Meta-skill for creating and improving skills                                      |

---

## Commands

Everything goes through `make`:

| Command                                                             | What                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `make` / `make help`                                                | Show available targets                                                                          |
| `make setup`                                                        | Install this checkout as a local pi package                                                     |
| `make setup-package PACKAGE=<name>`                                 | Install one user package (`pi-goal`, `pi-matrix`, `pi-ollama-models`, `pi-panopticon`) |
| `make setup-clean`                                                  | Remove this checkout's pi package registration                                                  |
| `make setup-package-clean PACKAGE=<name>`                           | Remove one user package registration                                                            |
| `make doctor`                                                       | Run checks, tests, and gitleaks secret scans                                                    |
| `make check`                                                        | Typecheck + Biome lint + knip + type-coverage (≥95%)                                            |
| `make typecheck` / `make lint` / `make knip` / `make type-coverage` | Run one quality gate                                                                            |
| `make secret-scan`                                                  | Scan git history and working tree with gitleaks                                                 |
| `make test`                                                         | Run tests                                                                                       |
| `make test-watch`                                                   | Run tests in watch mode                                                                         |
| `make clean-mailboxes`                                              | Clean stale agent mailboxes                                                                     |
| `make clean-mailboxes DRY_RUN=1`                                    | Preview stale mailbox cleanup                                                                   |

---

## Structure

```text
extensions/           Extensions:
  pi-panopticon/        Global — multi-agent messaging, spawning, health, teams
  pi-goal/              Global — bounded /goal workflow and completion audit
  pi-kanban/           Project — event-sourced task board + TUI overlay
  pi-matrix/           Project — phone ↔ agent bridge via Matrix
  pi-file-watch/        Project — explicit non-recursive file watch
  pi-ollama-models/     User — auto-sync local Ollama models into models.json
  pi-coas/              Project — CoAS status, doctor, workspaces, schedules
lib/                  Shared: agent-api, maildir transport, tool-result helpers
skills/               Shared agent skills and compact reference guidance
prompts/              Prompt templates (refactor, commit-and-push)
scripts/              Setup and utility scripts
tests/                Tests (vitest + archunit fitness functions)
```

Global extensions (`pi-panopticon`, `pi-goal`) are installed by `make setup` through this repo's local pi package entry. User/project extension `pi-matrix` and user extension `pi-ollama-models` can be installed individually. Project extensions (`pi-kanban`, `pi-file-watch`, `pi-coas`) are added per workspace in `.pi/settings.json`. Research tools live in `/home/jim/git/pi-extension-poc/extensions/pi-research-tools/`.

## Development

```bash
make help         # list all targets
make doctor       # check + test + gitleaks secret scans
make check        # typecheck → biome lint → knip → type-coverage (≥95%)
make lint         # run one quality gate
make test         # run tests
make test-watch   # run tests in watch mode
make secret-scan  # scan git history and working tree with gitleaks
make setup        # register pi package
make setup-clean  # remove pi package registration
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENTS.md](AGENTS.md) for coding standards.

## Security

The design assumes a **trusted host**. External input (Matrix messages, agent-to-agent messages) is treated as untrusted and wrapped in structured tags before entering the LLM context. User-facing fields (task titles, agent names, tool names) are validated or sanitised at system boundaries. Matrix deployment assumptions belong in the workspace or infrastructure repo, not here.

## License

[MIT](LICENSE)
