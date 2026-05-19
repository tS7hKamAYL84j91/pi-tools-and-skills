---
schemaVersion: 2
id: "deep-research"
name: "Deep Research Council"
description: "Rigorous research pipeline enforcing citation audits and adversarial critique based on RhinoInsight principles."
protocol: "research"
maxLoops: 2
prompts:
  generation.system: "debate/generation/system"
  critique.system: "debate/critique/system"
  critique.template: "debate/critique/template"
  synthesis.system: "debate/synthesis/system"
  synthesis.template: "debate/synthesis/template"
agents:
  - role: "explorer"
    subagent: "deep_research_explorer"
    model: "openai-codex/gpt-5.5"
    label: "Explorer Node"
  - role: "verifier"
    subagent: "deep_research_verifier"
    model: "openai-codex/gpt-5.5"
  - role: "synthesis"
    subagent: "deep_research_synthesis"
    model: "openai-codex/gpt-5.5"
---

A RhinoInsight-inspired iterative deep research team. The Explorer acquires and normalises evidence into `sources/manifest.json`. The Verifier acts as Evidence Auditor and Gap Detector, either emitting `VERIFIED_COMPLETE` or targeted follow-up gaps. The protocol repeats bounded Explorer/Verifier loops before the Synthesis node assembles the final report using only verified facts with inline citations.
