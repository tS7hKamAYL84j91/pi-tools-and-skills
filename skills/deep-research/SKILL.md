---
name: deep-research
description: "Deep iterative research using the RhinoInsight VCM/EAM pattern (arXiv:2511.18743). Use when researching complex topics that require multi-angle search, gap detection, and evidence-bound synthesis. Implements 5-phase Plan→Execute→Gap detect→Synthesise workflow with Verifiable Checklist Module (VCM) and Evidence Audit Module (EAM). Presets: quick (D=1,B=3), standard (D=2,B=5), deep (D=3,B=8). Outperforms Gemini Deep Research on DeepResearch Bench."
---

# Deep Research

Systematic deep research using **Verifiable Checklist Module (VCM)** + **Evidence Audit Module
(EAM)** from RhinoInsight (arXiv:2511.18743, DeepLang AI / Tsinghua, Nov 2025).
Achieves 50.92 RACE vs Gemini-2.5-Pro Deep Research 49.71.

## Architecture

```
Phase 0 [VCM]   → Verifiable checklist + critic refinement    → BRIEF.md, OUTLINE.md
Phase 1 [EAM-1] → Search per node, normalise, update outline  → SOURCES.md, OUTLINE.md
Phase 2 [GAP]   → Detect unsatisfied nodes, reformulate       → OUTLINE.md updates
Phase 3 [EAM-2] → Evidence binding critic, rank + bind        → EVIDENCE.md
Phase 4 [WRITE] → Compose report, every claim cited           → REPORT.md
```

## Presets (Depth × Breadth)

| Preset   | D | B | Budget | When                             |
|----------|---|---|--------|----------------------------------|
| quick    | 1 | 3 | ~4     | Known domain, time-limited       |
| standard | 2 | 5 | ~15    | Default — most research tasks    |
| deep     | 3 | 8 | ~40    | Novel domain, architecture calls |

**D** = recursion depth (lead-following). **B** = breadth (queries per outline node).
**Budget** = max total search invocations.

## Phase 0 — VCM: Verifiable Checklist Generation

**Execute BEFORE any search. Error in the plan propagates to every downstream step.**

### Step 0a — Write BRIEF.md

```markdown
Goal:      <one-sentence research question>
Preset:    quick | standard | deep
D:         1 | 2 | 3
B:         3 | 5 | 8
Budget:    <max searches>
Scope-in:  <domains / topics to cover>
Scope-out: <explicitly excluded>
```

### Step 0b — Generate initial checklist C0

Produce B top-level verifiable checks, each with an **explicit acceptance criterion**:

```
C0:
- [ ] C1: <sub-goal>
       Acceptance: <what "done" looks like — measurable, not vague>
       Source type: academic | code | web | mixed
       Depends on: —
- [ ] C2: <sub-goal>
       Acceptance: ...
       Source type: ...
       Depends on: C1
```

Acceptance criteria must be testable: "≥3 peer-reviewed papers describe X" not "understand X".

### Step 0c — Critic pass (self-critique)

For each check in C0, ask:
1. Is the acceptance criterion unambiguous? (two agents would agree independently)
2. Is the scope bounded? (no open-ended "everything about X")
3. Are dependency orderings correct?
4. Are any checks duplicates or overlapping?

Rewrite failing checks → produce **C1**. One critic pass is sufficient.

### Step 0d — Build OUTLINE.md

Map C1 to hierarchical `OUTLINE.md` (template: `assets/OUTLINE_template.md`):
- Top-level section = each C1 check
- Subsections = sub-checks or key aspects to cover
- Every node carries: acceptance criterion, source type, node ID (N01, N01.1, …)
- Initial state: all nodes `[ ] unsatisfied`

**Phase 0 outputs:** `BRIEF.md`, `OUTLINE.md`

---

## Phase 1 — Execute: Search + Ingest + Outline Update

**Iterate over unsatisfied outline nodes. Read only OUTLINE.md + last 10 SOURCES.md rows
into active context (Markovian window — prevents context rot).**

### Step 1a — Generate search queries

For each unsatisfied node, generate up to **B** queries:
- Vary phrasing: synonyms, narrow/broad terms, author names, year ranges
- Match source type: Semantic Scholar for academic, GitHub for code, Tavily/Jina for web

### Available scripts (in `scripts/` directory)

