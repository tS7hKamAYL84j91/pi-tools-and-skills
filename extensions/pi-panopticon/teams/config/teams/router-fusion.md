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
    model: "ollama/glm-5.2:cloud"
  - role: "panel"
    subagent: "fusion_panel"
    model: "ollama/kimi-k2.7-code:cloud"
  - role: "panel"
    subagent: "fusion_panel"
    model: "ollama/minimax-m3:cloud"
  - role: "panel"
    subagent: "fusion_panel"
    model: "ollama/nemotron-3-ultra:cloud"
  - role: "judge"
    subagent: "fusion_judge"
    model: "ollama/nemotron-3-ultra:cloud"
  - role: "synthesis"
    subagent: "fusion_synthesis"
    model: "ollama/glm-5.2:cloud"
  - role: "fallback"
    subagent: "fusion_panel"
    model: "ollama/gemma4:26b"
---

Built-in internal fusion team. Use only for prompts where a bounded multi-model panel and judge are worth the extra calls. Panel tools are disabled by default; do not use for secrets or private session data.

Model-routing policy: use GLM/Kimi/MiniMax/Nemotron for diverse panel coverage, Nemotron or GLM for judging/synthesis, and Gemma4 only as bounded local/private fallback.
