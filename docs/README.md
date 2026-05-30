# Docs

## Architecture Decision Records

[`adr/`](adr/) — canonical ADRs 001–016.

## Active reference

- [`architecture.md`](architecture.md) — F.I.R.E. review, kanban architecture, CoAS scheduler design.
- [`teams-platform.md`](teams-platform.md) — teams extension: standing decisions, evidence-gated future work, completed simplification summary.
- [`templates/pi-teams-recurring-workflows.md`](templates/pi-teams-recurring-workflows.md) — static SOP templates for recurring pi-teams review and research workflows.
- [`ux-tools-policy.md`](ux-tools-policy.md) — TUI consistency rules and command/tool namespace policy.

## Historical records

[`archive/`](archive/) — pointer to git history. Completed work, superseded plans, and review docs are retained in git; removed from the working tree to avoid stale guidance.

To browse historical docs:
```bash
git log --all --oneline --name-only -- docs/archive/ | head -40
git show <commit>:docs/archive/<file>
```
