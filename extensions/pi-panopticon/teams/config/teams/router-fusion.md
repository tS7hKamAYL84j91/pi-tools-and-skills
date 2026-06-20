---
schemaVersion: 2
id: "router-fusion"
name: "Router Fusion"
description: "Conservative internal multi-model fusion team: bounded panel, judge analysis, synthesis, and fallback without external routing dependencies."
protocol: "fusion"
maxLoops: 3
prompts:
  judge.system: "fusion/judge/system"
agents:
  - role: "panel"
    subagent: "fusion_panel"
    model: "openai-codex/gpt-5.5"
  - role: "panel"
    subagent: "fusion_panel"
    model: "google/gemini-3.1-pro-preview"
  - role: "panel"
    subagent: "fusion_panel"
    model: "google/gemini-2.5-pro"
  - role: "judge"
    subagent: "fusion_judge"
    model: "openai-codex/gpt-5.5"
  - role: "synthesis"
    subagent: "fusion_synthesis"
    model: "openai-codex/gpt-5.5"
  - role: "fallback"
    subagent: "fusion_panel"
    model: "google/gemini-2.5-flash"
---

Built-in internal fusion team. Use only for prompts where a bounded multi-model panel and judge are worth the extra calls. Panel tools are disabled by default; do not use for secrets or private session data.
