# Archived Design Docs

Historical planning records, completed mini-specs, superseded proposals, and
progress logs have been deleted from the working tree. They are retained in git
history for decision archaeology.

To browse archived docs by commit:
```bash
git log --all --oneline --name-only -- docs/archive/ | head -40
git show <commit>:docs/archive/<file>
```

Canonical Architecture Decision Records (ADRs) live in [`../adr/`](../adr/).
For current docs, see [`../README.md`](../README.md).
