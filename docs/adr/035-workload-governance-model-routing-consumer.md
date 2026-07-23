# ADR 035: Workload Governance / Model Routing Consumer in pi-coas

## Status

Accepted (council-reviewed, APPROVE-WITH-CHANGES resolved)

## Context

`.pi/settings.json` declares a `coasProfile` block with workload-governance fields:

- `modelRoutingPolicy` — preferred models by use case (`localPrivateFallback`, `localTriageOnly`, `gmReviewedSimpleCode`, `navigator`, `teamDefaults`, `fallbackRules`).
- `localOnlyTriggers` — tags that mark input as secret-adjacent, credential-bearing, PII, workspace-private, etc.
- `advisoryFallbackChain` — ordered list of local models to use when input is tagged private.
- `escalationThresholds` — operational counters (provider failures, validation failures, etc.).
- `requiresLocalOnlyForPrivateInput: true` — policy flag.

The manifest comment states: "a runtime consumer in pi-coas must apply these values." Today `extensions/pi-coas` reads `coas.coasHome` only and consumes none of the governance/policy fields. Schedules, spawned workers, and GM orchestration therefore have no deterministic, code-level way to route private input to a local-only advisory model or to escalate when no local model is available.

This ADR proposes the smallest runtime consumer that makes the declared policy actionable without overriding the user's root model or changing residency/schedule cadence.

## Decision

### Scope

1. Add a governance configuration loader in `extensions/pi-coas/governance.ts` that reads `coasProfile.modelRoutingPolicy`, `localOnlyTriggers`, `advisoryFallbackChain`, `escalationThresholds`, and `requiresLocalOnlyForPrivateInput` using project-first `.pi/settings.json` discovery (matching `resolveCoasConfig`), falling back to global `~/.pi/agent/settings.json`, via the existing `lib/pi-settings.ts` helper. Config is read on each call (no cache) for v1.
2. Add a pure classifier `classifyInput(text, triggers)` that returns:
   - `classification`: `"private" | "public"`
   - `matchedTriggers`: string[]
   - `reason`: one-line rationale
   - Substring matching is intentionally conservative (fail-safe): benign strings may be over-classified as private, which only routes them to a local model; it never causes private input to be sent to a cloud model.
3. Add a model resolver `resolveModel(classification, intent?, chain?, policy?)` that returns:
   - `resolvedModel`: the selected model string or `undefined`
   - `source`: `"advisoryFallbackChain" | "localPrivateFallback" | "policyIntent" | "none"`
   - `escalate`: `true` when no local model can be selected
   - `fallbackChain`: the chain considered
   - For `classification: "public"`, resolve by `intent` using the table below; source is `"policyIntent"`.
   - For `classification: "private"`, use the first entry of `advisoryFallbackChain` (source `"advisoryFallbackChain"`); if the chain is empty, fall back to `modelRoutingPolicy.localPrivateFallback` (source `"localPrivateFallback"`); if that is also absent, set `escalate: true` and `source: "none"`.
   - The `advisoryFallbackChain` is assumed by configuration convention to contain only local model identifiers. v1 does not validate liveness or provider; operator maintains this invariant. A future ADR may add a registry/identifier check.
4. Expose the consumer as a single new model-callable observability/debug tool: `coas_governance_resolve` (advisory only).
   - Parameters: `input` (string), `intent?` (enum: `triage | code | navigator | review | unknown`).
   - Returns: classification, resolvedModel, source, escalate flag, reason, fallbackChain.
   - Does **not** mutate the active session model. It is an inspection surface; the primary actuation path for schedules/agents is the internal `maybeGovernanceRoute(input, intent)` helper.
5. Add an internal utility `maybeGovernanceRoute(input, intent)` that schedule/spawn callers can consult before `spawn_agent` or model-sensitive work. In v1 it is a pure library with no automatic hook; concrete callers will be wired by a follow-up ADR after ADR-0008 schedule-delivery targeting is in place.
6. Escalation behavior when no local model is available:
   - Return `escalate: true` with `resolvedModel: undefined`.
   - Append a durable, non-secret alert to the active CoAS workspace CONTEXT.md via `coas_workspace_update` semantics.
   - If no workspace is active, write to a minimal governance log at `${COAS_HOME}/governance/escalation.log` with private permissions (mode `0o600`), directory `0o700`. The log entry contains no input text, only classification, source, intent, and escalation reason.
   - Never fall back to a cloud model for private input when `requiresLocalOnlyForPrivateInput` is true.
7. Thresholds: v1 uses escalation thresholds read-only. Repeated provider/validation failures are surfaced in resolution metadata so future threshold-triggered escalation can reuse the same schema (forward-compatibility note). Full threshold-triggered escalation is deferred until ADR-032 telemetry integration is complete.

