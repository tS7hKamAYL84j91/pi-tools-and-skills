#!/usr/bin/env bash
# update-memory.sh — Analyse a session log and suggest updates to a .mmem.yml.
#
# Usage:
#   update-memory.sh <session-log>                    Scan log; detect tool(s) automatically
#   update-memory.sh <session-log> --tool <name>      Target a specific tool
#   update-memory.sh <session-log> --tool <name> --auto   Append suggestions automatically
#
# Options:
#   --tool <name>   Name of the tool whose .mmem.yml to update (auto-detected if omitted)
#   --auto          Append LLM-generated suggestions directly to the .mmem.yml file
#                   (requires: pip install llm). Without --auto, dry-run only.
#
# Examples:
#   update-memory.sh ~/sessions/2026-04-08-pi.log
#   update-memory.sh session.log --tool git
#   update-memory.sh session.log --tool git --auto
#
# Environment:
#   MMEM_DIR   Override global memory directory (default: ~/.mmem)

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────

usage() {
  grep '^#' "$0" | grep -v '!/usr/bin' | sed 's/^# \?//'
  exit 1
}

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "  $*" >&2; }
have() { command -v "$1" &>/dev/null; }

MMEM_DIR="${MMEM_DIR:-$HOME/.mmem}"
PROJECT_DIR=".mmem"

# ── arg parsing ──────────────────────────────────────────────────────────────

SESSION_LOG=""
TOOL_NAME=""
AUTO=false

[[ $# -gt 0 ]] || usage

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)  TOOL_NAME="$2"; shift 2 ;;
    --auto)  AUTO=true; shift ;;
    --help|-h) usage ;;
    -*)  die "Unknown option: $1" ;;
    *)
      [[ -z "$SESSION_LOG" ]] || die "Extra argument: $1"
      SESSION_LOG="$1"; shift ;;
  esac
done

[[ -n "$SESSION_LOG" ]] || usage
[[ -f "$SESSION_LOG" ]] || die "Session log not found: $SESSION_LOG"

# ── resolve .mmem.yml path ───────────────────────────────────────────────────

resolve_mmem() {
  local name="$1"
  local project_path="${PROJECT_DIR}/${name}.mmem.yml"
  local global_path="${MMEM_DIR}/${name}.mmem.yml"
  if   [[ -f "$project_path" ]]; then echo "$project_path"
  elif [[ -f "$global_path"  ]]; then echo "$global_path"
  else echo ""
  fi
}

# ── auto-detect tools from log ───────────────────────────────────────────────

