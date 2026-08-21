# Docs

This directory is for active, decision-useful documentation. Completed reports and superseded plans live in git history, not the working tree.

## Active reference

- [`architecture.md`](architecture.md) — current architecture map, state ownership, trust boundaries, and validation anchors.
- [`adr/`](adr/) — durable architecture decisions. ADR numbers are historical; use the next sequential number for new accepted decisions.
- [`reports/`](reports/) — temporary active-only ledgers. Every report must declare `Status: active` and be removed or folded into an ADR when complete.

## Historical records

Completed reports, superseded plans, and prior deep dives live in git history rather than the working tree. Retrieve them with:

```bash
git log --all --oneline --name-only -- docs
git show <commit>:<historical-path>
```
