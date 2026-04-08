#!/usr/bin/env bash
# review-text.sh — Prepare a text file for style-aware review against a style profile
#
# Usage:
#   review-text.sh <text_file> [--profile <profile_path>]
#
# Output: Structured context (stdout) ready to paste into the Review Text prompt.
# Optionally: if `llm` CLI is installed, pass --auto to call the LLM directly.
#
# Requirements: bash, wc, grep (standard Unix tools)
# Optional: llm (https://llm.datasette.io) for --auto mode

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TEXT_FILE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_PATH="${SCRIPT_DIR}/../assets/style-profile.md"
AUTO_MODE=false
LLM_MODEL=""           # e.g. "claude-3-5-sonnet" — leave empty for llm default

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_PATH="$2"; shift 2 ;;
    --model)   LLM_MODEL="$2"; shift 2 ;;
    --auto)    AUTO_MODE=true; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) TEXT_FILE="$1"; shift ;;
  esac
done

if [[ -z "$TEXT_FILE" ]]; then
  echo "Usage: review-text.sh <text_file> [--profile <path>] [--auto] [--model <name>]" >&2
  exit 1
fi

if [[ ! -f "$TEXT_FILE" ]]; then
  echo "Error: Text file not found: '$TEXT_FILE'" >&2
  exit 1
fi

# ── Check for style profile ───────────────────────────────────────────────────
# Resolve relative path
if [[ ! "$PROFILE_PATH" = /* ]]; then
  PROFILE_PATH="$(pwd)/$PROFILE_PATH"
fi

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "Warning: Style profile not found at '$PROFILE_PATH'." >&2
  echo "Run analyse-style.sh first to generate it, or use --profile to specify a path." >&2
  echo "Continuing with Quick Style Check mode (no profile)..." >&2
  echo ""
  PROFILE_CONTENT="[No style profile found. Using Quick Style Check mode — ask the writer to paste 3–5 sample passages for comparison.]"
else
  PROFILE_CONTENT=$(cat "$PROFILE_PATH")
fi

# ── Text stats ────────────────────────────────────────────────────────────────
WORDS=$(wc -w < "$TEXT_FILE")
SENTENCES=$(grep -oE '[.!?]+' "$TEXT_FILE" | wc -l || echo 1)
[[ "$SENTENCES" -eq 0 ]] && SENTENCES=1
AVG_SENT=$(echo "scale=1; $WORDS / $SENTENCES" | bc 2>/dev/null || echo "n/a")

# ── Strip frontmatter from Markdown ──────────────────────────────────────────
TEXT_CONTENT=$(sed '/^---$/,/^---$/d' "$TEXT_FILE")

# ── Build review context ──────────────────────────────────────────────────────
OUTPUT=$(cat <<EOF
# Style Review Request
Generated: $(date '+%Y-%m-%d %H:%M')
File: $(basename "$TEXT_FILE")
Stats: $WORDS words · $SENTENCES sentences (est.) · avg $AVG_SENT words/sentence

---

## Writer's Style Profile

$PROFILE_CONTENT

---

## Text to Review

$TEXT_CONTENT

---

## Review Instructions

Apply the **Review Text Against Profile** prompt from \`skills/writing-style/SKILL.md\`:

You are a personal writing assistant. Review the text above against the style profile.

Output:
## Errors (fix these)
- Grammar, logic, clarity issues — clear corrections only

## Style flags (optional, grounded in profile)
- Passages that drift from the writer's voice
- For each: [original] → [profile-consistent alternative] — *why: references profile trait*

## What to preserve
- Note any passages that are particularly characteristic of the writer's voice

## Overall impression
- One paragraph: does this sound like them?
EOF
)

# ── Output or auto-call LLM ───────────────────────────────────────────────────
if $AUTO_MODE; then
  if ! command -v llm &>/dev/null; then
    echo "Error: --auto requires the 'llm' CLI. Install: pip install llm" >&2
    echo "Falling back to stdout mode." >&2
    echo "$OUTPUT"
    exit 0
  fi

  echo "==> Sending to LLM for review..." >&2

  MODEL_FLAG=""
  [[ -n "$LLM_MODEL" ]] && MODEL_FLAG="-m $LLM_MODEL"

  echo "$OUTPUT" | llm $MODEL_FLAG
else
  echo "$OUTPUT"
fi
