#!/usr/bin/env python3
"""Web search wrapper for the deep-research skill.

Primary: Tavily Search API (requires TAVILY_API_KEY, ~$0.001/search).
Fallback: Jina Search (requires JINA_API_KEY, free tier available).
Free: DuckDuckGo HTML search (no key required, no registration).

Usage:
    web_scraper.py --query "GRE tunnelling AWS BGP" --max-results 10
    web_scraper.py --query "site:arxiv.org transformer attention" --engine tavily
    web_scraper.py --query "low latency trading infrastructure" --engine duckduckgo
    web_scraper.py --url "https://example.com/article"  # read a specific URL
    web_scraper.py --url "https://example.com/article"  # read a specific URL
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

MAX_RETRIES = 3
BASE_DELAY = 1.0


def _tavily_search(query, max_results=10, search_depth="advanced"):
    """Search using Tavily API. Requires TAVILY_API_KEY env var."""
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return {"error": "TAVILY_API_KEY not set. Set env var or use --engine jina"}

    payload = json.dumps({
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "search_depth": search_depth,
        "include_raw_content": False,
        "include_answer": True,
    }).encode()

    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        return {"error": f"Tavily HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": f"Tavily request failed: {e}"}


def _jina_search(query, max_results=10):
    """Search using Jina Search API. Requires JINA_API_KEY env var (free tier available).
    Falls back to JINA_API_KEY or returns error prompting auth setup."""
    jina_key = os.environ.get("JINA_API_KEY")
    encoded = urllib.parse.quote(query)
    url = f"https://s.jina.ai/{encoded}"

    headers = {
        "Accept": "application/json",
        "User-Agent": "deep-research-skill/1.0",
    }
    if jina_key:
        headers["Authorization"] = f"Bearer {jina_key}"

    req = urllib.request.Request(url, headers=headers)

    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read())
                return _normalise_jina(data, max_results)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return {"error": "Jina Search requires JINA_API_KEY. Set env var or use --engine duckduckgo"}
            if e.code == 429 and attempt < MAX_RETRIES - 1:
                import time
                time.sleep(BASE_DELAY * (2 ** attempt))
                continue
            body = e.read().decode("utf-8", errors="replace")[:500]
            return {"error": f"Jina HTTP {e.code}: {body}"}
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                import time
                time.sleep(BASE_DELAY * (2 ** attempt))
                continue
            return {"error": f"Jina request failed: {e}"}

    return {"error": "Jina max retries exceeded"}


def _normalise_jina(data, max_results):
    """Normalise Jina search response to a common format."""
    results = []
    # Jina returns different structures depending on endpoint
    if "data" in data:
        for item in data["data"][:max_results]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "content": item.get("description", "") or item.get("content", "")[:2000],
                "score": item.get("score", 0),
            })
    elif "result" in data:
        # Jina reader format
        text = data.get("result", {}).get("content", "") or ""
        results.append({
            "title": "Jina result",
            "url": "",
            "content": text[:3000],
            "score": 0,
        })

    return {
        "query": data.get("query", ""),
        "answer": "",
        "results": results,
    }


def _duckduckgo_search(query, max_results=10):
    """Search using DuckDuckGo HTML. Free, no key required, no registration.
    Parses the HTML lite endpoint for search results."""
    params = urllib.parse.urlencode({
        "q": query,
        "kl": "en-us",
    })
    url = f"https://lite.duckduckgo.com/lite/?{params}"

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) deep-research-skill/1.0",
        "Accept": "text/html",
    })

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
            return _parse_ddg_html(html, query, max_results)
    except Exception as e:
        return {"error": f"DuckDuckGo search failed: {e}"}


def _parse_ddg_html(html, query, max_results):
    """Parse DuckDuckGo lite HTML to extract search results.
    DDG lite uses rel=nofollow links with uddg parameter for actual URLs."""
    import re
    results = []

    # DDG lite encodes actual URLs in the uddg parameter
    # Pattern: href="//duckduckgo.com/l/?uddg=ENCODED_URL">Title</a>
    uddg_pattern = re.compile(
        r'href="//duckduckgo\.com/l/\?uddg=([^"]+)"[^>]*>(.*?)</a>',
        re.DOTALL
    )
    uddg_matches = uddg_pattern.findall(html)

    for encoded_url, raw_title in uddg_matches[:max_results]:
        # Decode the actual URL (strip DDG tracking params)
        actual_url = urllib.parse.unquote(encoded_url)
        # Remove trailing &rut= or &amp;rut= tracking parameter
        for sep in ['&rut=', '&amp;rut=', '\u0026rut=']:
            if sep in actual_url:
                actual_url = actual_url[:actual_url.index(sep)]
                break
        # Clean title (strip HTML tags, decode entities)
        clean_title = re.sub(r'<[^>]+>', '', raw_title).strip()
        clean_title = clean_title.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        if not clean_title:
            clean_title = "No title"
        results.append({
            "title": clean_title,
            "url": actual_url,
            "content": "",  # DDG lite doesn't provide reliable snippets
            "score": 0,
        })

    # Fallback: look for any nofollow links with direct URLs
    if not results:
        nofollow_pattern = re.compile(
            r'rel="nofollow"[^>]*href="(https?://[^"]+)"[^>]*>([^<]+)</a>'
        )
        for url, title in nofollow_pattern.findall(html)[:max_results]:
            if "duckduckgo.com" not in url:
                results.append({
                    "title": title.strip() or "No title",
                    "url": url,
                    "content": "",
                    "score": 0,
                })

    return {
        "query": query,
        "answer": "",
        "results": results[:max_results],
    }


def _jina_read_url(url):
    """Read a specific URL using Jina Reader. Free for reading, JINA_API_KEY optional."""
    reader_url = f"https://r.jina.ai/{url}"

    headers = {
        "Accept": "application/json",
        "User-Agent": "deep-research-skill/1.0",
    }
    jina_key = os.environ.get("JINA_API_KEY")
    if jina_key:
        headers["Authorization"] = f"Bearer {jina_key}"

    req = urllib.request.Request(reader_url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            content = ""
            if "data" in data:
                content = data["data"].get("content", "")
            elif "result" in data:
                content = data.get("result", {}).get("content", "")
            return {
                "url": url,
                "content": content[:5000],
                "title": data.get("data", {}).get("title", ""),
            }
    except Exception as e:
        return {"error": f"Jina reader failed for {url}: {e}"}


def _format_result(r):
    """Format a single search result for readable output."""
    title = r.get("title", "No title")
    url = r.get("url", "")
    score = r.get("score", "")
    content = r.get("content", "")[:500]

    lines = [
        f"# {title}",
        f"  URL: {url}",
    ]
    if score:
        lines.append(f"  Score: {score}")
    if content:
        lines.append(f"  {content}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Web search wrapper for deep-research skill"
    )
    parser.add_argument("--query", "-q", help="Search query string")
    parser.add_argument("--url", "-u", help="Read a specific URL (uses Jina Reader)")
    parser.add_argument("--max-results", "-n", type=int, default=10,
                        help="Max results (default: 10)")
    parser.add_argument("--engine", "-e", default="tavily",
                        choices=["tavily", "jina", "duckduckgo"],
                        help="Search engine (default: tavily, free: duckduckgo)")
    parser.add_argument("--depth", "-d", default="advanced",
                        choices=["basic", "advanced"],
                        help="Tavily search depth (default: advanced)")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON")

    args = parser.parse_args()

    # Determine mode
    if args.url:
        result = _jina_read_url(args.url)
    elif args.query:
        if args.engine == "tavily":
            result = _tavily_search(args.query, args.max_results, args.depth)
        elif args.engine == "jina":
            result = _jina_search(args.query, args.max_results)
        else:
            result = _duckduckgo_search(args.query, args.max_results)
    else:
        parser.error("One of --query or --url is required")

    # Output
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"ERROR: {result['error']}", file=sys.stderr)
            sys.exit(1)

        # URL read mode
        if args.url:
            print(f"# {result.get('title', 'No title')}")
            print(f"URL: {result.get('url', '')}")
            print(f"\n{result.get('content', '')}")
            sys.exit(0)

        # Search mode
        answer = result.get("answer", "")
        results = result.get("results", [])

        if answer:
            print(f"## Answer\n{answer}\n")

        if results:
            print(f"## Results ({len(results)})\n")
            for i, r in enumerate(results, 1):
                print(f"[{i}] {_format_result(r)}\n")
        else:
            print("No results found.", file=sys.stderr)


if __name__ == "__main__":
    main()