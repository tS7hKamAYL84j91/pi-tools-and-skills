# Pi Cheatsheets Extension

A pi extension that auto-injects compact `.mmem.yml` cheat sheets into agent context. 60–80% token reduction vs raw documentation.

## What It Does

On every session start, the extension:

1. **Discovers** `.mmem.yml` files from settings paths, global, and project locations
2. **Injects** them into the system prompt via `before_agent_start`
3. **Shows** a TUI widget and status bar with loaded cheatsheets and token usage
4. **Validates** format on creation to enforce the spec

## Discovery Order

Later sources override earlier for the same tool name:

| Priority | Location | Source label | Description |
|----------|----------|-------------|-------------|
| 1 (lowest) | `~/.mmem/` | `deprecated-global` | Legacy global (backward compat) |
| 2 | `.mmem/` | `deprecated-project` | Legacy project-local (backward compat) |
| 3 | settings.json `"memories"` paths | `settings` | Shared, committed, from a repo |
| 4 | `~/.pi/agent/memories/` | `global` | User-global pi cheatsheets |
| 5 (highest) | `.pi/memories/` | `project` | Project-local override |

### Setup

Add your cheatsheets directory to `~/.pi/agent/settings.json`:

```json
{
  "skills": ["/path/to/tools-and-skills/skills"],
  "extensions": ["/path/to/tools-and-skills/extensions"],
  "prompts": ["/path/to/tools-and-skills/prompts"],
  "memories": ["/path/to/tools-and-skills/memories"]
}
```

This follows the same pattern as skills, extensions, and prompts — cheatsheets live in the repo, are committed and versioned, and travel with it.

For per-user overrides: `~/.pi/agent/memories/`
For per-project overrides: `.pi/memories/`

## Tools

| Tool | Description |
|------|-------------|
| `mmem_create` | Scaffold a new `.mmem.yml` — skeleton or full content |
| `mmem_list` | List all discovered cheatsheets with metadata and validation |
| `mmem_inject` | Inject specific cheatsheets into context on demand |
| `mmem_update` | Append learned gotchas/patterns to an existing cheatsheet |
| `mmem_validate` | Validate a `.mmem.yml` against the format spec |

## Commands

| Command | Description |
|---------|-------------|
| `/mmem-reload` | Re-scan and reload cheatsheet files |
| `/mmem-stats` | Show cheatsheet file statistics |

## TUI

- **Widget**: Shows loaded cheatsheets with source (📦 settings / 🌐 global / 📁 project / ⚠️ deprecated) and confidence (✓/~/?)
- **Status bar**: `🧠 N cheatsheets (~X tokens)`

## File Format

`.mmem.yml` = YAML frontmatter + Markdown body (tldr-style, example-first):

```yaml
---
tool: git
version: ">=2.30"
updated: 2026-04-08
category: version-control
tags: [git, commits, branches]
confidence: high
---

# git — Distributed version control

> Track, branch, merge, and sync code.

## Common operations

- Clone a repository:
  `git clone {{url}} [{{dest-dir}}]`

## Patterns

- Safe force push:
  `git push --force-with-lease origin {{branch}}`

## Gotchas

- `--force` overwrites others' work; always prefer `--force-with-lease`
```

Target: **200–500 tokens per file**. See `skills/pi-cheatsheets/references/format.md` for the full spec.

## Directory Layout

```
/path/to/pi-tools-and-skills/
  memories/                    ← Shared cheatsheets (in settings.json "memories" path)
    pi-kanban.mmem.yml
    ollama.mmem.yml
    ...
  extensions/pi-cheatsheets/   ← This extension
    index.ts
    memory-store.ts

~/.pi/agent/
  memories/                    ← User-global cheatsheet overrides
  settings.json                ← "memories": ["/path/to/memories"]

<any-project>/.pi/
  memories/                    ← Project-local cheatsheet overrides (highest priority)
```

## File Layout

```
extensions/pi-cheatsheets/
  types.ts          Shared interfaces and constants
  parse.ts          YAML frontmatter parser
  discover.ts       Path helpers, settings.json reader, file discovery
  validate.ts       Format spec validation (8 rules)
  format.ts         Index and injection formatters, token estimation
  write.ts          Skeleton generation, file writing, update appending
  overlay.ts        TUI overlay component for /mmem
  index.ts          Extension entry — lifecycle, tools, commands
  README.md         This file
```
