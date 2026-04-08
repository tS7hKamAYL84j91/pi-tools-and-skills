# .mmem.yml Format Specification

Complete field schema, validation rules, body conventions, and retrieval design for Machine Memory files.

---

## Overview

A `.mmem.yml` file is a **YAML front matter + Markdown body** document.  
It captures a tool's key commands, patterns, and gotchas in **200–500 tokens** — versus 5,000–50,000 for raw documentation.

File naming convention: `{tool-name}.mmem.yml`  
(e.g. `git.mmem.yml`, `docker.mmem.yml`, `python-debug.mmem.yml`)

---

## Front Matter Schema

```yaml
---
tool: git
version: ">=2.30"
updated: 2026-04-08
category: version-control
tags: [git, commits, branches, rebase]
confidence: high
---
```

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `tool` | string | ✅ | Primary tool, command, or system name (kebab-case if compound) |
| `version` | string | ✅ | Minimum version tested (`">=X.Y"`), or `"any"` if version-agnostic |
| `updated` | date | ✅ | ISO 8601 date (`YYYY-MM-DD`) — used as staleness signal in retrieval scoring |
| `category` | string | ✅ | Domain taxonomy — see [Category Values](#category-values) below |
| `tags` | list | ✅ | Retrieval keywords; include synonyms and subcommands agents might query |
| `confidence` | enum | ✅ | Provenance quality — `high`, `medium`, or `low` |

### Confidence Levels

| Value | Meaning |
|---|---|
| `high` | Verified against real use; commands confirmed to work |
| `medium` | Plausible but not exhaustively tested; may have edge cases |
| `low` | AI-generated or transcribed without verification; treat as draft |

### Category Values

Common values (extend as needed):

| Category | Example tools |
|---|---|
| `version-control` | git, svn, mercurial |
| `containers` | docker, podman, kubectl, helm |
| `cloud` | aws-cli, gcloud, az |
| `language` | python, node, ruby, rust |
| `build` | make, cmake, gradle, cargo |
| `networking` | curl, ssh, nmap, dig |
| `filesystem` | find, rsync, tar, rclone |
| `monitoring` | grep, jq, htop, strace |
| `database` | psql, mysql, sqlite3, redis-cli |
| `ai-tools` | llm, ollama, pi, aider |
| `project` | Project-specific conventions and architecture |

---

## Body Conventions

The body is Markdown, following the **tldr-style, example-first** discipline.

### Section Structure

```markdown
# {tool} — {one-line purpose}

> {What it does in ≤20 words.}

## Common operations

- {Intent / task description}:
  `{command with {{placeholders}}}`

## Patterns

- {Multi-step workflow or compound command}:
  `{step1} && {step2}`

## Gotchas

- {Common mistake or failure mode — and how to avoid it}

## Examples

- {End-to-end realistic scenario}:
  `{command}`
```

### H2 Section Headings (Required / Optional)

| Section | Required | Purpose |
|---|---|---|
| `## Common operations` | ✅ | Atomic commands, one operation per bullet |
| `## Patterns` | recommended | Compound workflows, pipelines, flag combos |
| `## Gotchas` | ✅ | Failure modes, dangerous defaults, surprises |
| `## Examples` | recommended | End-to-end scenarios (more context than "operations") |
| `## Configuration` | optional | Key config files, env vars, setup steps |
| `## See also` | optional | Related tools or .mmem.yml files |

### Bullet Format

```markdown
- {Intent phrasing — what you want to do}:
  `{command {{placeholder}} --flag}`
```

- **Intent first** — "Create a gzip archive:" not "-czf flag:"
- **Backtick-wrapped** — every command on its own line in backticks
- **`{{placeholder}}`** — substitution points use double-brace notation (tldr convention)
- **One operation per bullet** — do not combine two distinct commands in one bullet

### Placeholder Convention

| Pattern | Meaning |
|---|---|
| `{{path/to/file}}` | A file path the agent must supply |
| `{{branch-name}}` | A named value to substitute |
| `{{N}}` | A number |
| `[{{optional}}]` | Optional argument |
| `{{value1\|value2}}` | Mutually exclusive options |

### H1 and Blockquote

```markdown
# git — Distributed version control

> Track, branch, merge, and sync code across repositories.
```

- **H1**: `# {tool} — {one-line purpose}` — always use an em dash (`—`)
- **Blockquote**: ≤20 words; the "elevator pitch" for the tool

---

## Token Budget

Target: **200–500 tokens per file** (roughly 150–400 words).

| Section | Suggested token budget |
|---|---|
| Front matter | 30–50 |
| H1 + blockquote | 15–25 |
| Common operations (4–8 bullets) | 80–150 |
| Patterns (2–4 bullets) | 40–80 |
| Gotchas (2–5 bullets) | 40–100 |
| Examples (1–3 bullets) | 30–80 |
| **Total** | **235–485** |

If a file exceeds 500 tokens, split it into two files by subcommand (e.g. `git-rebase.mmem.yml`, `git-stash.mmem.yml`).

---

## Retrieval Design

### Search Order

When resolving a tool name, project-local takes precedence over global:

```
1. ./.mmem/{name}.mmem.yml   (project-local, checked in)
2. ~/.mmem/{name}.mmem.yml   (user-global, personal)
```

### Injection Format

`inject-memory.sh` wraps each file with an HTML comment separator:

```
<!-- mmem: .mmem/conventions.mmem.yml -->
{file content}

<!-- mmem: ~/.mmem/git.mmem.yml -->
{file content}
```

This lets agents and humans identify the source of each injected block.

### Retrieval Scoring (Advanced)

For RAG-based retrieval (BM25 + semantic hybrid), scoring can combine:

```
score = α·bm25(query, tags+body)
      + β·semantic_similarity(query, body)
      + γ·recency_score(updated)
      + δ·confidence_weight(confidence)
```

Where:
- `recency_score` decays with days since `updated` (penalise stale files)
- `confidence_weight`: `high=1.0`, `medium=0.7`, `low=0.4`
- Recommended retrieval budget: **top-3 files per query**

### SQLite FTS5 Index (Local, Zero-Dependencies)

For local use without a vector store, index with SQLite FTS5:

```python
import sqlite3, pathlib, yaml

conn = sqlite3.connect("~/.mmem/index.db")
conn.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS mcs
    USING fts5(tool, tags, body)
""")

for f in pathlib.Path("~/.mmem").glob("*.mmem.yml"):
    text = f.read_text()
    parts = text.split("---", 2)
    meta = yaml.safe_load(parts[1])
    body = parts[2].strip()
    conn.execute("INSERT INTO mcs VALUES (?,?,?)",
                 (meta["tool"], " ".join(meta.get("tags",[])), body))

# Query
rows = conn.execute(
    "SELECT tool, body FROM mcs WHERE mcs MATCH ? ORDER BY rank LIMIT 3",
    ("squash commits git",)
).fetchall()
```

---

## Validation Rules

A valid `.mmem.yml` file MUST:

1. ✅ Start with `---` (YAML front matter delimiter)
2. ✅ Include all required front matter fields: `tool`, `version`, `updated`, `category`, `tags`, `confidence`
3. ✅ Have `updated` in `YYYY-MM-DD` format
4. ✅ Have `confidence` value of `high`, `medium`, or `low`
5. ✅ Have `tags` as a YAML list (not a string)
6. ✅ Include `## Common operations` and `## Gotchas` sections in the body
7. ✅ Have every command in backticks
8. ✅ Stay under 500 tokens (recommended; split if exceeded)

A valid file SHOULD:

- Use `{{placeholder}}` notation for substitution points
- Start operations with intent phrasing ("Create …", "List …", "Delete …")
- Include at least 2 gotchas
- Be updated within the last 12 months (stale otherwise)

---

## Complete Example

```yaml
---
tool: git
version: ">=2.30"
updated: 2026-04-08
category: version-control
tags: [git, commits, branches, rebase, stash, reset]
confidence: high
---

# git — Distributed version control

> Track, branch, merge, and sync code across repositories.

## Common operations

- Clone a repository:
  `git clone {{url}} [{{dest-dir}}]`

- Stage all changes and commit:
  `git add -A && git commit -m "{{message}}"`

- Create and switch to a new branch:
  `git switch -c {{branch-name}}`

- Push current branch to origin:
  `git push -u origin {{branch-name}}`

## Patterns

- Safe force-push after rebase:
  `git push --force-with-lease origin {{branch}}`

- Interactive rebase to squash last N commits:
  `git rebase -i HEAD~{{N}}`

- Stash including untracked files:
  `git stash push -u -m "{{description}}"`

## Gotchas

- `--force` overwrites others' work; always prefer `--force-with-lease`
- Never rebase commits already pushed to a shared branch
- `git stash` excludes untracked files unless you add `-u`
- `git reset --hard` is irreversible — check `git stash` first

## Examples

- Undo the last commit but keep changes staged:
  `git reset --soft HEAD~1`

- Apply only specific files from a stash:
  `git checkout stash@{0} -- {{path/to/file}}`
```

---

## See Also

- `assets/template.mmem.yml` — Blank template to copy
- `assets/examples/` — Ready-to-use example files
- `scripts/create-memory.sh` — Scaffold from `--help` output
- `scripts/inject-memory.sh` — Output files for context injection
- `scripts/update-memory.sh` — Analyse session logs and suggest updates
