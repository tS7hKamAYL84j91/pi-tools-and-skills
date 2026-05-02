---
schemaVersion: 1
id: "default-council"
name: "Default Council"
description: "General high-stakes reasoning and architecture review."
topology: "council"
protocol: "debate"
agents:
  - "council_generation_member"
  - "council_critic"
chair: "council_chairman"
memberModels:
  - "openai-codex/gpt-5.5"
  - "google-gemini-cli/gemini-3.1-pro-preview"
  - "ollama/qwen3.5:cloud"
  - "ollama/glm-5.1:cloud"
chairmanModel: "openai-codex/gpt-5.5"
---

Default built-in team for the existing multi-model council debate workflow.
