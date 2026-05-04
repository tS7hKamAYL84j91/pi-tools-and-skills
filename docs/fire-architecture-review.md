# F.I.R.E. Architecture Review

**Date:** 2026-05-04

Reviewing `pi-tools-and-skills` against Dan Ward's F.I.R.E. principles (Fast, Inexpensive, Restrained, Elegant).

## 1. Strengths (F.I.R.E. Aligned)

*   **Fast & Inexpensive:** Local file-backed state (JSON/Markdown) means zero infrastructure.
*   **Restrained & Elegant:** Extension boundaries are tight. Kanban uses a simple append-only log.

## 2. Risk Areas (Becoming "Heavy")

The main risk is **custom framework growth**:

*   **`pi-teams`:** The DAG executor risks becoming a brittle workflow engine.
*   **File Concurrency:** Multiple writers require strict lock discipline, adding complexity.
*   **`pi-coas`:** Must remain a thin `cron` wrapper, not a custom scheduling engine.
*   **`matrix`:** Justified for human interaction, but too heavy for local agent-to-agent comms.

## 3. Recommendations

1.  **Constrain `pi-teams`:** Define a minimal DAG contract. Prefer direct coordination functions (`run_debate()`) over a complex engine unless dynamic topologies are strictly required.
2.  **Keep Kanban dumb:** Stick to the event-sourced log and deterministic state reconstruction. **No SQLite.**
3.  **Keep `pi-panopticon` boring:** Only track agent existence and heartbeats. No historical metrics.
4.  **Limit `pi-coas`:** Delegate scheduling to OS tools (`cron`/`systemd`).
5.  **Enforce Boundaries:** Prevent extensions from coupling. Add explicit "What this does NOT do" to every README.