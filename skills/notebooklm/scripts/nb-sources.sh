#!/usr/bin/env bash
# List all sources in a NotebookLM notebook.
# Usage: nb-sources.sh "<notebook-name>" [--json]
# Example: bash skills/notebooklm/scripts/nb-sources.sh "Research Notebook"

set -euo pipefail

NOTEBOOK="${1:-}"
if [[ -z "$NOTEBOOK" ]]; then
  echo "Usage: nb-sources.sh \"<notebook-name>\" [--json]" >&2
  exit 1
fi

# Resolve notebook ID by name
NOTEBOOK_ID=$(notebooklm list --json 2>/dev/null \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
name = sys.argv[1]
matches = [nb for nb in data if nb.get('title','').strip() == name]
if not matches:
    print('', end='')
else:
    print(matches[0]['id'], end='')
" "$NOTEBOOK")

if [[ -z "$NOTEBOOK_ID" ]]; then
  echo "Error: notebook '$NOTEBOOK' not found. Run nb-list.sh to see available notebooks." >&2
  exit 1
fi

echo "Sources in '$NOTEBOOK' ($NOTEBOOK_ID):" >&2
notebooklm use "$NOTEBOOK_ID"

if [[ "${2:-}" == "--json" ]]; then
  notebooklm source list --json
else
  notebooklm source list
fi