| Script | Source | CLI | Auth |
|--------|--------|-----|------|
| `scholarly_api.py` | Semantic Scholar | `--query X --limit N` | Optional: `S2_API_KEY` |
| `github_search.py` | GitHub repos/code | `--query X --sort stars --limit N [--readme]` | Optional: `GITHUB_TOKEN` |
| `web_scraper.py` | Tavily (primary) / Jina (fallback) / DuckDuckGo (free) | `--query X --max-results N [--engine jina|duckduckgo]` or `--url URL` | Required for Tavily: `TAVILY_API_KEY`. Jina: `JINA_API_KEY`. DDG: none |

### Step 1b — Run scripts and normalise

For each unsatisfied node, run the appropriate script(s):

```bash
# Academic search (Semantic Scholar)
python3 skills/deep-research/scripts/scholarly_api.py \
  --query "your academic query" --limit 10 --json

# GitHub search (repositories)
python3 skills/deep-research/scripts/github_search.py \
  --query "your code query" --sort stars --limit 10 --readme

# GitHub code search
python3 skills/deep-research/scripts/github_search.py \
  --code "pimd multicast config" --limit 5

# Web search (Tavily — requires TAVILY_API_KEY)
python3 skills/deep-research/scripts/web_scraper.py \
  --query "your web query" --max-results 10

# Web search (Jina — requires JINA_API_KEY)
python3 skills/deep-research/scripts/web_scraper.py \
  --query "your web query" --engine jina --max-results 10

# Web search (DuckDuckGo — free, no key required)
python3 skills/deep-research/scripts/web_scraper.py \
  --query "your web query" --engine duckduckgo --max-results 10

# Read a specific URL (Jina Reader — free)
python3 skills/deep-research/scripts/web_scraper.py \
  --url "https://example.com/article"

# Semantic Scholar: follow citations from a known paper
python3 skills/deep-research/scripts/scholarly_api.py \
  --citations PAPER_ID --limit 5

# Semantic Scholar: get references of a known paper
python3 skills/deep-research/scripts/scholarly_api.py \
  --references PAPER_ID --limit 5
```

### Step 1b — Run scripts and normalise

For each result, append one row to `SOURCES.md`:

```
| ID   | Title / URL          | Node | Confidence | Date    | Key Claim              | Leads |
| S001 | [title](url)         | N01  | 8          | 2025-11 | "quoted claim"         | url   |
```

**Confidence scoring (1–10):**
- Peer-reviewed / official docs: +3
- Citation count > 50 or GitHub stars > 1k: +2
- Published within 24 months: +2
- Cross-verified by ≥2 independent sources: +2
- Blog post / news (no peer review): −1

### Step 1c — Update OUTLINE.md after each batch

1. Check if acceptance criterion for the node is met by new evidence.
2. If **yes** → mark node `[x] satisfied`.
3. If evidence reveals uncovered sub-aspects → add child nodes.
4. If node is redundant with a sibling → merge and mark merged node `[x]`.

### Step 1d — Lead-following (depth recursion)

If a source has Confidence ≥ 7 **and** a lead (URL or query) **and** current depth < D:
- Follow the lead as a new query targeting the same or a child node.
- Decrement remaining depth counter.

**Stopping signal:** All OUTLINE.md nodes `[x]` OR budget exhausted.

---

## Phase 2 — Gap Detection

1. Scan `OUTLINE.md` for `[ ]` (unsatisfied) and `[~]` (partial) nodes.
2. For each gap, check remaining budget.
3. If **budget remains** → reformulate and re-execute Phase 1 for that node only.
4. If **budget exhausted** → mark node `[!] no-evidence`; document as limitation in report.

**Query reformulation tactics (try in order):**
1. Synonym substitution: "multi-agent" → "distributed agents", "orchestration" → "coordination"
2. Scope broadening: "deep research LLM" → "iterative research agent"
3. Source type switch: academic → web → code
4. Reverse lookup: search for a system/paper that *solves the gap* rather than *describes it*

---

## Phase 3 — Evidence Binding Critic

**Do this BEFORE writing. No REPORT.md without this step.**

For each outline node:
1. Pull all `SOURCES.md` rows bound to that node.
2. Rank by: Confidence (desc), Recency (desc), cross-verification count (desc).
3. Select top-k: **k=3** (standard), **k=5** (deep).
4. Write binding to `EVIDENCE.md` (template: `assets/EVIDENCE_template.md`):

