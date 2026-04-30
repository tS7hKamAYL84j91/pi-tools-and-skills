#!/usr/bin/env bash
# Watch Jules remote sessions and GitHub PRs for delegated work.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: jules-watch.sh [--repo owner/repo] [--issue NUMBER] [--interval SECONDS] [--once]

Shows:
  - jules remote sessions
  - open GitHub PRs for the repo, with URLs and CI/review signals when available

Examples:
  jules-watch.sh --repo owner/repo --once
  jules-watch.sh --repo owner/repo --issue 42 --interval 60
EOF
}

repo=""
issue=""
interval="60"
once="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:?--repo requires owner/repo}"; shift 2 ;;
    --issue) issue="${2:?--issue requires a number}"; shift 2 ;;
    --interval) interval="${2:?--interval requires seconds}"; shift 2 ;;
    --once) once="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$repo" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    remote="$(git remote get-url origin)"
    repo="$(python3 - <<'PY' "$remote"
import re,sys
url=sys.argv[1]
patterns=[r'github.com[:/](.+?)(?:\.git)?$', r'^https://github\.com/(.+?)(?:\.git)?$']
for p in patterns:
    m=re.search(p,url)
    if m:
        print(m.group(1)); break
PY
)"
  fi
fi

command -v jules >/dev/null 2>&1 || { echo "jules CLI not found" >&2; exit 1; }
command -v gh >/dev/null 2>&1 || echo "warning: gh CLI not found; PR watch disabled" >&2

show_once() {
  if [[ -t 1 ]]; then
    clear 2>/dev/null || true
  fi
  date
  echo
  echo "== Jules sessions =="
  jules remote list --session 2>&1 || true

  if command -v gh >/dev/null 2>&1 && [[ -n "$repo" ]]; then
    echo
    echo "== Open PRs: $repo =="
    gh pr list --repo "$repo" --state open --limit 20 \
      --json number,title,author,headRefName,url,updatedAt,reviewDecision,isDraft \
      --jq '.[] | "#\(.number) \(.title)\n  author=\(.author.login) draft=\(.isDraft) review=\(.reviewDecision // "") updated=\(.updatedAt)\n  branch=\(.headRefName)\n  \(.url)"' \
      2>/dev/null || gh pr list --repo "$repo" --state open --limit 20 || true

    if [[ -n "$issue" ]]; then
      echo
      echo "== Issue #$issue =="
      gh issue view "$issue" --repo "$repo" --comments --json title,state,labels,url,comments \
        --jq '"\(.state): \(.title)\n\(.url)\nlabels: " + ([.labels[].name] | join(", ")) + "\nrecent comments:\n" + ([.comments[-3:][]? | "- " + .author.login + ": " + (.body | split("\n")[0])] | join("\n"))' \
        2>/dev/null || gh issue view "$issue" --repo "$repo" || true
    fi
  fi
}

while true; do
  show_once
  [[ "$once" == "1" ]] && break
  sleep "$interval"
done
