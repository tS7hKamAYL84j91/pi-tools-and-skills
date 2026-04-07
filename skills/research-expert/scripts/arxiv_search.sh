#!/usr/bin/env bash
# Search arXiv for papers. Returns JSON array of results.
# Usage: arxiv_search.sh "query terms" [max_results]
# Free API, no key required.

set -euo pipefail

QUERY="${1:?Usage: arxiv_search.sh \"query\" [max_results]}"
MAX="${2:-10}"

# URL-encode the query
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

# Fetch arXiv Atom feed
XML=$(curl -s "https://export.arxiv.org/api/query?search_query=all:${ENCODED}&start=0&max_results=${MAX}&sortBy=relevance&sortOrder=descending")

# Parse XML to JSON using Python
python3 -c "
import xml.etree.ElementTree as ET
import json, sys

xml_data = sys.stdin.read()
root = ET.fromstring(xml_data)
ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}

results = []
for entry in root.findall('atom:entry', ns):
    title = entry.find('atom:title', ns)
    summary = entry.find('atom:summary', ns)
    published = entry.find('atom:published', ns)
    arxiv_id = entry.find('atom:id', ns)
    authors = [a.find('atom:name', ns).text for a in entry.findall('atom:author', ns)]
    categories = [c.get('term') for c in entry.findall('atom:category', ns)]
    pdf_link = None
    for link in entry.findall('atom:link', ns):
        if link.get('title') == 'pdf':
            pdf_link = link.get('href')

    results.append({
        'title': title.text.strip().replace('\n', ' ') if title is not None else '',
        'id': arxiv_id.text.strip() if arxiv_id is not None else '',
        'published': published.text.strip() if published is not None else '',
        'authors': authors[:5],
        'categories': categories,
        'summary': (summary.text.strip().replace('\n', ' ')[:300] + '...') if summary is not None and len(summary.text.strip()) > 300 else (summary.text.strip().replace('\n', ' ') if summary is not None else ''),
        'pdf': pdf_link,
    })

print(json.dumps(results, indent=2))
" <<< "$XML"
