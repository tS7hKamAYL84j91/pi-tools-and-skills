---
schemaVersion: 2
id: "default-debate"
name: "Default Debate"
description: "General high-stakes reasoning and architecture review."
protocol: "debate"
prompts:
  generation.system: "debate/generation/system"
  critique.system: "debate/critique/system"
  critique.template: "debate/critique/template"
  synthesis.system: "debate/synthesis/system"
  synthesis.template: "debate/synthesis/template"
agents:
  - role: "member"
    subagent: "debate_generation_member"
    model: "openai-codex/gpt-5.5"
    label: "Member 1"
  - role: "member"
    subagent: "debate_generation_member"
    model: "google-gemini-cli/gemini-3.1-pro-preview"
    label: "Member 2"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/qwen3.5:cloud"
    label: "Member 3"
  - role: "member"
    subagent: "debate_generation_member"
    model: "ollama/glm-5.1:cloud"
    label: "Member 4"
  - role: "critic"
    subagent: "debate_critic"
  - role: "synthesis"
    subagent: "debate_synthesis"
    model: "openai-codex/gpt-5.5"
---

Default built-in team for the existing multi-model debate workflow.
