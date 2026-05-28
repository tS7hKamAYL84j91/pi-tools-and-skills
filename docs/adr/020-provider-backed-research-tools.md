# ADR 020: Gated provider-backed research tools

Date: 2026-05-28
Status: proposed

## Context

T-195 added `pi-research-tools`, an additive dry-run extension that registers `arxiv_search`, `semantic_scholar`, `semantic_scholar_search`, `github_search`, and `web_read` with typed parameters and JSON output. The next migration step is provider-backed execution, but live network calls, credentials, runtime artifact persistence, and old deep-research behavior removal are intentionally gated.

Current repo evidence still holds:

- there is no standalone `research-expert` skill/script in this repo;
- research-expert-like workflow policy lives in `pi-teams` deep-research Explorer/Verifier/Synthesis prompts;
- `lib/research-tool-fixtures.ts` declares metadata, provenance, artifact, and result-semantics expectations;
- `pi-research-tools` is dry-run only and does not write `sources/manifest.json`.

## Decision

Provider-backed research tools must be introduced behind explicit gates and provider adapters. The registered tool names may stay stable, but behavior promotion from dry-run to live providers requires approval after the gates below pass.

### Interface boundary

Provider adapters must implement a narrow boundary:

- accept validated tool inputs from `pi-research-tools`;
- own provider-specific HTTP/API details, rate-limit interpretation, and response normalization;
- return a provider-neutral result envelope with `status`, `results` or `content`, `sourceId`, `error`, `retryable`, `provider`, and redaction metadata;
- never expose raw credential values, request headers, full session context, or unbounded provider payloads;
- accept an `AbortSignal` and bounded timeout policy;
- be testable with fake providers and fixtures without live network calls.

### Result and error model

Provider-backed results use the existing status vocabulary: `success`, `partial`, `failure`, and `empty`.

Error categories must normalize provider failures into stable strings such as:

- `credential_missing`
- `rate_limited`
- `timeout`
- `network_error`
- `provider_error`
- `invalid_response`
- `policy_blocked`

`retryable` must be explicit and conservative. Rate limits, timeouts, and transient network errors may be retryable; credential, policy, malformed input, and invalid response failures are not retryable by default.

### Credentials and privacy

Credentials must be provided only through approved pi/provider configuration or environment names documented per provider. Tools must never echo credential values. Logs and tool output must redact sensitive-looking keys, tokens, auth headers, cookies, and private query parameters.

Provider requests must send only the minimum required input: query, bounded limit, approved URL/source identifier, and provider-specific safe metadata. Do not send full conversation/session content.

### Rate limits and observability

Provider adapters must report normalized rate-limit errors and avoid hidden retry loops. Tool details may include bounded observability fields: provider name, elapsed milliseconds, result count, retryability, redaction count, and artifact write status. They must not include raw HTTP headers containing secrets or unbounded response bodies.

### Artifact persistence gate

Runtime artifact persistence remains disabled until a separate decision defines atomic writes, retention, redaction, manifest schema, sourceId ownership, rollback, and verifier readback behavior. `persistToWorkspace` may only request/declare intent until that gate is approved.

### Deep-research migration gate

Deep-research prompts can be updated to prefer registered tools only after provider-backed behavior passes fake-provider tests, network-disabled tests, reviewer approval, and rollback validation. Existing prompts must not be deleted or narrowed before compatibility is proven.

## Consequences

- T-575 implementation should start with fake providers and provider contract tests.
- Live provider code must be opt-in and network-disabled by default in tests.
- Old research behavior remains until registered tools are validated end-to-end.
- Any credential or persistence implementation needs reviewer approval before merge.

## Follow-up implementation steps

1. Add provider adapter interfaces and fake-provider contract tests.
2. Add provider-specific adapters one at a time behind explicit configuration.
3. Add network-disabled tests proving default test runs cannot call live services.
4. Add credential redaction tests for every adapter.
5. Define artifact persistence ADR before any runtime writes.
6. Update deep-research prompts after provider-backed compatibility gates pass.

## Rollback

Provider-backed changes must be reversible by disabling provider configuration and falling back to dry-run envelopes. If live behavior fails validation, keep `pi-research-tools` registered but dry-run-only.
