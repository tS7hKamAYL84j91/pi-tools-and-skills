#!/usr/bin/env bash
# Search Semantic Scholar for papers. Returns JSON array.
# Usage: semantic_scholar.sh "query terms" [max_results]
# Free API — rate limited to 10 req/min without key.
# Set SEMANTIC_SCHOLAR_API_KEY for higher limits.

set -euo pipefail

QUERY="${1:?Usage: semantic_scholar.sh \"query\" [max_results]}"
MAX="${2:-10}"
FIELDS="title,year,citationCount,url,authors,abstract,externalIds"

ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

HEADERS=()
if [ -n "${SEMANTIC_SCHOLAR_API_KEY:-}" ]; then
  HEADERS=(-H "x-api-key: ${SEMANTIC_SCHOLAR_API_KEY}")
fi

# Retry with backoff on 429
for attempt in 1 2 3; do
  RESPONSE=$(curl -s -w "\n%{http_code}" "${HEADERS[@]}" \
    "https://api.semanticscholar.org/graph/v1/paper/search?query=${ENCODED}&limit=${MAX}&fields=${FIELDS}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    # Extract and format the data array
    python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
papers = data.get('data', [])
results = []
for p in papers:
    results.append({
        'title': p.get('title', ''),
        'year': p.get('year'),
        'citations': p.get('citationCount', 0),
        'url': p.get('url', ''),
        'authors': [a.get('name', '') for a in (p.get('authors') or [])[:5]],
        'abstract': (p.get('abstract') or '')[:300] + ('...' if len(p.get('abstract') or '') > 300 else ''),
        'arxivId': (p.get('externalIds') or {}).get('ArXiv'),
        'doi': (p.get('externalIds') or {}).get('DOI'),
    })
print(json.dumps(results, indent=2))
" <<< "$BODY"
    exit 0
  fi

  if [ "$HTTP_CODE" = "429" ] && [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 3))
    continue
  fi

  echo "{\"error\": \"HTTP $HTTP_CODE\", \"body\": $(echo "$BODY" | head -1 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" >&2
  exit 1
done
