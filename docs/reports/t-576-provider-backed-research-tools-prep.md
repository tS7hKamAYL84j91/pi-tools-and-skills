# T-576 Provider-Backed Research Tools Preparation

Date: 2026-05-28
State: gated preparation only

## Summary

T-576 prepares the next provider-backed research-tools migration without enabling live providers, credentials, network calls, persistence, or deletion of existing deep-research behavior.

Artifacts:

- `docs/adr/020-provider-backed-research-tools.md` — proposed gated ADR.
- `extensions/pi-research-tools/provider-contract.ts` — provider-neutral result/error/redaction scaffolding.
- `tests/pi-research-tools-provider-contract.test.ts` — fake-provider/redaction/error-model tests.

## Migration plan

1. Keep T-195 dry-run tools as the rollback baseline.
2. Add provider adapters behind explicit configuration, one provider at a time.
3. Run provider adapters only through fake-provider tests first; default tests must remain network-disabled.
4. Add redaction and normalized error tests before any provider can return data to the model.
5. Decide artifact persistence separately before `persistToWorkspace` writes anything.
6. Update deep-research Explorer prompt tool guidance only after registered provider-backed tools pass compatibility and reviewer gates.
7. Delete or retire old prompt/skill behavior only after rollback has been exercised and Principal approval is recorded.

## Rollback plan

- Disable provider configuration and keep registered tools returning dry-run envelopes.
- Revert provider adapter files independently of dry-run registration.
- Preserve existing deep-research prompts until compatibility is proven.

## Gates for T-575

- Provider contract and fake-provider tests pass.
- No test path can perform live network calls by default.
- Credential source names are documented; credential values are never logged or returned.
- Rate-limit, timeout, provider error, invalid response, and policy-blocked errors normalize into stable categories.
- Redaction tests cover tokens, API keys, authorization headers, cookies, and sensitive URL query fields.
- Artifact persistence ADR is approved before runtime writes.
- Navigator/reviewer PASS before any material public behavior promotion.

## Out of scope for T-576

No live providers, no network/API calls, no credentials, no keychain access, no persistence, no destructive writes, no prompt deletion, and no old-skill removal.
