# Skills Landscape Research — 2026-03-29

## What We Have

```
skills/
├── get-weather
├── planning
├── red-team
├── research-expert
└── skill-creator
```

## What's Out There

### 🏆 Anthropic Official (`anthropics/skills`) — 17 skills

Mostly **document/design** focused: docx, pdf, pptx, xlsx, canvas-design, frontend-design, mcp-builder, webapp-testing, etc. Not much research utility for us — we'd only want:

- **`skill-creator`** — but we already have our own

Full list: algorithmic-art, brand-guidelines, canvas-design, claude-api, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing, xlsx

### 🔬 K-Dense Scientific Skills (`K-Dense-AI/claude-scientific-skills`) — ~180+ skills

This is the goldmine. Research-relevant highlights:

| Skill | What it does |
|---|---|
| **`arxiv-database`** | Search arXiv via Atom API — keyword, author, category, PDF download |
| **`literature-review`** | Systematic lit reviews across PubMed, arXiv, bioRxiv, Semantic Scholar |
| **`research-lookup`** | Routes queries to Parallel Chat API or Perplexity sonar-pro |
| **`perplexity-search`** | Web search via Perplexity/OpenRouter with citations |
| **`hypothesis-generation`** | Structured hypothesis formulation from observations |
| **`scientific-brainstorming`** | Open-ended research ideation |
| **`scientific-critical-thinking`** | Evidence evaluation using GRADE/Cochrane frameworks |
| **`openalex-database`** | Citation counts, impact metrics |
| **`pubmed-database`** | Biomedical literature |
| **`scientific-writing`** | Academic paper writing |

⚠️ **Caveats:**
- `research-lookup` needs `PARALLEL_API_KEY` + `OPENROUTER_API_KEY`
- `perplexity-search` needs an OpenRouter key
- Many skills are science/bio-heavy — not all are general-purpose

### 🛡️ Trail of Bits (`trailofbits/skills`) — 37 security plugins

Interesting for security work. Could complement our `red-team` skill:

- `variant-analysis` — find code variants of known vulns
- `semgrep-rule-creator` / `semgrep-rule-variant-creator`
- `static-analysis`
- `supply-chain-risk-auditor`
- `entry-point-analyzer`
- `constant-time-analysis`
- `property-based-testing`

### ⚡ obra/superpowers — 13 dev workflow skills

Meta-development patterns, not research per se:

- `test-driven-development`
- `systematic-debugging`
- `writing-plans` / `executing-plans`
- `dispatching-parallel-agents`
- `verification-before-completion`
- `subagent-driven-development`

### 📋 Other Notable Repos

- **`alirezarezvani/claude-skills`** — 192 skills across engineering, marketing, product, compliance, C-level advisory
- **`Jeffallan/claude-skills`** — 66 full-stack dev skills
- **`travisvn/awesome-claude-skills`** — Curated list / directory of everything
- **`SawyerHood/dev-browser`** — Browser automation skill
- **`expo/skills`** — Expo mobile dev skills
- **`shadcn/ui`** — Component context + pattern enforcement

## Recommendations

### High Priority — Clone & Cherry-Pick

1. **`K-Dense-AI/claude-scientific-skills`** — Pull in:
   - `arxiv-database` (no API key needed, uses public Atom API)
   - `literature-review` (integrates multiple databases)
   - `perplexity-search` (needs OpenRouter key but very useful)
   - `hypothesis-generation`
   - `scientific-brainstorming`
   - `openalex-database` (citation/impact metrics, open API)

2. **`trailofbits/skills`** — Pull in security plugins to augment `red-team`:
   - `static-analysis`
   - `variant-analysis`
   - `supply-chain-risk-auditor`

### Medium Priority — Reference

3. **`anthropics/skills`** — Clone for reference; grab `skill-creator` to compare with ours

### Low Priority — Watch

4. **`obra/superpowers`** — Good dev workflow ideas but overlaps with our `planning` skill
5. **`alirezarezvani/claude-skills`** — Broad but shallow; scan for gems

## Next Steps

- [ ] Clone K-Dense repo and import selected research skills
- [ ] Clone Trail of Bits repo and import security skills
- [ ] Adapt imported skills to our SKILL.md format if needed
- [ ] Set up OpenRouter API key for perplexity-search
- [ ] Test imported skills end-to-end
