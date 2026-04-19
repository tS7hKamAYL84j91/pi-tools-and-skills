#!/usr/bin/env python3
"""OpenAlex API wrapper for the deep-research skill.

OpenAlex is a free, open catalog of 250M+ scholarly works. No API key required.
Rate limit: 10 requests/second (polite pool: 100/s with email param).

Usage:
    openalex_search.py --query "multi-agent orchestration" --limit 10
    openalex_search.py --query "transformer attention" --sort cited --limit 5
    openalex_search.py --query "BGP routing" --filter type:article --limit 10
    openalex_search.py --work W1234567890  # get specific work by OpenAlex ID
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://api.openalex.org"
VERSION = "deep-research-skill/1.0"

# Polite pool: 100 req/s if you provide email, else 10 req/s
EMAIL = os.environ.get("OPENALEX_EMAIL", "")
PARAMS_EXTRA = f"&mailto={EMAIL}" if EMAIL else ""


def _headers():
    h = {"User-Agent": VERSION}
    return h


def _get(path, params=None, retries=3):
    """Make a GET request with retry on rate limits."""
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
        if EMAIL:
            url += f"&mailto={EMAIL}"

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=_headers())
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(1 * (2 ** attempt))
                continue
            if e.code == 404:
                return {"error": f"Not found: {path}", "status": 404}
            body = e.read().decode("utf-8", errors="replace")[:500]
            return {"error": f"HTTP {e.code}: {body}", "status": e.code}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1)
                continue
            return {"error": str(e)}
    return {"error": "Max retries exceeded"}


def search_works(query, limit=10, sort="relevance_score", filter_str=None):
    """Search for academic works matching query."""
    params = {
        "search": query,
        "per_page": min(limit, 200),
        "sort": sort,
    }
    if filter_str:
        params["filter"] = filter_str
    return _get("/works", params)


def get_work(work_id):
    """Get a specific work by OpenAlex ID (e.g. W1234567890) or DOI."""
    return _get(f"/works/{work_id}")


def get_citations(work_id, limit=10):
    """Get works that cite this work."""
    params = {
        "filter": f"cites:{work_id}",
        "per_page": min(limit, 200),
        "sort": "cited_by_count:desc",
    }
    return _get("/works", params)


def get_references(work_id, limit=10):
    """Get works cited by this work."""
    params = {
        "filter": f"cited_by:{work_id}",
        "per_page": min(limit, 200),
    }
    # OpenAlex doesn't have a direct "references of" filter,
    # so we get the work and extract referenced_works
    work = get_work(work_id)
    if "error" in work:
        return work
    ref_ids = work.get("referenced_works", [])[:limit]
    if not ref_ids:
        return {"results": [], "meta": {"count": 0}}
    # Fetch details for each referenced work
    pipe_ids = "|".join(ref_ids)
    params = {
        "filter": f"openalex:{pipe_ids}",
        "per_page": min(limit, 200),
    }
    return _get("/works", params)


def _format_work(w):
    """Format a single work for readable output."""
    title = w.get("title", "No title")
    year = w.get("publication_year", "n/a")
    cited = w.get("cited_by_count", 0)
    doi = w.get("doi", "") or ""
    oa_id = w.get("id", "")
    work_type = w.get("type", "n/a")

    # Authors
    authorships = w.get("authorships", [])[:5]
    authors = ", ".join(
        a.get("author", {}).get("display_name", "?") for a in authorships
    )
    if len(w.get("authorships", [])) > 5:
        authors += " et al."

    # Venue
    venue = (w.get("primary_location") or {}).get("source", {}) or {}
    venue_name = venue.get("display_name", "")

    # Open access
    is_oa = w.get("open_access", {}).get("is_oa", False)
    oa_url = w.get("open_access", {}).get("oa_url", "")

    # Abstract (OpenAlex uses inverted index)
    abstract_inv = w.get("abstract_inverted_index") or {}
    if abstract_inv:
        # Reconstruct abstract from inverted index
        words = {}
        for word, positions in abstract_inv.items():
            for pos in positions:
                words[pos] = word
        abstract = " ".join(words[k] for k in sorted(words.keys()))[:300]
    else:
        abstract = ""

    lines = [
        f"# {title}",
        f"  Authors: {authors}",
        f"  Year: {year} | Cited by: {cited} | Type: {work_type}",
    ]
    if venue_name:
        lines.append(f"  Venue: {venue_name}")
    if doi:
        lines.append(f"  DOI: {doi}")
    if is_oa and oa_url:
        lines.append(f"  Open Access: {oa_url}")
    if abstract:
        lines.append(f"  Abstract: {abstract}...")
    lines.append(f"  OpenAlex: {oa_id}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="OpenAlex academic search for deep-research skill"
    )
    parser.add_argument("--query", "-q", help="Search query string")
    parser.add_argument("--limit", "-n", type=int, default=10,
                        help="Max results (default: 10, max: 200)")
    parser.add_argument("--sort", "-s", default="relevance_score:desc",
                        choices=["relevance_score:desc", "cited_by_count:desc",
                                 "publication_date:desc", "publication_date:asc"],
                        help="Sort order (default: relevance_score:desc)")
    parser.add_argument("--filter", "-f", default=None,
                        help="OpenAlex filter (e.g. 'type:article', 'topics.id:T123')")
    parser.add_argument("--work", "-w", metavar="WORK_ID",
                        help="Get specific work by OpenAlex ID or DOI")
    parser.add_argument("--citations", "-c", metavar="WORK_ID",
                        help="Get works citing this work")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON")
    parser.add_argument("--confidence", action="store_true",
                        help="Auto-calculate confidence score (1-10) per result")

    args = parser.parse_args()

    # Determine mode
    if args.citations:
        result = get_citations(args.citations, args.limit)
    elif args.work:
        result = get_work(args.work)
    elif args.query:
        result = search_works(args.query, args.limit, args.sort, args.filter)
    else:
        parser.error("One of --query, --work, --citations is required")

    # Output
    if args.json:
        print(json.dumps(result, indent=2))
        return

    if "error" in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)

    # Single work
    if "title" in result and "id" in result and "results" not in result:
        print(_format_work(result))
        if args.confidence:
            conf = _calc_confidence(result)
            print(f"  Confidence: {conf}/10")
        return

    # Search results
    works = result.get("results", [])
    total = result.get("meta", {}).get("count", len(works))

    if not works:
        print("No results found.", file=sys.stderr)
        return

    print(f"Found {total:,} results (showing {len(works)}):\n")

    for i, w in enumerate(works, 1):
        print(f"[{i}] {_format_work(w)}")
        if args.confidence:
            conf = _calc_confidence(w)
            print(f"    Confidence: {conf}/10")
        print()

    # Rate limit info
    remaining = result.get("meta", {}).get("count", "?")
    print(f"---\nTotal available: {remaining:,} works")


def _calc_confidence(w):
    """Auto-calculate confidence score (1-10) from work metadata."""
    score = 0

    # Peer-reviewed / journal article: +3
    work_type = w.get("type", "")
    if work_type in ("article", "review-article"):
        score += 3
    elif work_type in ("book-chapter", "proceedings-article"):
        score += 2
    else:
        score += 1  # preprint, etc.

    # Citations: +2 if >50, +1 if >10
    cited = w.get("cited_by_count", 0) or 0
    if cited > 50:
        score += 2
    elif cited > 10:
        score += 1

    # Recency: +2 if within 24 months, +1 if within 48 months
    year = w.get("publication_year", 0) or 0
    if year >= 2024:
        score += 2
    elif year >= 2022:
        score += 1

    # Open access: +1 (verifiable)
    if w.get("open_access", {}).get("is_oa", False):
        score += 1

    # Venue prestige: +1 if well-known publisher
    venue = (w.get("primary_location") or {}).get("source", {}) or {}
    venue_name = (venue.get("display_name") or "").lower()
    high_tier = ["nature", "science", "ieee", "acm", "springer", "elsevier",
                 "arxiv", "wiley", "oxford", "cambridge", "mit press"]
    if any(t in venue_name for t in high_tier):
        score += 1

    return min(score, 10)


if __name__ == "__main__":
    main()