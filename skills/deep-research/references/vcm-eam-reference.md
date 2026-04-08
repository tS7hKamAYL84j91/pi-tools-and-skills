# VCM/EAM Algorithm Reference

Detailed algorithm descriptions extracted from RhinoInsight (arXiv:2511.18743).

---

## Verifiable Checklist Module (VCM)

### Problem it solves
Standard research planning generates macro-structure (section names) without specifying
**acceptance criteria**. Without acceptance criteria, "done" is undefined, causing agents
to drift or under-research sections.

### Algorithm

```
Input: query q, scope s0
Output: refined checklist C1, hierarchical outline O1

1. Generate C0 = {ci0} from q:
   - One check per major sub-goal
   - Each check has: scope, definitions, acceptance criterion

2. Critic evaluation of C0:
   - Flag: ambiguous acceptance criteria
   - Flag: unbounded scope ("everything about X")
   - Flag: missing dependency ordering
   - Flag: duplicate or overlapping checks

3. Plan intents Z0 = plan(q, ci0, s0):
   - Resolve ambiguous checks by narrowing scope
   - Merge duplicates, split compound checks
   - Order by dependency and importance

4. Produce C1 = critic(C0, Z0)
5. Build O1 = hierarchical outline from C1:
   - Sections ← top-level checks
   - Subsections ← sub-checks
   - Each node: bound checks, inclusions, exclusions, dependency order

Output: (C1, O1)
```

### Key insight
Satisfaction = "acceptance criterion met", NOT "we searched for it".
This prevents the "unclear plan → incorrect actions" failure mode that degrades
all prior iterative research systems.

---

## Evidence Audit Module (EAM)

### Problem it solves
Context rot: as search iterations accumulate, irrelevant content dilutes reasoning.
Evidence binding prevents draft synthesis from citing unvetted raw search output.

### Stage 1: Search → Memory → Outline Update

```
At each search step t:
  Rt ← search results

  Normalise N(Rt):
    - Add fields: source_id, timestamp, confidence, source_type

  Structure S(N(Rt)):
    - Classify each result by outline node (which check does it address?)

  Persist P(S(N(Rt))):
    - Append to evidence store E
    - E_{t+1} = E_t ∪ P(S(N(Rt)))

  Update outline O_t:
    - Summarise evidence cluster per node
    - Compare against node acceptance criterion
    - If criterion met → mark [x]
    - If new sub-aspects found → add child nodes
    - If redundant with sibling → merge
```

### Stage 2: Evidence Binding Critic

```
Stopping condition: all nodes [x] OR budget exhausted

For each node n in O*:
  E_n ← {e ∈ E : e.node = n}

  Rank E_n by:
    1. relevance to acceptance criterion
    2. confidence score (peer review, citation count, recency)
    3. cross-verification count (how many sources confirm this claim)

  Select top-k (k=3 standard, k=5 deep):
    - Must have confidence ≥ 6
    - Must directly address node's acceptance criterion

  Bind each selected evidence to:
    - Specific section + paragraph in draft
    - Explicit citation ID [Exxx]

  Flag: nodes with zero qualifying evidence → re-search trigger
```

### Markovian workspace reconstruction

At each step t, active context = Wt:

```
Wt = G(q, s_{t-1}, a_{t-1}, o_{t-1})

Where:
  q          = original query (always)
  s_{t-1}    = state snapshot (OUTLINE.md + last 10 SOURCES.md rows)
  a_{t-1}    = last action taken (which script, which query)
  o_{t-1}    = last observation (search results summary, not full text)
```

Full history is NOT in active context. State `s_t` is self-contained:
- Completed checklist items
- Active unsatisfied nodes
- Experience log (what was tried, what failed)
- Structured information (SOURCES.md slice)

This enables full recovery from state alone, making pi's native compaction safe.

---

## Extended ReAct Loop

RhinoInsight extends standard ReAct (Thought → Action → Observation):

| Component        | Role                                                          |
|------------------|---------------------------------------------------------------|
| `thought τt`     | Internal reasoning: analyze workspace, identify gaps, plan 4-8 strategies |
| `action thought ãt` | Just-in-time rationale: why this tool, what gap it closes  |
| `action code at` | Executable params: query string, file path, script name      |
| `observation ot` | Raw tool output: grouped by source, with timestamps + IDs    |
| `state st`       | Authoritative snapshot: completed items, active checklist, experience, evidence |

The split of action into motivational (ãt) and execution (at) layers makes each move
auditable against the checklist.

---

## Benchmark Context

**DeepResearch Bench (RACE framework, Gemini 2.5 Pro judge):**

| System              | RACE Score |
|---------------------|------------|
| DoubaoResearch      | 44.34      |
| Claude Deep Research| 45.00      |
| OpenAI Deep Research| 46.45      |
| Gemini-2.5-Pro DR   | 49.71      |
| **RhinoInsight**    | **50.92**  |

**Ablation (DeepConsult benchmark):**

| Config       | Score | Δ vs baseline |
|--------------|-------|---------------|
| No VCM, No EAM | 3.65 | —           |
| VCM only     | 5.31  | +1.66         |
| EAM only     | 5.45  | +1.80         |
| VCM + EAM    | 6.82  | **+3.17**     |

The +3.17 combined gain exceeds the sum of individual gains (+3.46 in win% terms).
Both modules are individually beneficial; combining them is essential.

---

## Prior Art Comparison

| System       | Iterative Outline | Verifiable Checklist | Evidence Binding | Context Pruning |
|--------------|:-----------------:|:--------------------:|:----------------:|:---------------:|
| STORM        | ❌                | Implicit topics       | ❌               | ❌              |
| Static-DRA   | ❌                | D×B params only       | ❌               | ❌              |
| WebWeaver    | ✅                | ❌                    | ❌               | Partial         |
| GPT Researcher| ❌               | ❌                    | ❌               | ❌              |
| **RhinoInsight** | ✅            | ✅ with critic         | ✅ Stage 2       | ✅ Markovian    |

Key gaps filled vs prior systems:
- STORM's multi-perspective Q&A ≈ VCM but lacks acceptance criteria
- WebWeaver's dynamic outline = EAM Stage 1 without normalise/structure/persist pipeline
- No prior system has the evidence-binding critic (EAM Stage 2)
- No prior system has explicit Markovian workspace for context pruning

---

## References

- RhinoInsight: arXiv:2511.18743 (Lei, Si, Wang et al., DeepLang AI / Tsinghua, Nov 2025)
- STORM: arXiv:2402.14207 (Shao et al., Stanford, NAACL 2024)
- Static-DRA: arXiv:2512.03887 (Prateek, Dec 2025)
- WebWeaver: arXiv:2509.13312 (Li et al., Sep 2025)
- Agentic Deep Research survey: arXiv:2506.18959 (Zhang et al., Jun 2025)
