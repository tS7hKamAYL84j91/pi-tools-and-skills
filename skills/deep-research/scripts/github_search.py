#!/usr/bin/env python3
"""GitHub Search API wrapper for the deep-research skill.

Searches repositories and code on GitHub. Unauthenticated access allows
10 requests/min. Set GITHUB_TOKEN env var for 30 requests/min + higher
rate limits.

Usage:
    github_search.py --query "multi-agent LLM" --sort stars --limit 10
    github_search.py --query "GRE tunnel BGP" --language terraform --readme
    github_search.py --code "pimd config" --limit 5
    github_search.py --repo owner/name
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://api.github.com"
MAX_RETRIES = 3
BASE_DELAY = 1.0


def _headers():
    """Build request headers."""
    h = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "deep-research-skill/1.0",
    }
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _get(url, retries=MAX_RETRIES):
    """Make a GET request with retry on rate limits."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=_headers())
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                # Capture rate limit info
                remaining = resp.headers.get("X-RateLimit-Remaining", "?")
                limit = resp.headers.get("X-RateLimit-Limit", "?")
                if remaining != "?" and int(remaining) < 5:
                    print(f"  [github] Rate limit: {remaining}/{remaining} remaining",
                          file=sys.stderr)
                return data
        except urllib.error.HTTPError as e:
            if e.code == 403 and attempt < retries - 1:
                # Rate limited — wait until reset
                reset = e.headers.get("X-RateLimit-Reset")
                if reset:
                    wait = max(int(reset) - int(time.time()), 1)
                    print(f"  [github] Rate limited, waiting {wait}s...",
                          file=sys.stderr)
                    time.sleep(wait)
                    continue
                time.sleep(BASE_DELAY * (2 ** attempt))
                continue
            if e.code == 404:
                return {"error": "Not found", "status": 404}
            body = e.read().decode("utf-8", errors="replace")[:500]
            return {"error": f"HTTP {e.code}: {body}", "status": e.code}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(BASE_DELAY * (2 ** attempt))
                continue
            return {"error": str(e)}
    return {"error": "Max retries exceeded"}


def search_repos(query, sort="stars", order="desc", limit=10, language=None):
    """Search GitHub repositories."""
    q = query
    if language:
        q += f" language:{language}"
    params = urllib.parse.urlencode({
        "q": q,
        "sort": sort,
        "order": order,
        "per_page": min(limit, 100),
    })
    return _get(f"{BASE}/search/repositories?{params}")


def search_code(query, limit=10, language=None):
    """Search GitHub code."""
    q = query
    if language:
        q += f" language:{language}"
    params = urllib.parse.urlencode({
        "q": q,
        "per_page": min(limit, 100),
    })
    return _get(f"{BASE}/search/code?{params}")


def get_readme(owner, repo):
    """Fetch the README content for a repository (first 3000 chars)."""
    try:
        data = _get(f"{BASE}/repos/{owner}/{repo}/readme")
        if "content" in data:
            content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            return content[:3000]
        return ""
    except Exception:
        return ""


def get_repo_details(owner, repo):
    """Get detailed info for a specific repository."""
    return _get(f"{BASE}/repos/{owner}/{repo}")


def _format_repo(r):
    """Format a single repository result for readable output."""
    name = r.get("full_name", "?")
    desc = r.get("description", "") or "No description"
    stars = r.get("stargazers_count", 0)
    lang = r.get("language", "n/a")
    updated = r.get("updated_at", "?")[:10]
    license_info = (r.get("license") or {}).get("spdx_id", "n/a")
    topics = ", ".join(r.get("topics", [])[:5])
    url = r.get("html_url", "")

    lines = [
        f"# {name}",
        f"  {desc[:200]}",
        f"  ⭐ {stars} | Language: {lang} | Updated: {updated} | License: {license_info}",
        f"  URL: {url}",
    ]
    if topics:
        lines.append(f"  Topics: {topics}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="GitHub Search API wrapper for deep-research skill"
    )
    parser.add_argument("--query", "-q", help="Repository search query")
    parser.add_argument("--code", "-c", metavar="QUERY",
                        help="Search code instead of repositories")
    parser.add_argument("--repo", "-r", metavar="OWNER/NAME",
                        help="Get details for a specific repository")
    parser.add_argument("--sort", default="stars",
                        choices=["stars", "forks", "updated"],
                        help="Sort order for repo search (default: stars)")
    parser.add_argument("--language", "-l", help="Filter by language (e.g. python, go)")
    parser.add_argument("--limit", "-n", type=int, default=10,
                        help="Max results (default: 10, max: 100)")
    parser.add_argument("--readme", action="store_true",
                        help="Fetch README excerpt for top results (repo search only)")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON")

    args = parser.parse_args()

    # Determine mode
    if args.repo:
        parts = args.repo.split("/")
        if len(parts) != 2:
            parser.error("--repo requires OWNER/NAME format")
        result = get_repo_details(parts[0], parts[1])
        if args.readme:
            readme = get_readme(parts[0], parts[1])
            if readme:
                result["readme_excerpt"] = readme
    elif args.code:
        result = search_code(args.code, args.limit, args.language)
    elif args.query:
        result = search_repos(args.query, args.sort, "desc", args.limit, args.language)
        # Optionally fetch READMEs
        if args.readme and "items" in result:
            for r in result["items"][:5]:
                owner = r["owner"]["login"]
                name = r["name"]
                readme = get_readme(owner, name)
                if readme:
                    r["readme_excerpt"] = readme
                time.sleep(0.5)  # Be gentle on rate limits
    else:
        parser.error("One of --query, --code, --repo is required")

    # Output
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"ERROR: {result['error']}", file=sys.stderr)
            sys.exit(1)

        items = result.get("items", [])
        if items:
            total = result.get("total_count", len(items))
            mode = "code" if args.code else "repositories"
            print(f"Found {total} {mode} (showing {len(items)}):\n")
            for i, item in enumerate(items, 1):
                if args.code:
                    # Code results have different structure
                    repo = item.get("repository", {}).get("full_name", "?")
                    path = item.get("path", "?")
                    url = item.get("html_url", "")
                    print(f"[{i}] {repo}:{path}")
                    print(f"    URL: {url}\n")
                else:
                    print(f"[{i}] {_format_repo(item)}")
                    if "readme_excerpt" in item:
                        print(f"    README: {item['readme_excerpt'][:500]}...")
                    print()
        elif "full_name" in result:
            # Single repo detail
            print(_format_repo(result))
            if "readme_excerpt" in result:
                print(f"\n--- README excerpt ---\n{result['readme_excerpt'][:500]}...")
        else:
            print("No results found.", file=sys.stderr)


if __name__ == "__main__":
    main()