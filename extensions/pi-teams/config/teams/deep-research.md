---
schemaVersion: 2
id: "deep-research"
name: "Deep Research Council"
description: "Rigorous research pipeline enforcing citation audits and adversarial critique based on RhinoInsight principles."
protocol: "debate"
prompts:
  generation.system: "debate/generation/system"
  critique.system: "debate/critique/system"
  critique.template: "debate/critique/template"
  synthesis.system: "debate/synthesis/system"
  synthesis.template: "debate/synthesis/template"
agents:
  - role: "member"
    subagent: "deep_research_explorer"
    model: "openai-codex/gpt-5.5"
    label: "Explorer Node"
  - role: "critic"
    subagent: "deep_research_verifier"
    model: "openai-codex/gpt-5.5"
  - role: "synthesis"
    subagent: "deep_research_synthesis"
    model: "openai-codex/gpt-5.5"
---

A RhinoInsight-inspired deep research team. The Explorer acquires and normalises evidence into `sources/manifest.json`. The Verifier destroys unsupported claims and ranks evidence (EAM Stage 2). The Synthesis node assembles the final report using only verified facts with inline citations.
