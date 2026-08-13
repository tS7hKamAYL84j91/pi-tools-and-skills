# Runbook — Monorepo Extension Refactor

## Prerequisites

- Worktree: `/tmp/pi-adr043-refactor` on `refactor/adr043-review`.
- Node dependencies available from the main repo; a local `node_modules` symlink may be used but must remain untracked/removed before handoff.
- Main worktree owner files remain untouched.

## Procedure

1. Capture `git status --short --branch`, commit, extension inventory, and baseline gates.
2. Complete ADR-043 corrections and focused tests before broader analysis.
3. Run bounded code-forensics scripts and static inventory; store only derived, non-secret findings.
4. Run three audit streams: architecture/dependencies, runtime/security/IO, and tests/API/FIRE.
5. Synthesize an evidence-backed FIRE report and select only verified P0/P1 refactors.
6. For each slice: add characterisation tests, implement the smallest change, run focused tests, Knip, and architecture fitness.
7. Update Mermaid architecture docs for material boundary changes.
8. Run full gates, bounded secret scan, Navigator review, council review, and planning completion check.

## Validation and recovery

- Run each milestone's validation command before advancing.
- A failed gate blocks advancement; reproduce against baseline when failure may be unrelated.
- Revert or isolate a slice that increases complexity, public surface, or test instability.
- Never raise architecture budgets or add exceptions to pass fitness tests.

## Escalation

- Public API, persistence, security, or cross-extension strategy disputes: llm-council and Principal/Gravitas.
- Owner changes or ambiguous concurrent work: stop and ask the user before integration.
- Existing unrelated test failure: document baseline reproduction and identify owning extension; do not hide it.
