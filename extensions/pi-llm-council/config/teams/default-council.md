---
schemaVersion: 1
id: "default-council"
name: "Default Council"
description: "General high-stakes reasoning and architecture review."
topology: "council"
protocol: "debate"
agents:
  - role: "member"
    subagent: "council_generation_member"
    model: "openai-codex/gpt-5.5"
    label: "Member 1"
  - role: "member"
    subagent: "council_generation_member"
    model: "google-gemini-cli/gemini-3.1-pro-preview"
    label: "Member 2"
  - role: "member"
    subagent: "council_generation_member"
    model: "ollama/qwen3.5:cloud"
    label: "Member 3"
  - role: "member"
    subagent: "council_generation_member"
    model: "ollama/glm-5.1:cloud"
    label: "Member 4"
  - role: "critic"
    subagent: "council_critic"
  - role: "chairman"
    subagent: "council_chairman"
    model: "openai-codex/gpt-5.5"
---

Default built-in team for the existing multi-model council debate workflow.