detect_tools_in_log() {
  local log="$1"
  # Look for known command-line tools mentioned in the log
  # Heuristic: find words that also have a .mmem.yml file
  local found=()
  for mmem_file in \
    "${PROJECT_DIR}"/*.mmem.yml \
    "${MMEM_DIR}"/*.mmem.yml; do
    [[ -f "$mmem_file" ]] || continue
    local name
    name=$(basename "$mmem_file" .mmem.yml)
    if grep -qw "$name" "$log" 2>/dev/null; then
      found+=("$name")
    fi
  done
  printf '%s\n' "${found[@]+"${found[@]}"}"
}

# ── extract signals from the session log ─────────────────────────────────────

extract_signals() {
  local log="$1"
  local tool="${2:-}"

  echo "=== ERROR / FAILURE LINES ==="
  if [[ -n "$tool" ]]; then
    grep -i -E "(error|fatal|failed|denied|not found|traceback|exception)" "$log" \
      | grep -i "$tool" | head -30 || true
  else
    grep -i -E "(error|fatal|failed|denied|not found|traceback|exception)" "$log" \
      | head -30 || true
  fi

  echo ""
  echo "=== COMMANDS USED (heuristic: lines starting with $ or >) ==="
  if [[ -n "$tool" ]]; then
    grep -E "^(\$|>)\s" "$log" | grep "$tool" | head -40 || \
    grep -E "\b${tool}\b" "$log" | grep -v '^#' | head -40 || true
  else
    grep -E "^(\$|>)\s" "$log" | head -40 || true
  fi

  echo ""
  echo "=== RETRY / WORKAROUND PATTERNS (repeated commands) ==="
  grep -E "^(\$|>)\s" "$log" | sort | uniq -d | head -20 || true
}

# ── LLM-based analysis ───────────────────────────────────────────────────────

llm_analyse() {
  local tool="$1"
  local mmem_path="$2"
  local log="$3"

  local existing_content
  existing_content=$(cat "$mmem_path")

  # Truncate log to last 200 lines for prompt budget
  local log_excerpt
  log_excerpt=$(tail -200 "$log")

  local prompt
  prompt="You are analysing a session log to improve a machine-memory (.mmem.yml) file for the tool '${tool}'.

EXISTING .mmem.yml:
---
${existing_content}
---

SESSION LOG (last 200 lines):
---
${log_excerpt}
---

Your task:
1. Identify any NEW gotchas, failure modes, or surprising behaviours encountered in the log that are NOT already in the .mmem.yml.
2. Identify any commands or patterns used in the log that are NOT in the .mmem.yml but would be worth adding.
3. Note any existing entries in the .mmem.yml that seem incorrect or incomplete based on the log.

Output format — use EXACTLY these section headings:

## New Gotchas
- <gotcha 1>
- <gotcha 2>
(or 'None' if nothing new)

## New Patterns
- <description>:
  \`<command>\`
(or 'None' if nothing new)

## Corrections
- <note about existing entry that may be wrong or incomplete>
(or 'None' if everything looks correct)

Be concise. Only include things that are genuinely new or wrong — do not repeat what is already there."

  echo "$prompt" | llm -
}

# ── append suggestions to mmem file ─────────────────────────────────────────

append_suggestions() {
  local mmem_path="$1"
  local suggestions="$2"
  local today
  today=$(date +%Y-%m-%d)

  {
    echo ""
    echo "# ── Auto-update ${today} ──────────────────────────────────────"
    echo "# Review and integrate the suggestions below, then delete this block."
    echo "#"
    echo "$suggestions" | sed 's/^/# /'
  } >> "$mmem_path"

  info "Suggestions appended to: $mmem_path"
  info "Review and integrate them, then delete the comment block."
}

# ── main ─────────────────────────────────────────────────────────────────────

echo "Analysing session log: $SESSION_LOG" >&2

# Determine which tool(s) to work on
if [[ -n "$TOOL_NAME" ]]; then
  TOOLS=("$TOOL_NAME")
else
  echo "Auto-detecting tools from log..." >&2
  mapfile -t TOOLS < <(detect_tools_in_log "$SESSION_LOG")
  if [[ ${#TOOLS[@]} -eq 0 ]]; then
    info "No matching .mmem.yml files detected in log. Specify --tool <name> to target one."
    echo ""
    echo "Heuristic signal extraction (no tool filter):"
    extract_signals "$SESSION_LOG" ""
    exit 0
  fi
  info "Detected tools: ${TOOLS[*]}"
fi

# Process each tool
for tool in "${TOOLS[@]}"; do
  echo "" >&2
  echo "── Tool: $tool ──────────────────────────────────────────────────" >&2

  mmem_path=$(resolve_mmem "$tool")

  if [[ -z "$mmem_path" ]]; then
    info "No .mmem.yml found for '$tool'."
    info "Create one first: create-memory.sh $tool"
    echo ""
    echo "Raw signals for '$tool' from log:"
    extract_signals "$SESSION_LOG" "$tool"
    continue
  fi

  info "Memory file: $mmem_path"

  if $AUTO; then
    if have llm; then
      info "Running LLM analysis..."
      SUGGESTIONS=$(llm_analyse "$tool" "$mmem_path" "$SESSION_LOG")
      echo ""
      echo "=== SUGGESTIONS FOR: $tool ==="
      echo "$SUGGESTIONS"
      echo ""
      append_suggestions "$mmem_path" "$SUGGESTIONS"
    else
      info "Warning: --auto requires the 'llm' CLI (pip install llm). Falling back to raw signals."
      echo ""
      extract_signals "$SESSION_LOG" "$tool"
    fi
  else
    # Dry run
    if have llm; then
      info "Dry run (use --auto to write). Running LLM analysis..."
      echo ""
      echo "=== SUGGESTIONS FOR: $tool (dry run — not written) ==="
      llm_analyse "$tool" "$mmem_path" "$SESSION_LOG"
    else
      info "Dry run. No 'llm' CLI available — showing raw signals."
      echo ""
      echo "=== RAW SIGNALS FOR: $tool ==="
      extract_signals "$SESSION_LOG" "$tool"
    fi
  fi
done
