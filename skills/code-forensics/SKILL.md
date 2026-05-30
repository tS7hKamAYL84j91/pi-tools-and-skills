---
name: code-forensics
description: "Git archaeology, hotspot analysis, temporal coupling, knowledge maps, and churn from git history. Use when asked to identify high-risk files, find hidden dependencies between files, discover who owns what code, measure code churn, or find stale/dead code. Trigger phrases include: 'git archaeology', 'hotspot', 'temporal coupling', 'knowledge map', 'who owns', 'churn analysis', 'stale code', 'bus factor', 'code forensics', 'analyze git history'."
---

# Code Forensics

Mine git history to reveal risk, ownership, hidden dependencies, and decay — without any external tools beyond `git` and standard Unix utilities.

Based on Adam Tornhill's *Your Code as a Crime Scene* methodology.

## Quick Start

```bash
cd /path/to/repo

# Find your riskiest files (high churn + high complexity)
bash scripts/hotspots.sh --since "6 months ago" --top 20

# Find files that always change together (hidden coupling)
bash scripts/temporal-coupling.sh --since "6 months ago"

# See who owns what (knowledge map / bus-factor)
bash scripts/knowledge-map.sh --since "12 months ago"

# Measure code churn (lines added/removed per file)
bash scripts/churn.sh --since "6 months ago"

# Find stale code (files not touched recently)
bash scripts/age-map.sh --top 30
```

## Scripts

| Script | Purpose | Key Insight |
|--------|---------|-------------|
| `hotspots.sh` | Churn × complexity matrix | Files that change often AND are large = highest risk |
| `temporal-coupling.sh` | Co-change frequency between file pairs | Files that change together are hidden dependencies |
| `knowledge-map.sh` | Primary author per file | Single-author files = bus-factor risk |
| `churn.sh` | Lines added + removed per file | High removal = refactoring; high addition = growth |
| `age-map.sh` | Days since last change per file | Untouched code = potentially stale or well-stabilised |

## Interpretation Guide

### Hotspot Matrix

```
                    HIGH complexity (lines)
                    ┌─────────────────────┐
HIGH churn          │  🔴 HOTSPOT         │  ← Fix these first
(change freq)       │  Risky, brittle     │
                    ├─────────────────────┤
LOW churn           │  🟡 Monitor         │  ← Growing complexity
                    │  Complex but stable │
                    └─────────────────────┘
```

Score = `changes × √lines`. Higher = more attention needed.

### Temporal Coupling

**Coupling % ≥ 80%** — These files are effectively one module. Consider merging.  
**Coupling % 30–79%** — Hidden dependency. Document or refactor.  
**Coupling % < 30%** — Coincidental. No action needed.

### Knowledge Map

Files where one author has > 80% of commits = **bus-factor risk**. If that person leaves, knowledge walks out the door.

### Age Map

- **< 30 days** — Actively developed
- **30–180 days** — Normal maintenance cycle
- **180–365 days** — Potentially stable or neglected
- **> 365 days** — Stale (bug trap) or well-stabilised (good)

## Workflow: Full Forensic Audit

```bash
cd your-repo

# 1. Find hotspots — where to focus
bash /path/to/skills/code-forensics/scripts/hotspots.sh --since "6 months ago" > hotspots.txt

# 2. Check if hotspots are also temporally coupled (double risk)
bash /path/to/skills/code-forensics/scripts/temporal-coupling.sh --since "6 months ago" > coupling.txt

# 3. Identify knowledge silos in hotspot files
bash /path/to/skills/code-forensics/scripts/knowledge-map.sh --since "12 months ago" > ownership.txt

# 4. Measure overall churn health
bash /path/to/skills/code-forensics/scripts/churn.sh --since "6 months ago" > churn.txt

# 5. Flag stale code for review
bash /path/to/skills/code-forensics/scripts/age-map.sh --top 50 > stale.txt
```

## Tips for Large Repos

- Add `--since "3 months ago"` to limit scope (all scripts accept this)
- `temporal-coupling.sh` caps commits at `--max-commits 500` to stay fast
- `knowledge-map.sh` processes only tracked files (`git ls-files`)
- All scripts write to stdout — pipe to files or `less -S` for wide output

## No External Dependencies

All scripts use only:
- `git log`, `git ls-files`, `git diff-tree`
- `awk`, `sort`, `uniq`, `grep`, `wc`, `date`, `head`

Works on macOS and Linux. No Python, Ruby, Go, or npm required.

## References

- *Your Code as a Crime Scene* — Adam Tornhill (2015)
- *Software Design X-Rays* — Adam Tornhill (2018)
- [code-maat](https://github.com/adamtornhill/code-maat) — Tornhill's reference implementation (Clojure)
- [CodeScene](https://codescene.com) — Commercial SaaS built on these ideas