```markdown
## Node: N01 — <section title>

[E001] Source: <Title>, <URL>
       Confidence: 8 | Date: 2025-11
       Claim: "exact quoted or closely paraphrased text"
       Binds to: Section 1, paragraph on <topic>

[E002] ...
```

5. **Flag** any node with zero evidence at Confidence ≥ 6 → trigger Phase 2 re-search.

`EVIDENCE.md` is the **sole permitted citation source** during Phase 4. Nothing else.

---

## Phase 4 — Write Report

Compose `REPORT.md` section by section following `assets/REPORT_template.md`.

### Mandatory rules
- Every factual claim ends with `[Exxx]` citing the matching `EVIDENCE.md` entry.
- **No unbound claims** — if you cannot cite it, do not write it.
- Follow OUTLINE.md node order; skip nothing silently.
- Nodes marked `[!]` → write: *"This aspect was not covered by available sources."*

### Report structure

```markdown
# <Research Title>
**Date:** YYYY-MM-DD | **Preset:** <preset> | **D:** <n> | **B:** <n>

## Executive Summary
3–5 sentences. Key findings and actionable conclusions only.

## 1. <Top-level node title>
### 1.1 <Sub-node title>
<prose with [Exxx] citations>

## 2. ...

## Comparison Table
| System/Method | Key Metric | Source |
|---------------|------------|--------|

## Gap Analysis
Nodes marked [!] with brief explanation.

## References
All EVIDENCE.md sources, numbered to match [Exxx] tags.
```

---

## Context Management (Markovian)

To prevent context rot, maintain a **minimal active context** at each step:

| Always in context      | Per-step addition                          |
|------------------------|--------------------------------------------|
| `BRIEF.md`             | Last 10 rows of `SOURCES.md` (rolling)     |
| `OUTLINE.md` (current) | Current node's `EVIDENCE.md` block (Phase 4) |

Full `SOURCES.md` and `EVIDENCE.md` live on disk. Read only the node-relevant slice per step.
Pi's native compaction handles session pruning; this workflow makes compaction safe because
state is fully recoverable from files, not from message history.

---

## Quality Gate

Before delivering `REPORT.md`, score on 4 dimensions (1–10 each):

| Dimension        | Question                                              |
|------------------|-------------------------------------------------------|
| Source quality   | Avg Confidence of cited evidence ≥ 7?                 |
| Insight depth    | Do findings answer all acceptance criteria?           |
| Actionability    | Concrete conclusions, not vague summaries?            |
| Compression      | Every sentence carries information, no padding?       |

Compute **geometric mean**. If < 6.5 → re-research the lowest-scoring dimension before delivery.

---

## File Manifest

| File              | Phase | Purpose                                        |
|-------------------|-------|------------------------------------------------|
| `BRIEF.md`        | 0     | Research goal, preset, scope                   |
| `OUTLINE.md`      | 0→1→2 | Hierarchical checklist + satisfaction state    |
| `SOURCES.md`      | 1     | Normalised evidence store (all search results) |
| `EVIDENCE.md`     | 3     | Ranked, node-bound citations                   |
| `REPORT.md`       | 4     | Final output                                   |

### Scripts (`scripts/`)

| Script | Purpose | Dependencies |
|--------|---------|-------------|
| `scholarly_api.py` | Semantic Scholar search, citations, references | `requests` (optional) |
| `github_search.py` | GitHub repo/code search, README extraction | `requests` (optional) |
| `web_scraper.py` | Tavily/Jina web search, Jina URL reader | `tavily-python` (optional for Tavily) |
| `requirements.txt` | Python dependencies | — |

Install: `pip3 install -r scripts/requirements.txt`

Templates: `assets/` — copy to your working directory before starting.

---

## References

- RhinoInsight: arXiv:2511.18743 (Lei, Si, Wang et al., DeepLang AI / Tsinghua, Nov 2025)
- Static-DRA: arXiv:2512.03887 | STORM: arXiv:2402.14207 | WebWeaver: arXiv:2509.13312
- Ablation: VCM+EAM combined = +3.17 score vs baseline; each module ~+1.7 individually
- See [VCM/EAM Reference](references/vcm-eam-reference.md) for algorithm detail
