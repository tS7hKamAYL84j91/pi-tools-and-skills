# Docs

## Architecture Decision Records

[`adr/`](adr/) — canonical ADRs 001–017.

## Active reference

- [`architecture.md`](architecture.md) — F.I.R.E. review, kanban architecture, CoAS scheduler design.
- [`pi-gmail.md`](pi-gmail.md) — read-only Gmail metadata/snippet tools, credential inputs, and safety boundary.
- [`teams-platform.md`](teams-platform.md) — teams extension: standing decisions, evidence-gated future work, completed simplification summary.
- [`ux-tools-policy.md`](ux-tools-policy.md) — TUI consistency rules and command/tool namespace policy.
- [`TODO.md`](TODO.md) — single remaining-work tracker and evidence-gated backlog.

## Historical records

[`archive/`](archive/) — pointer to git history. Completed work, superseded plans, and review docs are retained in git; removed from the working tree to avoid stale guidance.

To browse historical docs:
```bash
git log --all --oneline --name-only -- docs/archive/ | head -40
git show <commit>:docs/archive/<file>
```
