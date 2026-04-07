#!/usr/bin/env bash
# Search GitHub repositories. Returns JSON array.
# Usage: github_search.sh "query terms" [max_results]
# Free API — 10 req/min unauthenticated, 30/min with GITHUB_TOKEN.

set -euo pipefail

QUERY="${1:?Usage: github_search.sh \"query\" [max_results]}"
MAX="${2:-10}"

ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

HEADERS=(-H "Accept: application/vnd.github+json")
if [ -n "${GITHUB_TOKEN:-}" ]; then
  HEADERS+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

RESPONSE=$(curl -s "${HEADERS[@]}" \
  "https://api.github.com/search/repositories?q=${ENCODED}&sort=stars&order=desc&per_page=${MAX}")

python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
items = data.get('items', [])
results = []
for r in items:
    results.append({
        'name': r.get('full_name', ''),
        'description': (r.get('description') or '')[:200],
        'stars': r.get('stargazers_count', 0),
        'language': r.get('language'),
        'url': r.get('html_url', ''),
        'updated': r.get('updated_at', ''),
        'topics': r.get('topics', [])[:5],
    })
print(json.dumps(results, indent=2))
" <<< "$RESPONSE"
