#!/usr/bin/env python3
"""Semantic Scholar API wrapper for the deep-research skill.

Provides academic paper search, citation tracking, and reference traversal.
Uses the public Semantic Scholar Graph API — no key required for basic use
(~100 requests/5 min). Set S2_API_KEY env var for higher rate limits.

Usage:
    scholarly_api.py --query "multi-agent orchestration" --limit 10
    scholarly_api.py --query "transformer attention" --fields "title,abstract,authors,year,citationCount,url,tldr"
    scholarly_api.py --citations PAPER_ID --limit 5
    scholarly_api.py --references PAPER_ID --limit 5
    scholarly_api.py --paper PAPER_ID
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://api.semanticscholar.org/graph/v1"
DEFAULT_FIELDS = "title,abstract,authors,year,citationCount,url,tldr"

# Rate-limit handling
MAX_RETRIES = 4
BASE_DELAY = 1.0  # seconds, exponential backoff base


def _headers():
    """Build request headers, optionally including API key."""
    h = {"Accept": "application/json"}
    key = os.environ.get("S2_API_KEY")
    if key:
        h["x-api-key"] = key
    return h


def _get(path, params=None, retries=MAX_RETRIES):
    """Make a GET request with exponential backoff on 429 errors."""
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=_headers())
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                delay = BASE_DELAY * (2 ** attempt)
                print(f"  [scholarly] Rate limited (429), retrying in {delay:.1f}s...",
                      file=sys.stderr)
                time.sleep(delay)
                continue
            if e.code == 404:
                return {"error": f"Not found: {path}", "status": 404}
            body = e.read().decode("utf-8", errors="replace")[:500]
            return {"error": f"HTTP {e.code}: {body}", "status": e.code}
        except Exception as e:
            if attempt < retries - 1:
                delay = BASE_DELAY * (2 ** attempt)
                time.sleep(delay)
                continue
            return {"error": str(e)}

    return {"error": "Max retries exceeded"}


def search(query, limit=10, fields=DEFAULT_FIELDS, offset=0):
    """Search for papers matching the query."""
    return _get("/paper/search", {
        "query": query,
        "limit": limit,
        "offset": offset,
        "fields": fields,
    })


def paper_details(paper_id, fields=DEFAULT_FIELDS):
    """Get details for a specific paper by Semantic Scholar ID or DOI."""
    return _get(f"/paper/{paper_id}", {"fields": fields})


def citations(paper_id, limit=5, fields="title,authors,year,citationCount,url"):
    """Get papers that cite the given paper."""
    return _get(f"/paper/{paper_id}/citations", {
        "limit": limit,
        "fields": fields,
    })


def references(paper_id, limit=5, fields="title,authors,year,citationCount,url"):
    """Get papers referenced by the given paper."""
    return _get(f"/paper/{paper_id}/references", {
        "limit": limit,
        "fields": fields,
    })


def _format_paper(p):
    """Format a single paper result for readable output."""
    title = p.get("title", "No title")
    year = p.get("year", "n/a")
    citations_n = p.get("citationCount", "n/a")
    url = p.get("url", "")

    authors = ", ".join(
        a.get("name", "?") for a in (p.get("authors") or [])[:5]
    )
    if len(p.get("authors") or []) > 5:
        authors += " et al."

    abstract = p.get("abstract", "") or ""
    tldr = p.get("tldr", {}) or {}
    tldr_text = tldr.get("text", "") if isinstance(tldr, dict) else ""

    lines = [
        f"# {title}",
        f"  Authors: {authors}",
        f"  Year: {year} | Citations: {citations_n}",
        f"  URL: {url}",
    ]
    if tldr_text:
        lines.append(f"  TL;DR: {tldr_text}")
    elif abstract:
        # Truncate long abstracts
        snippet = abstract[:500] + ("..." if len(abstract) > 500 else "")
        lines.append(f"  Abstract: {snippet}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Semantic Scholar API wrapper for deep-research skill"
    )
    parser.add_argument("--query", "-q", help="Search query string")
    parser.add_argument("--limit", "-n", type=int, default=10,
                        help="Max results (default: 10, max: 100)")
    parser.add_argument("--offset", type=int, default=0,
                        help="Result offset for pagination")
    parser.add_argument("--fields", "-f", default=DEFAULT_FIELDS,
                        help="Comma-separated fields to return")
    parser.add_argument("--paper", "-p", metavar="PAPER_ID",
                        help="Get details for a specific paper (S2 ID or DOI)")
    parser.add_argument("--citations", "-c", metavar="PAPER_ID",
                        help="Get papers citing this paper")
    parser.add_argument("--references", "-r", metavar="PAPER_ID",
                        help="Get papers referenced by this paper")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON (default: formatted text)")
    parser.add_argument("--delay", type=float, default=0,
                        help="Delay between requests in seconds (for batch use)")

    args = parser.parse_args()

    # Determine mode
    if args.citations:
        result = citations(args.citations, args.limit)
    elif args.references:
        result = references(args.references, args.limit)
    elif args.paper:
        result = paper_details(args.paper, args.fields)
    elif args.query:
        result = search(args.query, args.limit, args.fields, args.offset)
    else:
        parser.error("One of --query, --paper, --citations, --references is required")

    # Output
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"ERROR: {result['error']}", file=sys.stderr)
            sys.exit(1)

        # Search results have 'data' array; single paper is flat
        papers = result.get("data", [])
        if not papers and "title" in result:
            # Single paper detail
            print(_format_paper(result))
        elif papers:
            total = result.get("total", len(papers))
            print(f"Found {total} results (showing {len(papers)}):\n")
            for i, p in enumerate(papers, 1):
                # For citation/reference results, the paper is nested
                if "citingPaper" in p:
                    p = p["citingPaper"]
                elif "citedPaper" in p:
                    p = p["citedPaper"]
                print(f"[{i}] {_format_paper(p)}\n")
        else:
            print("No results found.", file=sys.stderr)


if __name__ == "__main__":
    main()