---
name: pi-model-selection
description: Verify pi-visible models first and route requests efficiently; do not assume provider aliases are interchangeable.
---


# pi-model-selection — Choosing the right pi model/provider route

> Verify pi-visible models first; do not assume provider aliases are interchangeable.

## Common operations

- List models visible to pi for a provider:
  `pi --list-models {{provider}}`

- Search for a specific model family:
  `pi --list-models {{search}}`

- Inspect custom providers/models config:
  `read ~/.pi/agent/models.json`

- Inspect default provider/model settings:
  `read ~/.pi/agent/settings.json`

## Patterns

- User asked for a specific provider:
  verify with `pi --list-models {{provider}}` first, then use that provider's canonical model ID

- Expensive/special model request:
  do a short smoke test first before relying on it for planning or multi-agent work

- Need direct Anthropic, not OpenRouter:
  prefer `anthropic/{{model-id}}` if `pi --list-models anthropic` shows it

## Gotchas

- `spawn_agent` can accept a model string that is syntactically valid but still fail operationally if the chosen route is wrong or unaffordable
- OpenRouter model names and direct provider model names are NOT interchangeable policy-wise, even when they refer to the same family
- `rpc_send success=true` only means the RPC command reached the agent; inspect agent output/session logs for provider-level model failures
- Check pi-visible models first instead of assuming from docs or memory
- If the user explicitly asks for a provider (e.g. Anthropic), do not silently route through another provider (e.g. OpenRouter)

## Examples

- Confirm direct Anthropic Opus availability:
  `pi --list-models anthropic | rg 'claude-opus-4-6'`

- Confirm whether a request is using OpenRouter instead:
  `pi --list-models claude-opus`
