---
schemaVersion: 1
id: "pair-consult"
name: "Pair Consult"
description: "Lightweight Navigator consultation for focused review and design feedback."
topology: "pair"
protocol: "consult"
agents:
  - role: "navigator"
    subagent: "pair_navigator_consult"
    model: "ollama/qwen3.5:cloud"
---

Built-in team for lightweight Navigator consultation.
