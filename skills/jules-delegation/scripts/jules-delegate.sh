#!/usr/bin/env bash
# Delegate a task to Google Jules via CLI, or hand off a GitHub issue by label.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  jules-delegate.sh [--repo owner/repo] [--parallel 1-5] [--prompt-file FILE] [--] PROMPT...
  jules-delegate.sh --issue NUMBER [--repo owner/repo] [--label-only]

Examples:
  jules-delegate.sh --repo owner/repo "Add tests for the parser"
  jules-delegate.sh --parallel 3 --prompt-file task.md
  jules-delegate.sh --repo owner/repo --issue 42 --label-only
EOF
}

repo=""
parallel="1"
prompt_file=""
issue=""
label_only="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:?--repo requires owner/repo}"; shift 2 ;;
    --parallel) parallel="${2:?--parallel requires a number}"; shift 2 ;;
    --prompt-file) prompt_file="${2:?--prompt-file requires a file}"; shift 2 ;;
    --issue) issue="${2:?--issue requires a number}"; shift 2 ;;
    --label-only) label_only="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

command -v jules >/dev/null 2>&1 || { echo "jules CLI not found; run: npm install -g @google/jules && jules login" >&2; exit 1; }

if [[ -n "$issue" && "$label_only" == "1" ]]; then
  command -v gh >/dev/null 2>&1 || { echo "gh CLI required for --label-only issue delegation" >&2; exit 1; }
  args=(issue edit "$issue" --add-label jules)
  [[ -n "$repo" ]] && args+=(--repo "$repo")
  gh "${args[@]}"
  echo "Delegated issue #${issue} to Jules by applying label 'jules'." >&2
  exit 0
fi

prompt=""
if [[ -n "$prompt_file" ]]; then
  [[ -f "$prompt_file" ]] || { echo "prompt file not found: $prompt_file" >&2; exit 1; }
  prompt="$(cat "$prompt_file")"
elif [[ -n "$issue" ]]; then
  command -v gh >/dev/null 2>&1 || { echo "gh CLI required for --issue prompt import" >&2; exit 1; }
  view_args=(issue view "$issue" --json title,body,url --jq '"Issue: " + .title + "\nURL: " + .url + "\n\n" + (.body // "")')
  [[ -n "$repo" ]] && view_args+=(--repo "$repo")
  prompt="$(gh "${view_args[@]}")"
elif [[ $# -gt 0 ]]; then
  prompt="$*"
else
  prompt="$(cat)"
fi

[[ -n "${prompt//[[:space:]]/}" ]] || { echo "empty Jules prompt" >&2; exit 1; }

args=(new --parallel "$parallel")
[[ -n "$repo" ]] && args+=(--repo "$repo")
args+=("$prompt")

jules "${args[@]}"
