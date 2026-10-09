# Docs

Active reference and retained history for this repository.

## Active reference

- [`architecture.md`](architecture.md) — architecture map, state ownership, trust boundaries and validation anchors.
- [`decisions.md`](decisions.md) — decision log: one SPR line per accepted decision; new decisions append a numbered line there.
- [`../TODO.md`](../TODO.md) — current work only.
- [`../benchmarks/`](../benchmarks/README.md) — evaluation runners and experiment guides.
- [`images/`](images/) — documentation assets.

## One home per topic

- Root README: installation and navigation.
- Package README: commands, configuration, usage and limits.
- `architecture.md`: cross-cutting state, dependency and trust boundaries.
- `decisions.md`: why a decision was made (one line each).
- `TODO.md`: current work and open decisions.

Recover anything no longer in the tree with:

```bash
git log --all --oneline --name-only -- docs
git show <commit>:<historical-path>
```
