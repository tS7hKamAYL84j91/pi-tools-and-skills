---
name: fire-review
description: Dan Ward F.I.R.E. repo/codebase review skill. Use when asked for a FIRE review, Fast/Inexpensive/Restrained/Elegant assessment, lightweight codebase quality review, PASS/BLOCKED repo verdict, or CoAS/pi-style release readiness review.
---

# FIRE Review

Run a Dan Ward F.I.R.E. review of a repository, package, feature slice, or codebase change. Optimize for a small, evidence-backed verdict rather than a broad audit framework.

F.I.R.E. means:

- **Fast** — easy to understand, validate, ship, and recover.
- **Inexpensive** — low operational, cognitive, dependency, and maintenance cost.
- **Restrained** — minimal surface area; no speculative framework, premature abstraction, or hidden scope creep.
- **Elegant** — coherent boundaries, simple composition, readable names, clear docs, and graceful failure modes.

## Triggers

Use this skill for requests containing or implying:

- `FIRE review`, `F.I.R.E. review`, `Dan Ward`, `Fast Inexpensive Restrained Elegant`.
- Repo/codebase quality review with a requested `PASS`, `BLOCKED`, `GO`, `NO-GO`, or release-readiness verdict.
- CoAS/pi review artifacts, especially prior `t-*-fire-review.md`, `quality review`, `clean architecture`, `KISS`, `YAGNI`, or `DRY` reports.

## Guardrails

- Stay inside the user-provided scope. Do not read secrets, keychains, raw session logs, private scratch, ignored auth files, `.workers`, or excluded state files.
- Prefer current repository evidence. Use prior FIRE artifacts as context only when they are in allowed paths or git history and are not private scratch.
- Do not mutate code during a review unless the user explicitly asks for fixes. If cleanup is necessary, keep it mechanical and separately reported.
- Do not invent test results. Mark unchecked areas as `not checked` with a reason.
- Do not block on perfection. FIRE tolerates known follow-ups when they are bounded, documented, and not release-critical.

## Workflow

1. **Frame scope and baseline**
   - Record target repo/path, branch, commit or diff range, and user exclusions.
   - Capture dirty working tree state before review with `git status --short --branch`.
   - If owner changes are present, avoid staging/committing unless explicitly authorized.

2. **Collect bounded evidence**
   - Inspect architecture docs, README/package metadata, tests, entrypoints, and touched files.
   - Search for prior allowed FIRE/review artifacts, for example `rg -n "FIRE|F\\.I\\.R\\.E\\.|Dan Ward|KISS|YAGNI|DRY" docs skills tests`.
   - Check hotspots only as needed: large files, dependency changes, public API surfaces, persistence, subprocess/network behavior, and test gaps.

3. **Assess each FIRE lens**
   - Fast: navigation, validation speed, recovery path, local feedback loops.
   - Inexpensive: dependencies, services, storage, operational burden, maintenance cost.
   - Restrained: scope discipline, public surface area, speculative features, compatibility promises.
   - Elegant: boundary fit, naming, composition, error semantics, docs/test alignment.

4. **Assign verdict**
   - Use the verdict semantics below. Tie every non-PASS to concrete evidence.
   - Separate release blockers from follow-ups.

5. **Verify**
   - Run the minimum checks in the verification guidance, plus project-specific checks that are quick and relevant.
   - Include command outcomes in the report.

6. **Report**
   - Use the output template. Keep the report concise and evidence-bound.

## Evidence checklist

Collect enough evidence to support the verdict:

- [ ] Target branch/commit/diff and dirty-tree status.
- [ ] In-scope files/docs/tests reviewed.
- [ ] Prior allowed review artifacts considered, or reason none were used.
- [ ] Public API/CLI/tool/config/persistence surfaces touched or confirmed unchanged.
- [ ] Dependency, network, subprocess, filesystem, and secret-handling changes checked when relevant.
- [ ] Test/validation commands and results.
- [ ] Release blockers, no-go conditions, and follow-ups separated.

## Verdict semantics

- **PASS** — no release blocker found; follow-ups are optional or routine.
- **PASS with follow-ups** — shippable, but bounded issues should be tracked after release.
- **CONDITIONAL PASS** — shippable only if listed conditions are completed first; conditions must be small and verifiable.
- **BLOCKED** — unsafe to ship or merge. Use for secret exposure, data loss risk, broken core checks, unclear ownership with conflicting changes, missing required evidence, or architecture/security regression.
- **NOT REVIEWED** — scope or evidence was insufficient; do not imply readiness.

Severity labels: `Critical`, `High`, `Medium`, `Low`, `Positive`.

## Verification guidance

Minimum commands for repository changes:

```bash
git diff --check
rg -n "(api[_-]?key|secret|token|password|passwd|private[_-]?key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY)" <touched-files-or-dirs>
```

Add relevant project checks when quick to identify, for example:

- Skill-only changes: validate `SKILL.md` frontmatter, name/directory match, trigger description, and required review sections.
- TypeScript/code changes: run the repo's focused tests, then `npm run check`/`npm test` when practical.
- Docs-only changes: run markdown-sensitive tests if present and `git diff --check`.

Use bounded secret scans over touched paths, not broad crawls through excluded private directories.

## Output template

```markdown
# FIRE Review — <target>

Date: <YYYY-MM-DD>
Verdict: <PASS | PASS with follow-ups | CONDITIONAL PASS | BLOCKED | NOT REVIEWED>
Baseline: <branch/commit/diff/status>
Scope: <included paths>; Exclusions: <excluded paths>

## Executive summary
<2-5 bullets with the core finding and release recommendation.>

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | <evidence-backed finding> | <PASS/etc.> |
| Inexpensive | <evidence-backed finding> | <PASS/etc.> |
| Restrained | <evidence-backed finding> | <PASS/etc.> |
| Elegant | <evidence-backed finding> | <PASS/etc.> |

## Material findings

| Finding | Severity | Evidence | Recommendation |
|---|---:|---|---|
| <finding> | <severity> | <path/command> | <action> |

## No-go conditions

- <conditions that would change the verdict to BLOCKED, or `None found`.>

## Follow-ups

- <bounded non-blocking work, or `None`.>

## Verification

- `<command>` — <pass/fail/not run + reason>.

## Final status

<One sentence: DONE/PASS, CONDITIONAL, BLOCKED, or handoff needed.>
```
