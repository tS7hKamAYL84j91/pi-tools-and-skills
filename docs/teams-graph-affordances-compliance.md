# Teams Graph Affordances — Compliance Assessment

**Date:** 2026-05-04
**Status:** Initial assessment complete

## TUI Design Guide (Toby)

### Non-color meaning
- **Finding:** PASS — Graph node statuses use text labels (`pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`). No color-only indicators in graph execution.
- **Code reference:** `team-graph.ts` line 14 defines `GraphNodeStatus` union. Status rendered as text in `upstreamPackage()` (line 198-210).

### Narrow width
- **Finding:** PASS — Team browser overlay truncates team info to `width - 6` chars (line 147). New manifest fields would need similar treatment if surfaced in overlay.
- **Code reference:** `team-overlay.ts` line 147 uses `truncateToWidth()`.

## pi-mono TUI Philosophy

### Overlay, not alternate screen
- **Finding:** PASS — Current implementation uses inline overlay in main screen. GA-003 (interrupt points) may require interactive approval UI — this would need alternate screen or inline picker.
- **Action needed:** GA-003 implementation must specify overlay mode. Recommend inline confirmation for simple approve/reject.

### Theme-aware rendering
- **Finding:** PASS — All status indicators use `theme.fg()` and `theme.bg()`.
- **Code reference:** `team-overlay.ts` imports and uses `theme` from `@mariozechner/pi-coding-agent`.

### Consistent markers
- **Finding:** PASS — Team browser uses `>` for selection (line 145). Graph status is text-only, not symbol-based. Other extensions use: `✓` success (pi-coas, pi-panopticon), `✗` failure, `⚠` warning, `⏸` pause (kanban watcher line 191), `●` running (pi-panopticon spawner line 414).
- **Action needed:** GA-003 can reuse `⏸` from kanban for interrupted state. GA-001 conditional skips can use text "(condition not met)" rather than new symbol, or adopt `⇢` if visual distinction needed.
- **Code reference:** `team-overlay.ts` line 145 uses `>` selection. `kanban/watcher.ts` line 191 uses `⏸` for paused state.

## pi-teams Architecture Principles

### Graph as shared primitive
- **Finding:** PASS — Built-in protocols (`debate`, `consult`, `pair-coding`, `telephone`) all lower to graph plans via `graphPlanForSimpleProtocol()`. Orchestration code in `team-graph.ts` is protocol-neutral.

### No external graph framework
- **Finding:** PASS — `team-graph.ts` is self-contained DAG executor. No LangGraph or external dependencies.

### Evidence-gated
- **Finding:** PASS — Living plan includes concrete scenarios for each GA:
  - GA-001: "route to reviewer only if the output has errors" (debate/pair-coding)
  - GA-002: "node produces structured artifact separate from prose" (review channels)
  - GA-003: "review before fix" (pair-coding safety gate), "human can steer mid-synthesis" (debate)
  - GA-004: "review node might itself be a debate team" (subgraph composition)
- **Code reference:** `docs/teams-graph-affordances.md` Issues section.

### Schema-additive
- **Finding:** PASS — All proposed changes (GA-001 through GA-004) are optional fields with undefined defaulting to current behavior.

## Summary

| Checkbox | Status | Notes |
|---|---|---|
| Non-color meaning | ✅ PASS | Text labels for graph status |
| Narrow width | ✅ PASS | `truncateToWidth()` in team browser |
| Overlay, not alternate screen | ✅ PASS | Inline overlay only |
| Theme-aware rendering | ✅ PASS | Uses `theme.fg()`/`theme.bg()` |
| Consistent markers | ✅ PASS | `>` selection, can reuse `⏸` from kanban |
| Graph as shared primitive | ✅ PASS | Protocol-neutral executor |
| No external graph framework | ✅ PASS | Self-contained |
| Evidence-gated | ✅ PASS | Scenarios documented in living plan |
| Schema-additive | ✅ PASS | All fields optional |

## Actions Required

1. **GA-003 overlay marker** — Reuse `⏸` from `kanban/watcher.ts` line 191 for interrupted state. Add to graph node status display if surfaced in overlay.
2. **GA-001 conditional skip representation** — Prefer text "(condition not met)" in node status; add symbol only if visual distinction proves necessary in testing.
3. **GA-003 interrupt UI spec** — Document inline approval mechanism (follow-up event with approval payload). No alternate screen needed.

**Assessment corrected:** All 9 checkboxes now PASS. Implementation can proceed after Navigator confirms these corrections.

---

**Next step:** Run `team_run` with `consult` to get Navigator's assessment of these findings before touching code.
