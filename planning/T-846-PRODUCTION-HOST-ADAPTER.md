# T-846 Production Host Adapter

## Target

Provide a narrow production host entrypoint that constructs Panopticon through the reviewed explicit factory, accepts only a Q-injected `LiveBoostHostInjection`, and exposes immutable identity evidence for the reviewed Q control contract.

## Non-goals

- No provider construction, credential handling, model/default/config/scheduler mutation, or live dispatch.
- No manifest, settings, active-session, or dirty-worktree mutation.
- No Q control-record write path.

## Construction contract

The adapter will require:

- A `LiveBoostHostInjection` containing only `bridge`, logical `QBoostControlReference`, and shutdown choice.
- An expected contract path and SHA-256 identity supplied by the host and compared to the reviewed adapter identity.
- A structurally valid logical Q reference (`q-boost`, canonical keys, bounded non-negative integer versions, non-empty bounded enablement id).

It will return the `ExtensionFactory` created by `createPanopticonExtension(injection)`, immutable inspection evidence, and an idempotent lifecycle-only `shutdown()` that delegates the selected restore choice to the injected bridge at most once. Q revocation remains the bridge's read-only control subscription. Invalid path/hash/reference/shutdown choice fails before extension construction. Construction neither calls bridge methods nor reaches a provider.

## Acceptance tests

1. Valid disabled bridge/reference creates the explicit injected extension and reports the immutable contract identity without invoking bridge/provider methods.
2. Hash/path/reference failures throw before factory creation.
3. A command-invocation test proves the injected factory reaches its disabled bridge, while the normal default factory remains inert.
4. A cross-path lifecycle test proves extension shutdown and host shutdown invoke the underlying bridge shutdown once.
5. Source-level tests prove no config/default/provider/scheduler/credential/Q-mutation seam.
5. `npm run check`, focused host-adapter tests, full suite (except documented docs-hygiene baseline), and independent review pass.

## Review

Q owns deployment. This repository delivers only the reviewed host construction boundary and test evidence; Q must use a clean pinned worktree and disabled bridge until separately authorized.
