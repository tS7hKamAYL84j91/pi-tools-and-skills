#!/usr/bin/env bash
# Run a natural-language query against a NotebookLM notebook.
# Answers are grounded in uploaded sources with citations.
#
# Usage: nb-query.sh "<notebook-name>" "<question>"
# Example: bash skills/notebooklm/scripts/nb-query.sh "CoAS Research" \
#            "What are the key themes across all reports?"

set -euo pipefail

NOTEBOOK="${1:-}"
QUESTION="${2:-}"

if [[ -z "$NOTEBOOK" || -z "$QUESTION" ]]; then
  echo "Usage: nb-query.sh \"<notebook-name>\" \"<question>\"" >&2
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

notebooklm use "$NOTEBOOK_ID"
notebooklm query "$QUESTION"
