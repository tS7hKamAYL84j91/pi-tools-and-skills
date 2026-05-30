---
schemaVersion: 2
id: "navigator"
name: "Navigator"
description: "Lightweight Navigator consultation for focused review and design feedback."
protocol: "consult"
prompts:
  navigator.system: "consult/navigator/system"
agents:
  - role: "navigator"
    subagent: "consult_navigator"
    model: "ollama/qwen3.5:cloud"
---

Built-in team for lightweight Navigator consultation.
