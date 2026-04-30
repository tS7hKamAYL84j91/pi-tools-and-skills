#!/usr/bin/env bash
# Generate an Audio Overview (podcast) for a NotebookLM notebook.
# Optionally customise the instructions and wait for completion.
#
# Usage: nb-audio.sh "<notebook-name>" [instructions] [output-file]
# Example (basic):   bash skills/notebooklm/scripts/nb-audio.sh "Research Notebook"
# Example (custom):  bash skills/notebooklm/scripts/nb-audio.sh "Research Notebook" \
#                      "Focus on cross-cutting patterns" podcast.mp3

set -euo pipefail

NOTEBOOK="${1:-}"
INSTRUCTIONS="${2:-}"
OUTPUT="${3:-audio-overview.mp3}"

if [[ -z "$NOTEBOOK" ]]; then
  echo "Usage: nb-audio.sh \"<notebook-name>\" [instructions] [output-file]" >&2
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

echo "Using notebook '$NOTEBOOK' ($NOTEBOOK_ID)" >&2
notebooklm use "$NOTEBOOK_ID"

# Trigger generation
echo "Generating audio overview..." >&2
if [[ -n "$INSTRUCTIONS" ]]; then
  notebooklm audio generate --instructions "$INSTRUCTIONS"
else
  notebooklm audio generate
fi

# Poll until ready
echo "Waiting for audio generation to complete..." >&2
while true; do
  STATUS=$(notebooklm audio status 2>/dev/null | tr '[:upper:]' '[:lower:]')
  echo "  status: $STATUS" >&2
  if echo "$STATUS" | grep -qE "complete|ready|done"; then
    break
  fi
  if echo "$STATUS" | grep -qE "error|fail"; then
    echo "Audio generation failed." >&2
    exit 1
  fi
  sleep 10
done

# Download
echo "Downloading to $OUTPUT ..." >&2
notebooklm audio download "$OUTPUT"
echo "Audio saved to: $OUTPUT" >&2
