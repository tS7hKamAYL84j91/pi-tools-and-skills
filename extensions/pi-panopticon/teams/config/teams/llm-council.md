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
    model: "ollama/deepseek-v4-pro:cloud"
    label: "Cheradenine Zakalwe"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/qwen3.5:cloud"
    label: "Diziet Sma"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/kimi-k2.6:cloud "
    label: "Flere-Imsaho"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/minimax-m2.7:cloud"
    label: "Djan Seriy Anaplian"
  - role: "critic"
    subagent: "debate_critic"
  - role: "synthesis"
    subagent: "debate_synthesis"
    model: "openai-codex/gpt-5.5"
---

Default built-in team for the existing multi-model debate workflow. Use when tradeoffs should be debated before synthesis, not as a rubber stamp for trivial edits.
