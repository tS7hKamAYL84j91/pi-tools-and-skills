---
name: research-expert
display_name: Research Expert
description: Comprehensive academic and technical researcher. Use this skill to search academic papers (Semantic Scholar), technical blogs (Tavily/Jina), and GitHub repositories. It automates literature reviews, technical trend analysis, and code mining.
version: 1.0.0
author: Jules
license: MIT
---
# Research Expert Instructions

## Core Workflow
1. Use `skills/research-expert/scripts/scholarly_api.py` to identify foundational academic papers and recent advancements.
2. Search GitHub via `skills/research-expert/scripts/github_search.py` for implementation patterns and open-source benchmarks.
3. Access technical blogs using `skills/research-expert/scripts/web_scraper.py` (via Tavily) to capture current industry context.
4. Normalize all findings into Markdown using the layout-aware parsing instructions.

## Guidelines
- Prioritize peer-reviewed academic sources for foundational claims.
- Cross-verify technical blog claims against raw code in GitHub.
- Use LaTeX for mathematical notation and Markdown tables for comparisons.
- Adhere to the report template in `assets/research_report.md`.
