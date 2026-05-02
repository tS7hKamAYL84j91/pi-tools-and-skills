---
schemaVersion: 1
id: "pair-coding"
name: "Pair Coding"
description: "Bounded Driver/Navigator implementation, review, and fix workflow."
topology: "pair"
protocol: "pair-coding"
agents:
  - "pair_navigator_brief"
  - "pair_driver_implementation"
  - "pair_navigator_review"
  - "pair_driver_fix"
driverModel: "openai-codex/gpt-5.5"
navigatorModel: "ollama/glm-5.1:cloud"
maxFixPasses: 1
---

Built-in team for the existing automated PAIR mode.
