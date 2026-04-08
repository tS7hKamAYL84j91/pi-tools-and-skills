#!/usr/bin/env bash
# List all NotebookLM notebooks (ID, title, source count).
# Usage: nb-list.sh [--json]
# Example: bash skills/notebooklm/scripts/nb-list.sh

set -euo pipefail

if [[ "${1:-}" == "--json" ]]; then
  notebooklm list --json
else
  notebooklm list
fi
