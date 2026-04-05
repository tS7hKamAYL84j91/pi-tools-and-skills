#!/usr/bin/env bash
# Clean up stale agent mailboxes in ~/.pi/agents/
# Removes directories, .json, and .sock files whose PID is no longer running.
# Usage: clean-mailboxes.sh [--dry-run]

set -euo pipefail

AGENTS_DIR="${HOME}/.pi/agents"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN — no files will be removed ==="
  echo
fi

if [[ ! -d "$AGENTS_DIR" ]]; then
  echo "No agents directory at $AGENTS_DIR"
  exit 0
fi

removed=0
kept=0

# Clean up mailbox directories: {pid}-{session}/
for entry in "$AGENTS_DIR"/*/; do
  [[ -d "$entry" ]] || continue
  name=$(basename "$entry")
  pid=$(echo "$name" | cut -d- -f1)

  if kill -0 "$pid" 2>/dev/null; then
    kept=$((kept + 1))
  else
    if $DRY_RUN; then
      echo "would remove dir:  $entry"
    else
      rm -rf "$entry"
      echo "removed dir:  $entry"
    fi
    removed=$((removed + 1))
  fi
done

# Clean up standalone files: .json, .sock
for ext in json sock; do
  for file in "$AGENTS_DIR"/*."$ext"; do
    [[ -e "$file" ]] || continue
    name=$(basename "$file" ".$ext")
    pid=$(echo "$name" | cut -d- -f1)

    if kill -0 "$pid" 2>/dev/null; then
      kept=$((kept + 1))
    else
      if $DRY_RUN; then
        echo "would remove file: $file"
      else
        rm -f "$file"
        echo "removed file: $file"
      fi
      removed=$((removed + 1))
    fi
  done
done

echo
echo "Done. Removed: $removed | Kept (live): $kept"
