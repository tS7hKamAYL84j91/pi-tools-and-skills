# T-701 pi-fusion adoption assessment

Status: active

## Recommendation

Reuse `pi-fusion` only as an optional project-local/user-approved extension, not as a replacement for `pi-teams`.

Default path: pilot with project-local `.pi/fusion.json`, `panelTools: "none"`, low panel size/token caps, and explicit user approval before `pi install npm:pi-fusion`. Do not force-enable it globally.

## Evidence inspected

- npm package: `pi-fusion@0.7.4`
- License: MIT
- Runtime: Node `>=22.19.0`
- Dependencies: none; peers are pi packages plus `typebox`
- pi manifest: loads `./src/index.ts` directly via pi/jiti
- Source files inspected from npm tarball, without installing into the shared runtime
- Visible local model routes checked with `pi --list-models`

Visible candidate models at assessment time included:

- `openai-codex/gpt-5.5`
- `openai-codex/gpt-5.4`
- `google/gemini-3.1-pro-preview`
- `google/gemini-2.5-pro`
- `ollama/kimi-k2.7-code:cloud`

No direct `anthropic/*` models were visible in this environment.

## Security and behavior notes

- Third-party extension code executes inside pi; installation requires trust in upstream.
- Config loading checks project-local `.pi/fusion.json` only when the project is trusted, then falls back to user-level `~/.pi/agent/fusion.json`.
- Registered commands/tools: `/fusion`, `/fusion-setup`, `/fusion-status`, `/fusion-report`, `/fusion-init`, and tool `fusion`.
- Invoking model can supply only prompt and limited context controls; panel/judge/tool settings are user config/session state.
- Panel tools default to `none`.
- Read-only panel tools are `read`, `grep`, `find`, `ls`; mutating tools add `bash`, `edit`, `write` and require consent, with serialized panel execution.
- Tool output is truncated before returning into panel loops.
- Recent conversation context defaults to `none`; if enabled it can send recent user/assistant text to all panel/judge providers.
- No source evidence of lifecycle hooks exfiltrating secrets by themselves; main privacy risk is intentionally sending prompts, optional context, and optional file/tool outputs to multiple providers.

## Fit with existing stack

`pi-fusion` complements but overlaps `pi-teams`:

- `pi-teams` / `team_run llm-council`: structured debate protocol, explicit team invocation, better for architecture/public API/security decisions, governed in this repo.
- `pi-fusion`: lightweight in-session multi-model deliberation tool and slash commands, better for ad hoc second opinions inside normal pi use.
- Existing model fallback remains separate; fusion is not a reliability fallback because it multiplies provider calls and can partially fail.

Keep `pi-teams` as the canonical CoAS review protocol. Treat fusion as an optional convenience layer for humans, not public contract or automation dependency.

## Safe pilot config candidate

Create only after approval:

```json
{
  "panel": [
    "openai-codex/gpt-5.5",
    "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-pro"
  ],
  "judge": "openai-codex/gpt-5.5",
  "maxPanelModels": 3,
  "maxPanelOutputTokens": 1200,
  "maxCompletionTokens": 2000,
  "temperature": 0.2,
  "panelTools": "none",
  "maxToolCalls": 4
}
```

Privacy caveat: every fusion run sends the prompt to each panel model and the judge. Do not use on secrets, private session logs, key material, or proprietary data unless every selected provider is approved for that data.

If file evidence is needed, prefer a separate explicit prompt with sanitized excerpts. If enabling tools later, use `"readonly"` only and expect file contents/tool results to be sent to panel providers.

## Proposed install path after approval

Project-local pilot preferred if pi supports project package installation in this workspace; otherwise use user-level only after explicit approval:

```bash
# inspect first, no install
npm view pi-fusion version license dependencies peerDependencies engines repository dist.tarball --json
npm pack pi-fusion@0.7.4 --dry-run

# after approval only
pi install npm:pi-fusion
mkdir -p .pi
$EDITOR .pi/fusion.json
pi
/fusion-status
/fusion "Assess this architecture trade-off: ..."
```

Do not set `/fusion on` globally for CoAS work. Use `/fusion <prompt>` for one-off forced runs, or leave mode `available` with conservative config.

## Follow-ups

- Ask upstream/project owner whether project-local package installation is supported and preferred for pi packages.
- If adoption becomes regular, pin the npm version and add an internal allowlist/policy note for acceptable providers/data classes.
- Consider internal equivalent only if we need auditable governance, deterministic budgets, or tight integration with `pi-teams` protocols.
