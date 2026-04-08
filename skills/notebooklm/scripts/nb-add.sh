#!/usr/bin/env bash
# Add a file or URL as a source to a NotebookLM notebook.
# Selects the notebook by name before adding the source.
#
# Usage: nb-add.sh "<notebook-name>" "<path-or-url>"
# Example (file):  bash skills/notebooklm/scripts/nb-add.sh "CoAS Research" /path/to/REPORT.md
# Example (URL):   bash skills/notebooklm/scripts/nb-add.sh "CoAS Research" https://example.com/article

set -euo pipefail

NOTEBOOK="${1:-}"
SOURCE="${2:-}"

if [[ -z "$NOTEBOOK" || -z "$SOURCE" ]]; then
  echo "Usage: nb-add.sh \"<notebook-name>\" \"<path-or-url>\"" >&2
  exit 1
fi

# Resolve notebook ID by name and select it
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

echo "Using notebook '$NOTEBOOK' ($NOTEBOOK_ID)" >&2
notebooklm use "$NOTEBOOK_ID"

echo "Adding source: $SOURCE" >&2
notebooklm source add "$SOURCE"
echo "Done." >&2
