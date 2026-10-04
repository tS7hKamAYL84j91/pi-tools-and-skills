# Docs

Active reference and retained history for this repository.

## Active reference

- [`architecture.md`](architecture.md) — architecture map, state ownership, trust boundaries and validation anchors.
- [`adr/`](adr/) — architecture decisions. Use the next sequential number for new accepted decisions.
- [`specs/`](specs/) — implementation specifications for standalone applications.
- [`../TODO.md`](../TODO.md) — current work only.
- [`../benchmarks/`](../benchmarks/README.md) — evaluation runners and experiment guides.

## Retained history

Evidence records, not a work queue. New entries are active only while their change is open.

- [`reports/`](reports/) — review and validation evidence. Each report declares `Status: active` while its change is open and `Status: historical` once complete.
- [`plans/`](plans/) — ticket plans, retained after delivery.
- [`STATE.md`](STATE.md) — archived session state (2026-06-21), not current work.
- [`images/`](images/) — documentation assets.

## One home per topic

- Root README: installation and navigation.
- Package README: commands, configuration, usage and limits.
- `architecture.md`: cross-cutting state, dependency and trust boundaries.
- ADR: why a decision was made.
- `TODO.md`: current work and open decisions.

Recover anything no longer in the tree with:

```bash
git log --all --oneline --name-only -- docs
git show <commit>:<historical-path>
```
