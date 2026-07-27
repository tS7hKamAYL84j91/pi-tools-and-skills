Status: active

# FIRE Review — Semgrep OSS scan-step proposal (t-819)

## Scope

- Target: add a bounded Semgrep OSS static-analysis scan to the agent-generated-code review gates in `pi-tools-and-skills`.
- Trigger: Principal-directed ADAPT-not-ADOPT from `briefs/2026-07-26-ai-code-security-harnesses-briefing.md`; automate the #40 (path traversal) / #43 (command injection) class caught manually in the Jules PR review.
- Boundaries:
  - Semgrep OSS only (no platform/seat/cadence/model/residency change).
  - Custom rules for our stack (TypeScript/Python): injection, path traversal, command injection, unsafe eval, secret literals.
  - Findings feed existing FIRE/Navigator/council review stack; no new verdict authority.
  - `red-team` skill remains the threat-modeling layer.
  - No code leaves the environment; no secrets stored.

## Baseline

- Branch: `main` at `8733709`.
- Working tree clean.
- Current gates: `npm run check` (Biome, TypeScript, knip, type-coverage), `npm test`, CI `security` job (`npm audit`, gitleaks).
- No existing SAST step.

## FIRE Assessment

### Fast

- Semgrep OSS installs via `npm`/`pip` in seconds and runs in milliseconds to a few seconds on our codebase.
- Custom rules live in-repo; findings are local and deterministic.
- CI integration is a single new step in the existing `security` job.
- Recovery path is simple: fix pattern, suppress with `nosemgrep` + justification, or disable a noisy rule.

**Verdict: PASS**

### Inexpensive

- OSS CLI: zero licensing/seat cost.
- One devDependency (or optional system dependency if we prefer `npx semgrep`).
- Rules are YAML; no external SaaS, no upload bandwidth, no persistent scanner infrastructure.
- Maintenance cost is one ruleset file + one wrapper script; updates are git-tracked.

**Verdict: PASS**

### Restrained

- Scope is exactly the scan step, custom rules, and CI wiring.
- No platform adoption, no broad Semgrep registry dependence, no blocking of human review.
- Does not change public tool API, runtime behavior, or review verdict semantics.
- Boundaries are explicit in the ADR.

**Verdict: PASS**

### Elegant

- Fits our existing gate architecture: a new `npm run security:semgrep` command consumed by CI and review checklists.
- Composes with Biome/lint/typecheck rather than replacing them.
- Custom rules express our actual high-risk patterns instead of importing a generic noisy ruleset.
- Wrapper script can output JSON/SARIF for downstream consumption without over-engineering.

**Verdict: PASS**

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Semgrep OSS taint analysis is shallow vs. CodeQL commercial | Accept for v1; custom rules cover the specific #40/#43 class. Deep cases go to red-team/manual review. |
| False positives block PRs | Inline `nosemgrep` with required comment justification; noisy rules can be disabled after FIRE review. |
| Dependency/adds install time | Pin `semgrep` devDependency version; CI uses npm cache. |
| Scope creep toward full platform | Bound in ADR; expansion requires Gravitas/Principal sign-off per instruction. |

## Follow-ups

1. Draft small ADR `docs/adr/037-semgrep-oss-scan-step.md` for the gate addition.
2. Implement `scripts/semgrep-scan.mjs`, `rules/custom/*.yaml`, `npm run security:semgrep`, and CI wiring.
3. Add a one-line FIRE/Navigator checklist item: "Run `npm run security:semgrep` and attach findings."
4. Run the scan on current `main` and triage any findings before enabling `--error` hard-fail.

## Verification

- `npm run check` and `npm test` continue to pass.
- Architecture fitness passes with no exemptions (no file >300 lines, no cross-extension imports, no temporal-coupling violations).
- New scan step runs successfully in CI and locally.

## Verdict

**PASS** — bounded, low-cost, fits existing gates, no platform adoption, no runtime change.

Recommended next step: draft ADR-037 and implement.
