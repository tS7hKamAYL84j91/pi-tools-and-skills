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
    model: "ollama/deepseek-v4-flash:cloud"
---

Built-in team for lightweight Navigator consultation. Prefer this route when one skeptical reviewer is enough.

Model-routing policy: default Navigator to `ollama/deepseek-v4-flash:cloud` to keep the reviewer on a different model family from primary EO agents. This reduces shared-failure modes while using DeepSeek Flash's 1M-token context and speed for bounded large-context critique. Do not use Navigator as the default code author or long-form strategy owner; route those to executor/council roles instead.
