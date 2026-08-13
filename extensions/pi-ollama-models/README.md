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

Then run `pi`. Normal sync status appears as `ollama: synced N`; a notification is shown only when the discovered model inventory changes or sync fails. If synced models are missing from the picker, run `/reload`.

The extension executes Ollama only through an approved absolute path. Set `PI_OLLAMA_COMMAND` to an absolute executable whose basename is exactly `ollama`, or leave it unset to try only `/usr/local/bin/ollama` and `/usr/bin/ollama`. If none is executable, sync is skipped. PATH, `which`, the current directory, and project-local bare commands are never used for resolution.

## Tool

- `pi_ollama_sync_models`
  - `dryRun:true` discovers and reports without writing.
  - Trusted operator env overrides: `PI_OLLAMA_MODELS_PATH`, `PI_OLLAMA_COMMAND`.
  - Deprecated `modelsPath` and `ollamaCommand` fields remain accepted as ignored compatibility input. They cannot change the output path, and caller-provided commands are never executed.

## What this does NOT do

- Does not install, start, stop, or configure Ollama itself.
- Does not change non-`ollama` providers in `models.json`.
- Does not store real credentials or send model inventory to a network service.
- Does not guarantee the model picker refreshes until pi reloads provider config.

## Security

- `PI_OLLAMA_COMMAND` must be an absolute executable path with basename `ollama`; relative and bare names are rejected.
- Without an override, only fixed standard absolute candidates are considered. PATH and workspace resolution are never used.
- `models.json` is written atomically (temp + rename) with mode `0o600`.
- Parse failures throw rather than overwriting the existing config blindly.
- No credentials are stored; the API key is the placeholder `ollama`.

## Notes

The sync happens at pi session start/reload, but the model picker may need one more reload if pi reads `models.json` before extensions run. This extension keeps the registry file current without changing CoAS scripts or storing credentials, and keeps routine success feedback in the status slot to avoid startup notification noise.