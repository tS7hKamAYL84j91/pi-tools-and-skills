---
schemaVersion: 2
id: "pair-coding"
name: "Pair Coding"
description: "Bounded Driver/Navigator implementation, review, and fix workflow."
protocol: "pair-coding"
prompts:
  navigatorBrief.system: "pairNavigatorBriefSystem"
  navigatorBrief.template: "pairNavigatorBriefTemplate"
  driverImplementation.system: "pairDriverImplementationSystem"
  driverImplementation.template: "pairDriverImplementationTemplate"
  navigatorReview.system: "pairNavigatorReviewSystem"
  navigatorReview.template: "pairNavigatorReviewTemplate"
  driverFix.system: "pairDriverFixSystem"
  driverFix.template: "pairDriverFixTemplate"
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
