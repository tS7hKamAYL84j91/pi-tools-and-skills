# ADR-037: Semgrep OSS scan step for agent-generated code review gates

## Status

Proposed — pending FIRE/Navigator review (passed) and GM sign-off.

## Context

The Principal-directed security briefing retained in git history recommends an ADAPT-not-ADOPT posture for AI code security harnesses. For our internal agent-generated code, the recommendation is to add **Semgrep OSS as a lightweight, custom-rules scan layer** feeding our existing review stack, while continuing to use the `red-team` skill for threat modeling.

The immediate vulnerability class is the one caught manually in Jules PR review: #40 (path traversal) and #43 (command injection). Automating this class reduces reliance on human memory and lets FIRE/Navigator/council reviews focus on design and semantics.

## Decision

Add a bounded Semgrep OSS scan step to `pi-tools-and-skills`:

1. **Tooling**: Semgrep OSS CLI only. No platform, no SaaS upload, no seats, no code leaves the repo.
2. **Rules**: Custom YAML rules in `rules/custom/` targeting our TypeScript/Python stack:
   - command injection (shell string args, `shell: true`, template interpolation into commands)
   - path traversal before file operations
   - unsafe eval / dynamic code execution
   - injection sinks (SQL, shell, eval, unsafe deserialization)
   - hardcoded secret literals
3. **Runner**: `scripts/semgrep-scan.mjs` — thin wrapper around `semgrep --config rules/custom/ --error`, deterministic output, exit non-zero on findings.
4. **Integration**:
   - New npm script: `security:semgrep`.
   - CI: add it to the existing `security` job after gitleaks.
   - Review checklist: FIRE/Navigator reviewers must run it and attach findings.
5. **Threat modeling**: The `red-team` skill remains the primary tool for adversarial/agentic threat analysis. Semgrep covers static syntactic patterns only.

## Consequences

### Positive

- Automated detection of the #40/#43 vulnerability class before review.
- Fast local feedback and CI feedback with no external dependency beyond npm/pip.
- Transparent, in-repo rules that express our actual high-risk patterns.
- No change to public tool API, runtime behavior, model routing, residency, or schedule cadence.

### Negative / constraints

- Semgrep OSS taint analysis is shallower than CodeQL/Semgrep commercial. Deep cross-file flows still require manual/red-team review.
- False positives are possible; they must be handled with inline `nosemgrep` comments and a justification, or by relaxing a rule after FIRE review.
- Adds a devDependency and CI install time, bounded by pinning.

## Alternatives considered

| Option | Verdict |
|--------|---------|
| CodeQL | Rejected — requires database build, too slow for our loop. |
| Snyk / Skylos / Safeguard / Claude Security / Copilot review | Rejected — platform or non-deterministic assistance, not a gate; conflicts with ADAPT-not-ADOPT. |
| Do nothing | Rejected — the manual Jules PR review caught this class twice; automation reduces human error. |
| Replace `red-team` skill with Semgrep | Rejected — Semgrep is static-pattern SAST; it does not do MITRE ATLAS threat modeling. |

## Validation

- `npm run check` and `npm test` pass with no architecture-fitness exemptions.
- New `npm run security:semgrep` runs locally and in CI.
- Any findings on current `main` triaged before the `--error` hard-fail is enforced.
- `scripts/pi-package-settings.py` suppresses `tspi-path-traversal-python` on its two `settings_path` opens with inline `nosemgrep` justifications: `setup-pi` supplies this trusted local settings path. This narrow exception does not authorize arbitrary tool-supplied paths; path confinement remains a follow-up if that invocation boundary changes.

## Follow-ups

1. Implement `scripts/semgrep-scan.mjs` and `rules/custom/*.yaml`.
2. Add `security:semgrep` script and CI job wiring.
3. Update FIRE/Navigator review checklist template to require scan output.
4. Run baseline scan on `main` and document any suppressions.

## References

Historical briefing and FIRE-review source material is retained in git history. The accepted decision and current architecture/tests are authoritative.