### Non-decisions (explicitly out of v1)

- No automatic override of the user's active model (`model_select` events remain observational).
- No new provider, credential store, or model registry changes.
- No residency, schedule cadence, or root-model default changes.
- No swarm-scale failure machinery.

### Intent-to-policy mapping

| `intent` value | Public-input model source | Private-input fallback chain |
|---|---|---|
| `triage` | `modelRoutingPolicy.localTriageOnly` | `advisoryFallbackChain` → `localPrivateFallback` |
| `code` | `modelRoutingPolicy.gmReviewedSimpleCode` | `advisoryFallbackChain` → `localPrivateFallback` |
| `navigator` | `modelRoutingPolicy.navigator` | `advisoryFallbackChain` → `localPrivateFallback` |
| `review` | `modelRoutingPolicy.navigator` (review is a bounded consult) | `advisoryFallbackChain` → `localPrivateFallback` |
| `unknown` | `undefined` (no policy intent; caller uses default model) | `advisoryFallbackChain` → `localPrivateFallback` |

### API surface

```typescript
interface ModelRoutingPolicy {
  localPrivateFallback: string;
  localTriageOnly: string;
  gmReviewedSimpleCode: string;
  navigator: string;
  notes?: string;
  teamDefaults?: object;
  fallbackRules?: object;
}

interface GovernanceConfig {
  modelRoutingPolicy: ModelRoutingPolicy;
  localOnlyTriggers: string[];
  advisoryFallbackChain: string[];
  escalationThresholds: Record<string, number>;
  requiresLocalOnlyForPrivateInput: boolean;
}

interface InputClassification {
  classification: "private" | "public";
  matchedTriggers: string[];
  reason: string;
}

interface ModelResolution {
  resolvedModel?: string;
  source: "advisoryFallbackChain" | "localPrivateFallback" | "policyIntent" | "none";
  escalate: boolean;
  reason: string;
  fallbackChain?: string[];
}
```

Tool: `coas_governance_resolve` (advisory / observability only)

```json
{
  "input": "...",
  "intent": "triage"
}
```

Result includes `classification`, `resolvedModel`, `source`, `escalate`, `reason`, `fallbackChain`.

### Files changed

- New: `extensions/pi-coas/governance.ts` (loader, classifier, resolver)
- New: `extensions/pi-coas/governance-tools.ts` (tool registration + escalation side effects)
- Modify: `extensions/pi-coas/types.ts` (add `ModelRoutingPolicy`, `GovernanceConfig`, `InputClassification`, `ModelResolution` shapes)
- Modify: `extensions/pi-coas/tools.ts` (call `registerGovernanceTools`)
- Modify: `extensions/pi-coas/README.md` (document the tool and policy)
- New tests: `tests/coas/pi-coas-governance.test.ts`

### Required test coverage

- Classification: public input, private input, multiple triggers, empty input, case sensitivity, trigger substring boundaries.
- Resolution: each public intent source, empty `advisoryFallbackChain` → `localPrivateFallback`, absent `localPrivateFallback` → escalate, `requiresLocalOnlyForPrivateInput` enforcement (no cloud fallback for private input).
- Config loading: missing/malformed `coasProfile`, project `.pi/settings.json` vs global `~/.pi/agent/settings.json`, nested `modelRoutingPolicy` fields.
- Escalation safety: no input text in workspace or log records, no-workspace fallback to governance log.
- Tool shape: `coas_governance_resolve` returns advisory metadata only; no model mutation.

### Security / privacy

- The classifier matches substrings only; it does not log, persist, or transmit the classified input.
- Escalation records contain no input text, only classification result, resolution source, intent, and escalation reason.
- No cloud model is selected for private input when policy requires local-only; the `advisoryFallbackChain` is assumed by configuration convention to contain only local models.
- Substring triggers may over-classify benign input; this is fail-safe by design (routes to local, never to cloud).

## Consequences

- Schedules and agents can deterministically resolve private input to a local model.
- Empty fallback chains produce a visible escalation instead of silently using a default model.
- The consumer is advisory, preserving user model choice and avoiding root-model changes.
- Future ADRs can extend the consumer to auto-apply routes or integrate provider-failure telemetry.

## Related

- `.pi/settings.json` `coasProfile` section
- ADR-032: CoAS ephemeral scheduler telemetry
- ADR-034: Team speed profiles
- ADR-0008: Schedule delivery targeting guard (concrete caller for `maybeGovernanceRoute` will land after this)
- T-793 (cheap-worker routing)
- /swarm panopticon feature depends on cheap-worker routing.
