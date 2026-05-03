---
schemaVersion: 2
id: "pair-coding"
name: "Pair Coding"
description: "Bounded Driver/Navigator implementation, review, and fix workflow."
protocol: "pair-coding"
prompts:
  navigatorBrief.system: "pair-coding/navigator-brief/system"
  navigatorBrief.template: "pair-coding/navigator-brief/template"
  driverImplementation.system: "pair-coding/driver-implementation/system"
  driverImplementation.template: "pair-coding/driver-implementation/template"
  navigatorReview.system: "pair-coding/navigator-review/system"
  navigatorReview.template: "pair-coding/navigator-review/template"
  driverFix.system: "pair-coding/driver-fix/system"
  driverFix.template: "pair-coding/driver-fix/template"
agents:
  - role: "navigator_brief"
    subagent: "pair_coding_navigator_brief"
    model: "ollama/glm-5.1:cloud"
  - role: "driver_implementation"
    subagent: "pair_coding_driver_implementation"
    model: "openai-codex/gpt-5.5"
  - role: "navigator_review"
    subagent: "pair_coding_navigator_review"
    model: "ollama/glm-5.1:cloud"
  - role: "driver_fix"
    subagent: "pair_coding_driver_fix"
    model: "openai-codex/gpt-5.5"
maxFixPasses: 1
---

Built-in team for the existing automated PAIR mode.
