# Docs

This directory is for active, decision-useful documentation. Completed reports and superseded plans live in git history, not the working tree.

## Active reference

- [`architecture.md`](architecture.md) — current architecture map, state ownership, trust boundaries, validation anchors, detailed reference, and F.I.R.E. review context.
- [`deep-dives/teams-platform.md`](deep-dives/teams-platform.md) — Panopticon teams standing decisions, run-state contract, and evidence-gated future work.
- [`deep-dives/ux-tools-policy.md`](deep-dives/ux-tools-policy.md) — TUI consistency rules and command/tool namespace policy.

## Architecture Decision Records

[`adr/`](adr/) contains durable decisions. ADR numbers are historical; use the next sequential ADR for new accepted architecture decisions.

## Active reports

[`reports/`](reports/) is active-only. A report must include `Status: active`; otherwise it should be folded into active reference docs, converted into an ADR, or removed from the working tree.

Current active reports:

- [`reports/t-631-fire-review.md`](reports/t-631-fire-review.md) — current F.I.R.E. review and follow-ups.
- [`reports/g-f90275d0-teams-protocol-anthropic-review.md`](reports/g-f90275d0-teams-protocol-anthropic-review.md) — active Teams protocol refinement report based on Anthropic effective-agents guidance.

## Historical records

Completed work, superseded plans, and old review docs are retained in git history to avoid stale guidance in the working tree.

Useful commands:

```bash
git log --all --oneline --name-only -- docs/reports | head -80
git show <commit>:docs/reports/<file>
```
