---
name: notebooklm
description: Manage NotebookLM notebooks from the command line or from agent workflows. Create notebooks, upload sources (Markdown files or URLs), list notebooks and sources, run natural-language queries, and generate Audio Overview podcasts. Backed by notebooklm-py (unofficial Python client).
---

# NotebookLM Skill

Thin shell wrappers around the `notebooklm` CLI that give agents first-class access to NotebookLM: source ingestion, cross-report Q&A, and podcast generation.

All scripts live in `skills/notebooklm/scripts/` — run them with `bash`.

---

## Prerequisites

```bash
# 1. Install the Python client (requires Python ≥ 3.10)
pip install "notebooklm-py[browser]"

# 2. Install the Chromium browser used for auth
playwright install chromium

# 3. One-time login — opens a browser window for Google OAuth
notebooklm login
# Session is saved to ~/.notebooklm/storage_state.json
# Export this file as NOTEBOOKLM_AUTH_JSON for headless / CI use.
```

> ⚠️ `notebooklm-py` uses reverse-engineered Google endpoints. Pin the version you test against (`pip install "notebooklm-py[browser]==0.3.4"`) and re-test after upgrades.

---

## Scripts

### 1. Create a notebook — `nb-create.sh`

```bash
bash skills/notebooklm/scripts/nb-create.sh "<notebook-name>"
```

Prints the new notebook's ID to stdout.

```bash
bash skills/notebooklm/scripts/nb-create.sh "CoAS Research"
# → Created notebook: CoAS Research (id: abc123)
```

---

### 2. Add a source — `nb-add.sh`

Add a Markdown file **or** URL to an existing notebook. Resolves the notebook by name automatically.

```bash
bash skills/notebooklm/scripts/nb-add.sh "<notebook-name>" "<path-or-url>"
```

```bash
# Markdown file
bash skills/notebooklm/scripts/nb-add.sh "CoAS Research" \
  ~/git/working-notes/research/agent-topologies/REPORT.md

# Web URL
bash skills/notebooklm/scripts/nb-add.sh "CoAS Research" \
  https://arxiv.org/abs/2512.08296
```

---

### 3. List notebooks — `nb-list.sh`

```bash
bash skills/notebooklm/scripts/nb-list.sh          # human-readable table
bash skills/notebooklm/scripts/nb-list.sh --json   # JSON array
```

Output columns: ID, title, source count, last modified.

---

### 4. List sources — `nb-sources.sh`

List all sources in a specific notebook.

```bash
bash skills/notebooklm/scripts/nb-sources.sh "<notebook-name>"
bash skills/notebooklm/scripts/nb-sources.sh "<notebook-name>" --json
```

```bash
bash skills/notebooklm/scripts/nb-sources.sh "CoAS Research"
# → 12 source(s):
#     agent-topologies/REPORT.md  (text/markdown, 48 KB)
#     notebooklm-integration/REPORT.md  (text/markdown, 22 KB)
#     ...
```

---

### 5. Generate Audio Overview — `nb-audio.sh`

Trigger podcast generation, poll until ready, and download the MP3.

```bash
bash skills/notebooklm/scripts/nb-audio.sh "<notebook-name>" [instructions] [output-file]
```

```bash
# Basic — default instructions, saves to audio-overview.mp3
bash skills/notebooklm/scripts/nb-audio.sh "CoAS Research"

# Custom focus and output path
bash skills/notebooklm/scripts/nb-audio.sh "CoAS Research" \
  "Focus on cross-cutting patterns and common failure modes" \
  ~/research/podcasts/coas-2026-04.mp3
```

The script polls `notebooklm audio status` every 10 seconds and exits once the status is `complete`/`ready`/`done`.

---

### 6. Query a notebook — `nb-query.sh`

Ask a natural-language question; answers are grounded in uploaded sources with citations.

```bash
bash skills/notebooklm/scripts/nb-query.sh "<notebook-name>" "<question>"
```

```bash
bash skills/notebooklm/scripts/nb-query.sh "CoAS Research" \
  "What are the key themes across all reports?"

bash skills/notebooklm/scripts/nb-query.sh "CoAS Research" \
  "Which research areas have the most open questions?"
```

---

### 7. Bulk-add REPORT.md files — `nb-bulk-add.sh`

Recursively find all `REPORT.md` files under a directory and add them as sources. Adds a 1-second delay between uploads to respect rate limits.

```bash
bash skills/notebooklm/scripts/nb-bulk-add.sh "<notebook-name>" "<directory>" \
  [--filename <glob-pattern>]
```

```bash
# Add all REPORT.md files from the research directory
bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" \
  ~/git/working-notes/research/

# Add all *.md files from a docs directory
bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" \
  ~/docs/ --filename "*.md"
```

> ⚠️ NotebookLM has a **100-source-per-notebook limit**. For large corpora, split into domain notebooks (e.g. "CoAS — Networking", "CoAS — AI Agents", "CoAS — Security").

---

## Common Workflows

### Ingest all research reports

```bash
# 1. Create the notebook
bash skills/notebooklm/scripts/nb-create.sh "CoAS Research"

# 2. Bulk-add all REPORT.md files
bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" \
  ~/git/working-notes/research/

# 3. Confirm sources were added
bash skills/notebooklm/scripts/nb-sources.sh "CoAS Research"
```

### Generate a podcast from a corpus

```bash
bash skills/notebooklm/scripts/nb-audio.sh "CoAS Research" \
  "Highlight key insights and common failure modes across all reports" \
  ~/research/podcasts/coas-$(date +%Y-%m).mp3
```

### Cross-report Q&A

```bash
bash skills/notebooklm/scripts/nb-query.sh "CoAS Research" \
  "What are the most common recommendations across all networking reports?"

bash skills/notebooklm/scripts/nb-query.sh "CoAS Research" \
  "Which topics appear in multiple reports but have no clear resolution?"
```

### Add a single new report

```bash
bash skills/notebooklm/scripts/nb-add.sh "CoAS Research" \
  ~/git/working-notes/research/new-topic/REPORT.md
```

### Headless / CI use

```bash
# Export your session after first login
export NOTEBOOKLM_AUTH_JSON="$(cat ~/.notebooklm/storage_state.json)"

# All scripts work headlessly once NOTEBOOKLM_AUTH_JSON is set
bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" ./research/
```

---

## Rate Limits & Constraints

| Constraint | Detail |
|---|---|
| Sources per notebook | 100 max |
| Upload rate | ~1 req/sec recommended (`nb-bulk-add.sh` enforces this) |
| Auth expiry | Session can expire — re-run `notebooklm login` if you get 401 errors |
| API stability | Unofficial — pin to a specific PyPI version |
| Audio generation time | 2–10 minutes depending on corpus size |

---

## Troubleshooting

**`notebooklm: command not found`** — ensure `pip install "notebooklm-py[browser]"` completed and your virtualenv/PATH is active.

**Notebook name not found** — names are matched exactly (case-sensitive). Run `nb-list.sh` to see exact titles.

**Auth errors** — re-run `notebooklm login` to refresh the session.

**Audio stuck on "generating"** — generation can take 5–10 minutes for large notebooks. `nb-audio.sh` polls every 10 seconds with no timeout; interrupt with Ctrl-C if needed.

**`mapfile` not found** — scripts require bash ≥ 4. macOS ships bash 3; install via `brew install bash` and invoke with `/opt/homebrew/bin/bash` if needed.
