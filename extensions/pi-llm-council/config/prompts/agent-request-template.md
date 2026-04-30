---
id: agentRequestTemplate
title: "Live-agent request envelope template"
scope: agent
stage: request
kind: template
---
<{{requestTag}} deliberation_id="{{deliberationId}}" stage="{{stage}}" member="{{memberLabel}}">
{{framing}}
Timeout: {{timeoutSeconds}}s — late replies are discarded.

{{systemPrompt}}

Question:
{{prompt}}

When ready, reply via agent_send to "{{ourAgentName}}". Your reply MUST contain the exact line:
{{replyTag}}
Everything after that line is treated as your answer.
</{{requestTag}}>
