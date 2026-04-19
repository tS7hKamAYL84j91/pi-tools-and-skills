#!/usr/bin/env python3
"""ArXiv API wrapper for the deep-research skill.

ArXiv is a free open-access archive for CS, Physics, Math, and more.
No API key required. Rate limit: 1 request per 3 seconds (polite).

Usage:
    arxiv_search.py --query "transformer attention mechanism" --limit 10
    arxiv_search.py --query "multi-agent coordination" --category cs.AI --limit 5
    arxiv_search.py --query "BGP routing" --sort submitted --limit 5
    arxiv_search.py --paper 2511.18743  # get specific paper by ArXiv ID
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = "http://export.arxiv.org/api/query"
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}

# ArXiv category prefixes
CATEGORIES = {
    "cs": "Computer Science",
    "physics": "Physics",
    "math": "Mathematics",
    "q-bio": "Quantitative Biology",
    "q-fin": "Quantitative Finance",
    "stat": "Statistics",
    "eess": "Electrical Engineering and Systems Science",
    "econ": "Economics",
}


def _get(url, retries=3):
    """Make a GET request with retry and polite delay."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "deep-research-skill/1.0 (+https://github.com/arxiv)"
            })
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            body = e.read().decode("utf-8", errors="replace")[:500]
            return None, f"HTTP {e.code}: {body}"
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(3)
                continue
            return None, str(e)
    return None, "Max retries exceeded"


def search(query, limit=10, category=None, sort_by="relevance"):
    """Search ArXiv for papers matching query."""
    # Build search query
    search_query = f"all:{query}"
    if category:
        search_query += f" AND cat:{category}"

    # Sort parameters
    sort_map = {
        "relevance": ("relevance", "descending"),
        "submitted": ("submittedDate", "descending"),
        "updated": ("lastUpdatedDate", "descending"),
    }
    sort_field, sort_dir = sort_map.get(sort_by, ("relevance", "descending"))

    params = urllib.parse.urlencode({
        "search_query": search_query,
        "max_results": min(limit, 200),
        "sortBy": sort_field,
        "sortOrder": sort_dir,
    })
    url = f"{BASE}?{params}"

    # Polite delay
    time.sleep(0.5)

    result = _get(url)
    if isinstance(result, tuple):
        # Error
        return {"error": result[1]}

    try:
        root = ET.fromstring(result)
    except ET.ParseError as e:
        return {"error": f"XML parse error: {e}"}

    entries = root.findall("atom:entry", NS)
    total = root.find("opensearch:totalResults", NS)
    total_text = total.text if total is not None else str(len(entries))

    works = []
    for entry in entries:
        work = _parse_entry(entry)
        if work:
            works.append(work)

    return {
        "total": int(total_text) if total_text.isdigit() else len(works),
        "results": works,
    }


def get_paper(arxiv_id):
    """Get a specific paper by ArXiv ID."""
    # Remove version if present
    clean_id = arxiv_id.replace("arXiv:", "").split("v")[0]

    params = urllib.parse.urlencode({
        "id_list": clean_id,
        "max_results": 1,
    })
    url = f"{BASE}?{params}"

    result = _get(url)
    if isinstance(result, tuple):
        return {"error": result[1]}

    try:
        root = ET.fromstring(result)
    except ET.ParseError as e:
        return {"error": f"XML parse error: {e}"}

    for entry in root.findall("atom:entry", NS):
        work = _parse_entry(entry)
        if work:
            return work

    return {"error": f"Paper not found: {arxiv_id}"}


def _parse_entry(entry):
    """Parse an ArXiv Atom entry into a dict."""
    title = entry.find("atom:title", NS)
    if title is None:
        return None
    title_text = title.text.strip().replace("\n", " ").replace("  ", " ")

    arxiv_id = entry.find("atom:id", NS)
    arxiv_id_text = arxiv_id.text.strip() if arxiv_id is not None else ""

    published = entry.find("atom:published", NS)
    published_text = published.text[:10] if published is not None else ""

    updated = entry.find("atom:updated", NS)
    updated_text = updated.text[:10] if updated is not None else ""

    summary = entry.find("atom:summary", NS)
    summary_text = ""
    if summary is not None and summary.text:
        summary_text = summary.text.strip().replace("\n", " ")[:500]

    # Authors
    authors = []
    for author in entry.findall("atom:author", NS):
        name = author.find("atom:name", NS)
        if name is not None:
            authors.append(name.text.strip())

    # Categories
    categories = []
    for cat in entry.findall("atom:category", NS):
        term = cat.get("term", "")
        if term:
            categories.append(term)

    # Links (PDF, etc.)
    pdf_url = ""
    for link in entry.findall("atom:link", NS):
        if link.get("title") == "pdf":
            pdf_url = link.get("href", "")
            break

    # DOI
    doi_elem = entry.find("arxiv:doi", NS)
    doi = doi_elem.text.strip() if doi_elem is not None else ""

    return {
        "arxiv_id": arxiv_id_text,
        "title": title_text,
        "authors": authors,
        "published": published_text,
        "updated": updated_text,
        "abstract": summary_text,
        "categories": categories,
        "pdf_url": pdf_url,
        "doi": doi,
    }


def _format_work(w):
    """Format a single ArXiv work for readable output."""
    lines = [
        f"# {w['title']}",
        f"  Authors: {', '.join(w['authors'][:5])}{' et al.' if len(w['authors']) > 5 else ''}",
        f"  Published: {w['published']} | Updated: {w['updated']}",
        f"  ArXiv: {w['arxiv_id']}",
    ]
    if w['categories']:
        lines.append(f"  Categories: {', '.join(w['categories'][:5])}")
    if w['doi']:
        lines.append(f"  DOI: {w['doi']}")
    if w['abstract']:
        lines.append(f"  Abstract: {w['abstract'][:300]}...")
    if w['pdf_url']:
        lines.append(f"  PDF: {w['pdf_url']}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="ArXiv academic search for deep-research skill"
    )
    parser.add_argument("--query", "-q", help="Search query string")
    parser.add_argument("--limit", "-n", type=int, default=10,
                        help="Max results (default: 10, max: 200)")
    parser.add_argument("--category", "-c", default=None,
                        help="ArXiv category filter (e.g. cs.AI, cs.LG, physics.comp-ph)")
    parser.add_argument("--sort", "-s", default="relevance",
                        choices=["relevance", "submitted", "updated"],
                        help="Sort order (default: relevance)")
    parser.add_argument("--paper", "-p", metavar="ARXIV_ID",
                        help="Get specific paper by ArXiv ID (e.g. 2511.18743)")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON")

    args = parser.parse_args()

    if args.paper:
        result = get_paper(args.paper)
    elif args.query:
        result = search(args.query, args.limit, args.category, args.sort)
    else:
        parser.error("One of --query or --paper is required")

    if args.json:
        print(json.dumps(result, indent=2))
        return

    if "error" in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)

    # Single paper
    if "arxiv_id" in result and "results" not in result:
        print(_format_work(result))
        return

    # Search results
    works = result.get("results", [])
    total = result.get("total", len(works))

    if not works:
        print("No results found.", file=sys.stderr)
        return

    print(f"Found {total:,} results (showing {len(works)}):\n")
    for i, w in enumerate(works, 1):
        print(f"[{i}] {_format_work(w)}\n")


if __name__ == "__main__":
    main()