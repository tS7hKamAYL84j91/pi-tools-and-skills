# Knowledge Base

## Findings

- Fusion panels already execute concurrently with `Promise.all`; reducing panel count lowers cost and tail risk but does not produce a linear wall-clock improvement.
- Built-in Fusion currently uses three heavyweight panel models and a heavyweight judge, then returns structured analysis for an outer model to synthesize.
- Fusion copies complete panel outputs into the judge prompt without an explicit total input budget.
- Fusion overloads `limits.maxLoops` as panel count even though the public schema describes it as a research-loop control.
- Navigator is already a single model call. Its meaningful latency levers are model choice, reasoning/output bounds, automatic context size, and avoiding an additional outer synthesis turn.
- Deterministic team session mode enriches prompts with up to five recent turns and 4,000 characters regardless of topology.
- Team progress currently reports only one current node even while multiple Fusion panels run.
- Team progress uses a seven-line widget refreshed every second; cancellation requires copying a run ID.
- `team-overlay.ts` reloads the team registry through `teamDescriptionLines()` inside the browser render closure.
- Existing provider override plumbing can carry generation parameters, but output/reasoning caps require provider-shape tests.
- Live Fusion diagnosis on 2026-07-12 showed the Codex transport rejects `max_output_tokens`; `openai-codex/gpt-5.5` succeeds without that injected field, so model availability is not the root cause.
- A schema-valid Fusion fallback is not evidence of a valid judge run. Promotion metrics must exclude degraded runs and report judge/node health separately.

## Decisions

- Use one shared `fast | balanced | thorough` profile surface with protocol-specific mappings.
- Select Fast model defaults from measured latency and quality results.
- Keep explicit model overrides authoritative and avoid silent substitutions.
- Make the Fusion judge produce both a user-facing answer and structured diagnostics.
- Keep at least two provider-diverse panels for Fusion Fast.
- Keep the stateless child-process architecture unless measurement proves startup cost material.
- Use event-driven progress updates and a timer only for visible elapsed time.
- Add no-ID cancellation for the latest active run.
- Remove registry/filesystem reads from render closures.
- Keep Balanced as default until opt-in live benchmark records meet the protocol-specific gates.
- Use displayed custom messages for deterministic team results so a completed judge/reviewer answer does not trigger an extra LLM turn.
- Map canonical `maxTokens` at the provider payload boundary: Google `maxOutputTokens`, OpenAI Responses `max_output_tokens`, OpenAI-compatible chat `max_tokens`.
- Do not add a generic reasoning-effort override until supported provider payload shapes can be represented and tested safely.

## Reusable Code Patterns / API Usage

- Use native pi TUI `SettingsList` and `SelectList` components for profile and model configuration.
- Custom components containing `Input` must implement `Focusable` and propagate focus for IME support.
- Cache render output by width/state and invalidate after state or theme changes.
- Trigger `tui.requestRender()` after interactive state changes.
- Preserve child cancellation through existing `AbortSignal` propagation to `spawnRuntimeChildProcess()`.

## Anti-Patterns to Avoid

- Persistent RPC/warm-agent infrastructure before profiling proves process startup is a bottleneck.
- Starting the judge before all selected panels complete.
- Adding summarizer or multiple-judge calls to a latency-sensitive path.
- Calling a one-model route “Fusion”.
- Assuming two panels are one-third faster than three when panels run concurrently.
- Provider-specific generation fields without payload-shape tests.
- Filesystem, registry, or peer reads inside TUI render closures.
