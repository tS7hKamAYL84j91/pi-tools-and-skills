#!/usr/bin/env bash
# create-memory.sh — Scaffold a .mmem.yml from a tool's --help output.
#
# Usage:
#   create-memory.sh <tool> [--output <path>] [--enrich]
#
# Options:
#   --output <path>   Write to this path instead of ~/.mmem/<tool>.mmem.yml
#   --enrich          Use the `llm` CLI to fill in sections (requires: pip install llm)
#
# Examples:
#   create-memory.sh git
#   create-memory.sh docker --enrich
#   create-memory.sh terraform --output .mmem/terraform.mmem.yml

set -euo pipefail

# ── helpers ─────────────────────────────────────────────────────────────────

usage() {
  grep '^#' "$0" | grep -v '!/usr/bin' | sed 's/^# \?//'
  exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

today() { date +%Y-%m-%d; }

have() { command -v "$1" &>/dev/null; }

# ── arg parsing ──────────────────────────────────────────────────────────────

TOOL=""
OUTPUT=""
ENRICH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --enrich) ENRICH=true; shift ;;
    --help|-h) usage ;;
    -*) die "Unknown option: $1" ;;
    *)
      [[ -z "$TOOL" ]] || die "Extra argument: $1"
      TOOL="$1"; shift ;;
  esac
done

[[ -n "$TOOL" ]] || usage

# ── output path ──────────────────────────────────────────────────────────────

MMEM_DIR="${MMEM_DIR:-$HOME/.mmem}"

if [[ -z "$OUTPUT" ]]; then
  mkdir -p "$MMEM_DIR"
  OUTPUT="$MMEM_DIR/${TOOL}.mmem.yml"
fi

if [[ -f "$OUTPUT" ]]; then
  die "$OUTPUT already exists. Delete it first or choose --output <different-path>."
fi

# ── locate template ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../assets/template.mmem.yml"
[[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"

# ── collect help text ────────────────────────────────────────────────────────

echo "Fetching help text for '$TOOL'..." >&2

HELP_TEXT=""
if have "$TOOL"; then
  # Try --help first; fall back to -h; fall back to man
  if HELP_TEXT=$("$TOOL" --help 2>&1 | head -120); then
    :
  elif HELP_TEXT=$("$TOOL" -h 2>&1 | head -120); then
    :
  elif have man && HELP_TEXT=$(man "$TOOL" 2>/dev/null | col -bx | head -120); then
    :
  else
    echo "Warning: could not retrieve help text for '$TOOL'; creating empty skeleton." >&2
  fi
else
  echo "Warning: '$TOOL' not found in PATH; creating empty skeleton." >&2
fi

# ── build skeleton ───────────────────────────────────────────────────────────

build_skeleton() {
  local tool="$1"
  local help_text="$2"
  local date
  date=$(today)

  # Emit YAML front matter + skeleton body
  cat <<SKELETON
---
tool: ${tool}
version: ">=TODO"
updated: ${date}
category: TODO
tags: [${tool}, TODO]
confidence: medium
---

# ${tool} — TODO one-line purpose

> TODO: what it does in ≤20 words.

## Common operations

- TODO intent:
  \`${tool} {{arg}}\`

- TODO intent:
  \`${tool} {{arg}}\`

## Patterns

- TODO pattern:
  \`${tool} {{arg}} | TODO\`

## Gotchas

- TODO gotcha

## Examples

- TODO example:
  \`${tool} {{arg}}\`
SKELETON

  if [[ -n "$help_text" ]]; then
    printf '\n\n# ── source: %s --help (remove after filling in) ──\n' "$tool"
    printf '%s\n' "$help_text" | sed 's/^/# /'
  fi
}

# ── LLM enrichment ───────────────────────────────────────────────────────────

build_enriched() {
  local tool="$1"
  local help_text="$2"
  local date
  date=$(today)

  local prompt
  prompt="You are writing a machine-memory (.mmem.yml) file for the tool '${tool}'.
The format is YAML front matter followed by a Markdown body (tldr-style, example-first).

YAML front matter fields:
  tool, version (\">=X.Y\" or \"any\"), updated (${date}), category, tags (list), confidence (high/medium/low)

Markdown body sections (use these H2 headings exactly):
  ## Common operations   — bullet + backtick per operation, {{placeholder}} for substitution points
  ## Patterns            — compound commands, pipelines, multi-step workflows
  ## Gotchas             — common mistakes, dangerous defaults, when NOT to use
  ## Examples            — end-to-end realistic scenarios

Rules:
  - Keep the whole file under 500 tokens.
  - Task-first phrasing: 'Create an archive:' not '-c flag:'
  - Every command line in backticks.
  - No filler prose.

Here is the --help output to draw from:
---
${help_text}
---

Output ONLY the .mmem.yml file content, nothing else."

  echo "$prompt" | llm -
}

# ── write file ───────────────────────────────────────────────────────────────

mkdir -p "$(dirname "$OUTPUT")"

if $ENRICH; then
  if have llm; then
    echo "Enriching with LLM..." >&2
    build_enriched "$TOOL" "$HELP_TEXT" > "$OUTPUT"
    echo "Written (LLM-enriched): $OUTPUT" >&2
  else
    echo "Warning: 'llm' CLI not found. Install with: pip install llm" >&2
    echo "Falling back to skeleton." >&2
    build_skeleton "$TOOL" "$HELP_TEXT" > "$OUTPUT"
    echo "Written (skeleton): $OUTPUT" >&2
  fi
else
  build_skeleton "$TOOL" "$HELP_TEXT" > "$OUTPUT"
  echo "Written (skeleton): $OUTPUT" >&2
  echo "" >&2
  echo "Next steps:" >&2
  echo "  1. Edit $OUTPUT — fill in TODO fields" >&2
  echo "  2. Delete the commented --help source at the bottom" >&2
  echo "  3. Or re-run with --enrich to let an LLM fill it in" >&2
fi
