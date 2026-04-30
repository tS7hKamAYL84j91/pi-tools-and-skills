#!/usr/bin/env bash
# Create a new NotebookLM notebook and print its ID.
# Usage: nb-create.sh "<notebook-name>"
# Example: bash skills/notebooklm/scripts/nb-create.sh "Research Notebook"

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: nb-create.sh \"<notebook-name>\"" >&2
  exit 1
fi

echo "Creating notebook: $NAME" >&2
notebooklm create "$NAME"
