#!/usr/bin/env bash
# Bulk-add all REPORT.md files found under a directory tree to a NotebookLM notebook.
# Adds a 1-second delay between uploads to respect rate limits.
# Skips files that are empty or unreadable.
#
# Usage: nb-bulk-add.sh "<notebook-name>" "<directory>" [--filename <pattern>]
# Default pattern: REPORT.md
#
# Example:
#   bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" "$RESEARCH_DIR"
#   bash skills/notebooklm/scripts/nb-bulk-add.sh "CoAS Research" ~/docs/ --filename "*.md"

set -euo pipefail

NOTEBOOK="${1:-}"
DIR="${2:-}"
FILENAME="REPORT.md"

# Parse optional --filename flag
shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --filename) FILENAME="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$NOTEBOOK" || -z "$DIR" ]]; then
  echo "Usage: nb-bulk-add.sh \"<notebook-name>\" \"<directory>\" [--filename <pattern>]" >&2
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "Error: directory '$DIR' does not exist." >&2
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
  echo "Error: notebook '$NOTEBOOK' not found. Create it first with nb-create.sh." >&2
  exit 1
fi

echo "Using notebook '$NOTEBOOK' ($NOTEBOOK_ID)" >&2
notebooklm use "$NOTEBOOK_ID"

# Find all matching files
mapfile -t FILES < <(find "$DIR" -type f -name "$FILENAME" | sort)

TOTAL=${#FILES[@]}
if [[ $TOTAL -eq 0 ]]; then
  echo "No files matching '$FILENAME' found under $DIR" >&2
  exit 0
fi

echo "Found $TOTAL file(s) to upload." >&2
ADDED=0
SKIPPED=0

for FILE in "${FILES[@]}"; do
  # Skip empty files
  if [[ ! -s "$FILE" ]]; then
    echo "  [skip] $FILE (empty)" >&2
    (( SKIPPED++ )) || true
    continue
  fi

  echo "  [${ADDED}/${TOTAL}] Adding: $FILE" >&2
  if notebooklm source add "$FILE"; then
    (( ADDED++ )) || true
  else
    echo "  [warn] Failed to add: $FILE" >&2
    (( SKIPPED++ )) || true
  fi

  # Rate-limit: 1 second between uploads
  sleep 1
done

echo "" >&2
echo "Done. Added $ADDED source(s), skipped $SKIPPED." >&2
