---
schemaVersion: 2
id: "llm-council"
name: "LLM Council"
description: "High-stakes architecture, public API, persistence, security, or strategy review where disagreement is valuable."
protocol: "debate"
prompts:
  generation.system: "debate/generation/system"
  critique.system: "debate/critique/system"
  critique.template: "debate/critique/template"
  synthesis.system: "debate/synthesis/system"
  synthesis.template: "debate/synthesis/template"
agents:
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/glm-5.2:cloud"
    label: "Cheradenine Zakalwe"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/kimi-k2.7-code:cloud"
    label: "Diziet Sma"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/minimax-m3:cloud"
    label: "Flere-Imsaho"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/nemotron-3-ultra:cloud"
    label: "Djan Seriy Anaplian"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/deepseek-v4-pro:cloud"
    label: "DeepSeek Pro Diversity"
  - role: "critic"
    subagent: "debate_critic"
  - role: "synthesis"
    subagent: "debate_synthesis"
    model: "ollama/glm-5.2:cloud"
---

Default built-in team for the existing multi-model debate workflow. Use when tradeoffs should be debated before synthesis, not as a rubber stamp for trivial edits.

Model-routing policy: use a diverse Ollama council (`glm-5.2`, `kimi-k2.7-code`, `minimax-m3`, `nemotron-3-ultra`, plus `deepseek-v4-pro` for reviewer diversity) with `glm-5.2` synthesis. This reflects the Principal-authorized EO Ollama routing decision of 2026-06-20.
