---
schemaVersion: 2
id: "deep-research"
name: "Deep Research Council"
description: "Bounded evidence-gathering pipeline for research tasks that need source collection, verifier gap feedback, and synthesis."
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
    model: "ollama/minimax-m3:cloud"
    label: "Explorer Node"
  - role: "verifier"
    subagent: "deep_research_verifier"
    model: "ollama/nemotron-3-ultra:cloud"
  - role: "synthesis"
    subagent: "deep_research_synthesis"
    model: "ollama/glm-5.2:cloud"
---

A RhinoInsight-inspired iterative deep research team. Use it only when evidence gathering and independent verification loops are needed. The Explorer acquires and normalises evidence into `sources/manifest.json`. The Verifier acts as Evidence Auditor and Gap Detector, either emitting `VERIFIED_COMPLETE` or targeted follow-up gaps. The protocol repeats bounded Explorer/Verifier loops before the Synthesis node assembles the final report using only verified facts with inline citations.

Model-routing policy: MiniMax explores and summarises evidence, Nemotron verifies/provenance-checks, and GLM synthesises. For code-heavy specialist research, route a separate subcall to Kimi rather than making Deep Research a code executor.
