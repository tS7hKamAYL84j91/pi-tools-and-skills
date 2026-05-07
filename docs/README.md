# Docs

## Architecture Decision Records

[`adr/`](adr/) — canonical ADRs 001–013.

## Active reference

- [`architecture.md`](architecture.md) — F.I.R.E. review, kanban architecture, CoAS scheduler design.
- [`teams-platform.md`](teams-platform.md) — teams extension: standing decisions, evidence-gated future work, completed simplification summary.
- [`ux-tools-policy.md`](ux-tools-policy.md) — TUI consistency rules and command/tool namespace policy.
- [`TODO.md`](TODO.md) — single remaining-work tracker, including extension rename plan.

## Historical records

[`archive/`](archive/) — pointer to git history. Completed work, superseded plans, and review docs are retained in git; removed from the working tree to avoid stale guidance.

To browse historical docs:
```bash
git log --all --oneline --name-only -- docs/archive/ | head -40
git show <commit>:docs/archive/<file>
```
