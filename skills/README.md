# Skills

Reusable instruction sets that agents load on demand. Each skill lives in its own directory with a `SKILL.md` that pi discovers at startup.

Skills are activated by matching the `description` field against the task context. When a skill activates, the agent reads `SKILL.md` for instructions, then loads referenced files as needed.

## Available Skills

### `planning`
**Manus-style persistent planning using PLAN.md / PROGRESS.md / KNOWLEDGE.md.**

Enables long-term context across multi-step tasks. Initialises a `planning/` directory with three markdown files:
- `PLAN.md` — goals, tasks, and completion status (`[x]` checkboxes)
- `PROGRESS.md` — chronological action log (timestamped entries)
- `KNOWLEDGE.md` — discovered constraints, decisions, and reusable findings

Use when: the task spans multiple sessions, involves multiple agents, or requires tracking incremental progress.

→ [planning/SKILL.md](planning/SKILL.md)

---

### `research-expert`
**Academic and technical researcher: arXiv, Semantic Scholar, Jina web reader, GitHub search.**

Provides shell scripts for:
- `arxiv_search.sh` — arXiv paper search (free, no API key)
- `semantic_scholar.sh` — citations + metadata (rate-limited; set `SEMANTIC_SCHOLAR_API_KEY` for higher limits)
- `web_read.sh` — any URL → clean markdown text via Jina Reader
- `github_search.sh` — repo search by topic (set `GITHUB_TOKEN` for higher limits)

Five-phase workflow: Scope → Search → Deep Read → Synthesise → Report.

Use when: researching academic papers, evaluating frameworks, comparing implementations, or producing structured reports with citations.

→ [research-expert/SKILL.md](research-expert/SKILL.md)

---

### `red-team`
**Autonomous security assessment: vulnerability identification, MITRE ATLAS threat simulation, mitigation planning.**

Three-phase protocol:
1. **Reconnaissance** — enumerate tools, memory stores, and attack surface
2. **Exploitation simulation** — map to MITRE ATLAS techniques; generate benign PoCs
3. **Mitigation planning** — produce Mitigation Strategy objects (name, CVSS, patch, verification test)

Focuses on agentic AI risks: excessive agency, context poisoning (`AML.T0085`), tool invocation exfiltration (`AML.T0086`), indirect prompt injection.

**Safety policy: strict non-destructive** — no file deletion, no service disruption.

Use when: auditing agent tools for over-permissioning, assessing LLM pipelines for injection risks, or generating remediation artifacts.

→ [red-team/SKILL.md](red-team/SKILL.md)

---

### `skill-creator`
**Create new skills or improve existing ones.**

Guides the agent through: capturing intent, scaffolding the directory, writing frontmatter and instructions, and adding supporting scripts/references/assets. Includes the full Agent Skills specification and a validation checklist.

Use when: a user asks to create a skill, modify a skill, or when the right skill for a task doesn't exist yet.

→ [skill-creator/SKILL.md](skill-creator/SKILL.md)

---

## Skill Structure

Each skill directory contains:

```
skill-name/
├── SKILL.md          # Required: YAML frontmatter + instructions
├── scripts/          # Optional: executable helpers
├── references/       # Optional: detailed docs (loaded on demand)
└── assets/           # Optional: templates and static files
```

The `description` field in `SKILL.md` frontmatter determines when the skill activates — write it to include trigger contexts, not just what the skill does.
