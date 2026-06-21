---
schemaVersion: 2
id: "fusion-analysis"
name: "Fusion Analysis"
description: "Internal multi-model fusion analysis: bounded panel and judge return structured JSON analysis (consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence). The caller synthesizes the final answer."
protocol: "fusion-analysis"
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
---

Built-in fusion analysis team. Returns structured analysis only; the outer model synthesizes the final answer. Use when OpenRouter-style multi-model deliberation is desired without external routing dependencies. Panel tools are disabled by default; do not use for secrets or private session data.
