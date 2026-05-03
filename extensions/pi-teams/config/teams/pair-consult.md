---
schemaVersion: 2
id: "pair-consult"
name: "Pair Consult"
description: "Lightweight Navigator consultation for focused review and design feedback."
protocol: "consult"
prompts:
  navigator.system: "pairNavigatorConsultSystem"
agents:
  - role: "navigator"
    subagent: "pair_navigator_consult"
    model: "ollama/qwen3.5:cloud"
---

Built-in team for lightweight Navigator consultation.
