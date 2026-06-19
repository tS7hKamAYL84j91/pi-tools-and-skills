# pi-ollama-models

User-installable extension that refreshes pi's Ollama model registry from the local `ollama` CLI on `session_start` (which also runs after extension reloads).

It mirrors the useful part of CoAS Quartermaster/setup behavior: discover `ollama list`, inspect each model with `ollama show`, and write the `ollama` provider entry in `~/.pi/agent/models.json` while preserving other providers.

## Behavior

- Provider: `ollama`
- Base URL: `http://localhost:11434/v1`
- API: `openai-completions`
- API key placeholder: `ollama`
- Context window: parsed from `ollama show`; conservative fallback `8192` to avoid context overflow on small local models
- Max output tokens: `4096`
- Reasoning/vision/Qwen compatibility: inferred from model ID and `ollama show`
- Other providers in `models.json` are preserved; only the `ollama` provider entry is replaced

## Install

```bash
make setup-package PACKAGE=pi-ollama-models
```

Then run `pi`. If pi read `models.json` before extensions run, one more reload refreshes the picker.

## Tool

- `pi_ollama_sync_models`
  - `dryRun:true` discovers and reports without writing.
  - `modelsPath` and `ollamaCommand` allow fixture/sandbox testing.
  - Env overrides: `PI_OLLAMA_MODELS_PATH`, `PI_OLLAMA_COMMAND`.

## What this does NOT do

- Does not install, start, stop, or configure Ollama itself.
- Does not change non-`ollama` providers in `models.json`.
- Does not store real credentials or send model inventory to a network service.
- Does not guarantee the model picker refreshes until pi reloads provider config.

## Security

- The `ollama` executable name is validated; arbitrary commands are rejected.
- `models.json` is written atomically (temp + rename) with mode `0o600`.
- Parse failures throw rather than overwriting the existing config blindly.
- No credentials are stored; the API key is the placeholder `ollama`.

## Notes

The sync happens at pi session start/reload, but the model picker may need one more reload if pi reads `models.json` before extensions run. This extension keeps the registry file current without changing CoAS scripts or storing credentials.