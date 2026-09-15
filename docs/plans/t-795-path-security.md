# T-795 Automations Path Security Plan

## Threat model

Automations file helpers receive absolute paths derived from workspace, schedule, approval, and archive state. An attacker who can modify a workspace or Automations tree may replace an existing directory/file with a symlink (or another filesystem object) so a helper follows it outside its authorized root. The control must enforce both lexical containment and filesystem containment, including symlinks in existing and newly-created path components. Directory enumeration must not silently accept symlink entries.

Native `lstat` checks identify substitutions without following links; `realpath` checks provide a resolved-location containment check for paths whose components exist. Creation paths must be checked after recursive creation as well as before it. This remains a defense against ordinary filesystem tampering, not a complete elimination of races between validation and use.

## Compatibility and API choices

- Preserve the existing exported helper names and signatures, including `ConfinedStore` methods and Automations path helpers.
- Preserve authorized external workspace roots: an external root is valid when its `.pi/automations/workspace.env` chain is real, non-symlinked, and authorized, even though it is outside `automationsHome`.
- Keep lexical `pathInside`/`assertInside` confinement; resolved containment is an additional check, never a replacement.
- Use native `node:fs/promises` `lstat`/`realpath` semantics. Do not add dependencies or change settings/providers.
- No material public API/security decision is expected; therefore no ADR is required unless implementation discovers otherwise.

## Exact scope

1. Audit and harden `lib/confined-store.ts` and the Automations adapter in `extensions/pi-automations/store.ts`.
2. Add regression-first tests covering existing and newly-created symlink components, non-regular substitutions, external-workspace authorization, archive compaction, and public helper API stability.
3. Produce implementation evidence in `docs/reports/t-795-implementation.md`.
4. Touch architecture documentation only if a narrowly necessary model update is required.

## Acceptance criteria

- Lexical escapes remain rejected.
- Existing symlink components and symlink final targets are rejected before reads, writes, existence checks, deletion, directory creation, and metadata/stat operations.
- Newly-created recursive components are verified and cannot be accepted as symlink/non-directory substitutions.
- Non-regular objects are rejected for file operations and directory operations where their kind is required; directory listing rejects symlink entries.
- Authorized external workspaces continue to open and archive-compaction continues to write under their own root.
- Existing exported signatures remain source-compatible.
- Focused security tests, `npm run check`, `npm test`, diagnostics/lint where available, diff review, and bounded redacted secret scan are recorded.
- No commit, push, merge, Kanban mutation, provider/settings change, or cross-repo write is performed; patch stops for independent security review.

## Review plan

Run the new focused Automations security tests first and capture the pre-fix failure. Then run the full quality gates and inspect the complete diff for confinement regressions, external-root compatibility, and race limitations. Independent security review is required before integration.
