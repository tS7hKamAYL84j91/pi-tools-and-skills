---
name: research-expert
description: Comprehensive academic and technical researcher. Use this skill to search academic papers (Semantic Scholar, arXiv), read web content (Jina Reader), search GitHub repos, and produce structured research reports with citations.
---

# Research Expert

Systematic research workflow for academic papers, technical content, and code repositories.

## Available Tools

All scripts are in `skills/research-expert/scripts/` — run them via `bash`.

### 1. arXiv Search (academic papers)
```bash
bash skills/research-expert/scripts/arxiv_search.sh "multi-agent coordination LLM" 10
```
Returns JSON array: title, authors, published date, summary, PDF link, arXiv ID.
Free, no API key needed.

### 2. Semantic Scholar Search (citations + metadata)
```bash
bash skills/research-expert/scripts/semantic_scholar.sh "transformer attention mechanism" 10
```
Returns JSON array: title, year, citation count, authors, abstract, DOI, arXiv ID.
Free (rate-limited to ~10 req/min). Set `SEMANTIC_SCHOLAR_API_KEY` for higher limits.

### 3. Web Content Reader (any URL → clean text)
```bash
bash skills/research-expert/scripts/web_read.sh "https://arxiv.org/abs/2512.08296"
```
Converts any URL to clean markdown text via Jina Reader. Use to read:
- arXiv paper pages (abstract + metadata)
- Blog posts and technical articles
- Documentation pages
Free, no API key needed.

### 4. GitHub Repository Search
```bash
bash skills/research-expert/scripts/github_search.sh "agent orchestration framework" 10
```
Returns JSON array: repo name, description, stars, language, topics, URL.
Free (rate-limited). Set `GITHUB_TOKEN` for higher limits.

## Research Workflow

### Phase 1: Scope
1. Clarify the research question and output expectations
2. Identify 3–5 search queries covering the topic from different angles
3. Decide source priority: academic-first or industry-first

### Phase 2: Search
1. Run **arxiv_search** and **semantic_scholar** for academic papers
2. Run **github_search** for implementations and frameworks
3. Note the most-cited papers (Semantic Scholar citation counts)
4. Note the most-starred repos (GitHub stars)

### Phase 3: Deep Read
1. Use **web_read** to read the top 5–10 most relevant sources
2. For arXiv papers: read the abstract page, then the PDF if needed
3. For GitHub repos: read the README via `web_read.sh "https://github.com/user/repo"`
4. Extract key claims, methods, results, and limitations

### Phase 4: Synthesise
1. Cross-reference claims across sources
2. Build comparison tables (Method | Pros | Cons | Performance)
3. Identify consensus, contradictions, and gaps
4. Map findings to the original research question

### Phase 5: Report
Write the report following the template in `skills/research-expert/assets/research_report.md`:
- Executive Summary (key findings in 3–5 sentences)
- Literature Review (academic sources with citations)
- Technical Analysis (implementations, benchmarks, code)
- Synthesis (comparison tables, gap analysis, trends)
- References (all sources with URLs)

## Guidelines

- **Cite everything.** Every claim must link to a source.
- **Prefer recent work.** Weight papers from last 2 years higher unless citing foundational work.
- **Cross-verify.** Don't trust a single source. Check claims against code, benchmarks, or independent reports.
- **Quantify.** Include numbers: citation counts, star counts, benchmark scores, dates.
- **Be honest about gaps.** If the literature doesn't cover something, say so.
- **Rate-limit awareness.** Semantic Scholar is rate-limited. Space requests 3+ seconds apart, or use `SEMANTIC_SCHOLAR_API_KEY`.
