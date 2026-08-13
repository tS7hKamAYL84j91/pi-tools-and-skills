# Team Result Artifact Ownership

## Goal

Remove Panopticon’s hidden dependency on `COAS_HOME` for team-run result artifacts and make the artifact root explicitly Panopticon-owned.

## Decision

Persist result artifacts beneath the existing user team runtime root (`~/.pi/agent/teams/results` by default, respecting configured user team roots where the current context makes that available). Do not write relative `team-results/` in the repository and do not consult CoAS-owned environment/state.

## Constraints

- Preserve artifact JSON schema, run ID naming, async delivery behavior, and `resultArtifactPath` claim-check.
- Use an explicit result-root resolver with safe run ID validation and private directory/file modes.
- Team runtime and async read must resolve the identical root from team/Panopticon configuration, never current repository root or `COAS_HOME`.
- Existing CoAS artifacts are not migrated automatically; no cross-owner reads.
- Update architecture docs and tests.
- No dependencies or fitness exceptions.

## Acceptance criteria

- Tests prove `COAS_HOME` does not affect team artifact paths, default writes are outside cwd, and configured user team root is honored if supported.
- Run IDs cannot escape the results root and symlinked result roots fail closed.
- Sync completion and async result read use the same path.
- Focused Teams tests, check/test/diff gates pass.
