#!/usr/bin/env bash
# inject-memory.sh — Output .mmem.yml files for context injection.
#
# Usage:
#   inject-memory.sh <tool> [<tool2> ...]   Inject named tool(s) from ~/.mmem/
#   inject-memory.sh --all                  Inject all files in ~/.mmem/
#   inject-memory.sh --project              Inject all files in ./.mmem/
#   inject-memory.sh --project <tool> ...   Project memories + named global tools
#
# Output goes to stdout — pipe it into your agent context or capture it:
#   MEMORY=$(inject-memory.sh git docker)
#
# Search order (project overrides global for the same name):
#   1. ./.mmem/<name>.mmem.yml  (project-local, committed)
#   2. ~/.mmem/<name>.mmem.yml  (user-global)
#
# Environment:
#   MMEM_DIR   Override global memory directory (default: ~/.mmem)

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────

usage() {
  grep '^#' "$0" | grep -v '!/usr/bin' | sed 's/^# \?//'
  exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

MMEM_DIR="${MMEM_DIR:-$HOME/.mmem}"
PROJECT_DIR=".mmem"

# ── emit a single .mmem.yml file with a separator header ─────────────────────

emit_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Warning: not found: $path" >&2
    return
  fi
  echo "<!-- mmem: $path -->"
  cat "$path"
  echo ""
}

# ── resolve a tool name to a file path ───────────────────────────────────────
# Project-local takes precedence over global.

resolve_tool() {
  local name="$1"
  # Normalise: strip .mmem.yml suffix if given
  name="${name%.mmem.yml}"

  local project_path="${PROJECT_DIR}/${name}.mmem.yml"
  local global_path="${MMEM_DIR}/${name}.mmem.yml"

  if [[ -f "$project_path" ]]; then
    echo "$project_path"
  elif [[ -f "$global_path" ]]; then
    echo "$global_path"
  else
    echo "" # not found
  fi
}

# ── arg parsing ──────────────────────────────────────────────────────────────

INJECT_ALL=false
INJECT_PROJECT=false
TOOLS=()

[[ $# -gt 0 ]] || usage

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)     INJECT_ALL=true; shift ;;
    --project) INJECT_PROJECT=true; shift ;;
    --help|-h) usage ;;
    -*) die "Unknown option: $1" ;;
    *)  TOOLS+=("$1"); shift ;;
  esac
done

# ── sanity: need at least one source ─────────────────────────────────────────

if ! $INJECT_ALL && ! $INJECT_PROJECT && [[ ${#TOOLS[@]} -eq 0 ]]; then
  usage
fi

# ── emit memories ────────────────────────────────────────────────────────────

EMITTED=()

# Track emitted paths to avoid duplicates
already_emitted() {
  local path="$1"
  for p in "${EMITTED[@]+"${EMITTED[@]}"}"; do
    [[ "$p" == "$path" ]] && return 0
  done
  return 1
}

emit_and_track() {
  local path="$1"
  if ! already_emitted "$path"; then
    emit_file "$path"
    EMITTED+=("$path")
  fi
}

# 1. Project-local memories
if $INJECT_PROJECT; then
  if [[ -d "$PROJECT_DIR" ]]; then
    while IFS= read -r -d '' f; do
      emit_and_track "$f"
    done < <(find "$PROJECT_DIR" -name "*.mmem.yml" -print0 | sort -z)
  else
    echo "Warning: no .mmem/ directory in current working directory." >&2
  fi
fi

# 2. All global memories
if $INJECT_ALL; then
  if [[ -d "$MMEM_DIR" ]]; then
    while IFS= read -r -d '' f; do
      emit_and_track "$f"
    done < <(find "$MMEM_DIR" -name "*.mmem.yml" -print0 | sort -z)
  else
    echo "Warning: $MMEM_DIR does not exist. Run: mkdir -p $MMEM_DIR" >&2
  fi
fi

# 3. Named tools (project overrides global)
for tool in "${TOOLS[@]+"${TOOLS[@]}"}"; do
  path=$(resolve_tool "$tool")
  if [[ -n "$path" ]]; then
    emit_and_track "$path"
  else
    echo "Warning: no .mmem.yml found for '$tool'" >&2
    echo "  Searched: ${PROJECT_DIR}/${tool}.mmem.yml" >&2
    echo "         and: ${MMEM_DIR}/${tool}.mmem.yml" >&2
    echo "  Create one with: create-memory.sh ${tool}" >&2
  fi
done

if [[ ${#EMITTED[@]} -eq 0 ]]; then
  echo "No memory files found." >&2
  exit 1
fi
