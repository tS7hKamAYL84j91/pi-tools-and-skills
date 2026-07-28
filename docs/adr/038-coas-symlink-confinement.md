# ADR-038: CoAS filesystem symlink confinement

## Status

Accepted — llm-council recommendation adopted by GM on 2026-07-28.

## Context

T-795 identifies a path-traversal gap in CoAS filesystem helpers. `assertInside()` is lexical and does not prevent an allowed path from traversing a persisted symlink to a location outside its intended root. `assertNoSymlinkComponents(root, target)` exists but the primary file-operation helpers do not consistently invoke it.

Affected internal helpers include directory creation, optional/required file reads, atomic writes, file deletion, directory counting, and newest-file lookup. Schedule `.env` files also have raw read paths that bypass the existing helper layer.

Explicitly selected external workspaces remain supported only when they contain `.pi/coas/workspace.env`; the remediation must preserve that bounded compatibility without granting arbitrary filesystem access.

## Decision

Adopt an extension-internal scoped `ConfinedStore` with asynchronous static factories. The store binds one trusted root at construction and all methods accept existing absolute target paths, rejecting targets outside that root and any symlink component.

### Factories and roots

| Factory category | Trusted root | Validation |
| --- | --- | --- |
| CoAS home runtime | `config.coasHome` | Root itself must exist and not be a symlink. |
| Schedules/logs/locks | respective sub-root under `config.coasHome` | Validate every component from `config.coasHome` to the sub-root. |
| Managed workspaces | `workspaceRoot(config)` | Validate every component from `config.coasHome` to the workspace root. |
| Explicit external workspace | selected workspace directory | Reuse metadata authorization and reject a symlinked root or component. |

### Store behavior

- All methods guard with lexical root confinement plus `assertNoSymlinkComponents` before operating.
- Add `readRequiredFile` and route schedule `.env` reads through it.
- `removePrivateFiles` validates every target before removing any target.
- Directory-listing methods reject symlinked entries rather than silently filtering them.
- Remove unguarded helper exports after consumer migration; do not retain a dual unsafe API.
- No tool schema, user-visible runtime behavior, model routing, residency, or cadence changes.

## Consequences

### Positive

- Root selection is performed once at construction, avoiding missed or wrong per-call root parameters.
- Symlink escapes are rejected consistently across CoAS operations.
- Existing external workspace compatibility is constrained to explicit metadata authorization.
- Compile errors reveal any consumer left on the unsafe API after removal.

### Negative

- Factories require async root validation.
- Component checks introduce a residual time-of-check/time-of-use race; this ADR protects against persisted symlinks, not a concurrent attacker replacing filesystem entries mid-operation.
- A future hardening task may use `O_NOFOLLOW`/descriptor-relative operations where practical.

## Alternatives considered

| Alternative | Decision |
| --- | --- |
| Add a root parameter to every helper | Rejected — repeats security-critical root selection at every call site. |
| Keep old helpers and add guarded variants | Rejected — preserves an importable unsafe path. |
| Relative target-only API | Rejected — larger migration and path-join absolute-target pitfalls; guarded absolute paths fit existing call sites. |

## Migration

1. Add `ConfinedStore`, factories, root-chain validation, and unit tests.
2. Migrate schedule reads/writes/removals, including `.env` required reads.
3. Migrate status/log/lock and workspace consumers.
4. Remove legacy unguarded exports; compile errors are the migration gate.
5. Run full security regression matrix and quality gates.

## Validation

- Intermediate/final symlink rejection for read, write, delete, and listing operations.
- CoAS-home root-chain and external-workspace authorization/compatibility coverage.
- Mixed delete validates all paths before mutation.
- `npm run check`, `npm test`, and `npm run security:semgrep` pass with no exemptions.

## Council record

`llm-council`, 2026-07-28: unanimous preference for scoped confinement; ADR required. The council also required unconditional root-chain validation, required schedule-file reads, throw-on-symlink directory listings, and removal of legacy unsafe exports.
