---
schemaVersion: 2
id: "navigator"
name: "Navigator"
description: "Smallest built-in team for focused bounded review of correctness, scope, tests, docs, or design feedback."
protocol: "consult"
prompts:
  navigator.system: "consult/navigator/system"
agents:
  - role: "navigator"
    subagent: "consult_navigator"
    model: "ollama/qwen3.5:cloud"
---

Built-in team for lightweight Navigator consultation. Prefer this route when one skeptical reviewer is enough.
