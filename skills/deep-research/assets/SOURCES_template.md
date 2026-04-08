# Sources

Normalised evidence store. One row per search result. Append only — do not delete rows.

**Confidence scoring:**
- Peer-reviewed / official docs: +3
- Citations > 50 or GitHub stars > 1k: +2
- Published within 24 months: +2
- Cross-verified by ≥2 independent sources: +2
- Blog / news (no peer review): −1

---

| ID   | Title / URL | Node | Confidence | Date | Key Claim | Leads |
|------|-------------|------|------------|------|-----------|-------|
| S001 | [Title](https://...) | N01 | 8 | 2025-11 | "Quoted or paraphrased claim" | https://... or "follow-up query" |
| S002 | [Title](https://...) | N01 | 6 | 2024-03 | "..." | — |
| S003 | [Title](https://...) | N02 | 9 | 2026-01 | "..." | https://... |

<!-- Keep SOURCES.md on disk. Load only the last 10 rows into active context per step. -->
<!-- Mark cross-verified sources by incrementing confidence by 2 when a second source confirms. -->
