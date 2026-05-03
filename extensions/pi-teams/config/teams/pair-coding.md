---
schemaVersion: 1
id: "pair-coding"
name: "Pair Coding"
description: "Bounded Driver/Navigator implementation, review, and fix workflow."
topology: "pair"
protocol: "pair-coding"
agents:
  - role: "navigator_brief"
    subagent: "pair_navigator_brief"
    model: "ollama/glm-5.1:cloud"
  - role: "driver_implementation"
    subagent: "pair_driver_implementation"
    model: "openai-codex/gpt-5.5"
  - role: "navigator_review"
    subagent: "pair_navigator_review"
    model: "ollama/glm-5.1:cloud"
  - role: "driver_fix"
    subagent: "pair_driver_fix"
    model: "openai-codex/gpt-5.5"
maxFixPasses: 1
---

Built-in team for the existing automated PAIR mode.
