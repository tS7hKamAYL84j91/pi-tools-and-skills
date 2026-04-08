---
name: machine-memory
description: Create and inject compact YAML cheat sheets (.mmem.yml) for tools and domains. Use when agents need efficient tool grounding at session start (60-80% token reduction vs full docs), when building reusable tool memory libraries, or when capturing learnings from past sessions. Covers creation, injection, and update workflows. Triggers on phrases like "machine memory", "agent cheat sheet", "inject tool context", "grounding memory", or ".mmem".
---

# Machine Memory

Compact, injectable agent cheat sheets. Each `.mmem.yml` captures a tool's key commands, patterns, and gotchas in 200–500 tokens — vs 5,000–50,000 for full documentation.

## Why This Exists

Agents forget. Every new context window is amnesia. Machine memory files are the **external memory layer** — they survive between sessions and inject only what's needed:

| Layer | What | Persistence |
|-------|------|-------------|
| Parametric | Model weights | Baked at training; never changes at runtime |
| **External** | **`.mmem.yml` files** | **This skill — retrieved per session** |
| Episodic | Session summaries | Written at session end |
| In-context | Active window | Lost when session ends |

60–80% token reduction vs injecting raw documentation. Structure beats compression.

## Setup

```bash
mkdir -p ~/.mmem
export MMEM_DIR="$HOME/.mmem"   # Add to ~/.bashrc or ~/.zshrc

# Optional: add scripts to PATH
export PATH="$PATH:/path/to/skills/machine-memory/scripts"
```

## Creating Memory Files

Copy the template and fill in manually, or let the script scaffold it:

```bash
# Copy blank template
cp skills/machine-memory/assets/template.mmem.yml ~/.mmem/mytool.mmem.yml

# Auto-scaffold skeleton from --help output
skills/machine-memory/scripts/create-memory.sh git

# Auto-scaffold + LLM enrichment (requires `llm` CLI: pip install llm)
skills/machine-memory/scripts/create-memory.sh git --enrich

# Write to a custom location
skills/machine-memory/scripts/create-memory.sh docker --output .mmem/docker.mmem.yml
```

The skeleton includes the tool's `--help` text as commented-out source. Fill in the `TODO` fields, then delete the source comments.

## Injecting at Session Start

```bash
# Inject specific tools
skills/machine-memory/scripts/inject-memory.sh git docker

# Inject all tools in ~/.mmem/
skills/machine-memory/scripts/inject-memory.sh --all

# Inject project-local memories from ./.mmem/
skills/machine-memory/scripts/inject-memory.sh --project

# Combine: project memories + specific global tools
skills/machine-memory/scripts/inject-memory.sh --project git python
```

**In a pi workflow**, prepend the output to the system prompt or first user message:

```bash
MEMORY=$(skills/machine-memory/scripts/inject-memory.sh git docker terraform)
# Include $MEMORY in agent system prompt or as context prefix
```

**Mid-session** — if an agent hits an unfamiliar tool, inject on demand:

```bash
CONTEXT=$(skills/machine-memory/scripts/inject-memory.sh kubectl)
# Append $CONTEXT to the running conversation
```

## Updating from Experience

After a session, analyze the log to discover new gotchas and patterns:

```bash
# Dry run — show suggestions only
skills/machine-memory/scripts/update-memory.sh session.log

# Target a specific tool
skills/machine-memory/scripts/update-memory.sh session.log --tool git

# Auto-append suggestions to the tool's .mmem.yml
skills/machine-memory/scripts/update-memory.sh session.log --tool git --auto
```

With `llm` CLI installed, the script uses an LLM to extract structured gotchas and patterns. Without it, it surfaces raw error lines and command snippets for manual review.

## File Format

`.mmem.yml` = YAML frontmatter + Markdown body (tldr-style, example-first):

```yaml
---
tool: git
version: ">=2.30"
updated: 2026-04-08
category: version-control
tags: [git, commits, branches, rebase]
confidence: high
---

# git — Distributed version control

> Track, branch, merge, and sync code across repositories.

## Common operations

- Clone a repository:
  `git clone {{url}} [{{dest-dir}}]`

- Stage all changes and commit:
  `git add -A && git commit -m "{{message}}"`

- Create and switch to a branch:
  `git switch -c {{branch-name}}`

## Patterns

- Safe force push after rebase:
  `git push --force-with-lease origin {{branch}}`

- Interactive rebase to squash last N commits:
  `git rebase -i HEAD~{{N}}`

## Gotchas
- `--force` overwrites others' work; always prefer `--force-with-lease`
- Never rebase commits already pushed to a shared branch
- `git stash` includes untracked files only with `-u`
```

See `references/format.md` for the complete field schema and validation rules.

## Directory Conventions

```
~/.mmem/                          # Global tool memories (user-wide)
  git.mmem.yml
  docker.mmem.yml
  terraform.mmem.yml

.mmem/                            # Project-local memories (in repo root, commit these)
  architecture.mmem.yml
  conventions.mmem.yml
  known-issues.mmem.yml
```

Project `.mmem/` takes precedence over `~/.mmem/` when both exist for the same name.  
Commit `.mmem/` directories into project repos — they are team-shared knowledge.

## Token Budget Guide

With a 16K context, the recommended ~2,000-token memory allocation:

| Memory Type | Tokens | Source |
|---|---|---|
| Project conventions | ~400 | `.mmem/conventions.mmem.yml` |
| Relevant tools (top 2) | ~600 | `~/.mmem/{tool}.mmem.yml` |
| Recent episode summary | ~400 | Last session episodic note |
| Known issues | ~200 | `.mmem/known-issues.mmem.yml` |
| On-demand (dynamic) | ~400 | Retrieved mid-session as needed |

## Included Examples

Ready-to-use `.mmem.yml` files in `assets/examples/`:

| File | Coverage |
|---|---|
| `git.mmem.yml` | Clone, commit, branch, rebase, stash, reset |
| `docker.mmem.yml` | Build, run, ps, exec, logs, compose |
| `python-debug.mmem.yml` | pdb, logging, traceback, venv, pip |

Copy to `~/.mmem/` or use as reference when writing new files.

## Writing Discipline

The key insight: **agents write `.mmem.yml` files, not just read them**. After every session:

1. What did I learn that I didn't know before?
2. What commands did I use more than once?
3. What failed and why — and how would I avoid it next time?

These become new `.mmem.yml` entries or amendments to existing ones. Memory grows with experience.

## References

- `references/format.md` — Complete field schema, validation rules, and retrieval design
- `assets/template.mmem.yml` — Blank template to copy
- `assets/examples/` — Ready-to-use examples
- `scripts/create-memory.sh` — Scaffold a new `.mmem.yml` from tool help text
- `scripts/inject-memory.sh` — Output memory files for context injection
- `scripts/update-memory.sh` — Analyze session logs and suggest updates
