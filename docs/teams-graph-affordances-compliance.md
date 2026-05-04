# Teams Graph Affordances — Compliance Assessment

**Date:** 2026-05-04
**Status:** Complete — Navigator reviewed and accepted

This assessment records the pre-implementation compliance check required by `docs/teams-graph-affordances.md` before Stage 1 schema or executor changes.

## Summary

| Checkbox | Status | Notes |
| --- | --- | --- |
| Non-color meaning | ✅ PASS | Graph status is represented with text labels and error reasons, not color alone. |
| Narrow width | ✅ PASS | Current `/teams` overlay truncates visible team text; future surfaced graph metadata must follow the same pattern. |
| Overlay, not alternate screen | ✅ PASS | GA-003 approval is specified as an inline follow-up event, not a new alternate-screen UI. |
| Theme-aware rendering | ✅ PASS | Existing overlay rendering goes through the theme; future visible markers must do the same. |
| Consistent markers | ✅ PASS | Selected rows use `>`; interrupted state should reuse `⏸` only as a supplemental marker with text. |
| Graph as shared primitive | ✅ PASS | Built-in protocols lower to protocol-neutral graph plans; Stage 1 affordances extend that shared graph layer. |
| No external graph framework | ✅ PASS | The plan keeps the in-repo DAG executor and adds no LangGraph dependency. |
| Evidence-gated | ✅ PASS | Each GA issue names a concrete user-facing scenario not expressible today. |
| Schema-additive | ✅ PASS | Proposed fields are optional and default to current behavior when omitted. |

## Findings by area

### TUI Design Guide

- **Non-color meaning:** PASS — `GraphNodeStatus` uses text statuses (`pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`) and upstream packaging includes explicit `Status:` / `Error:` labels.
- **Narrow width:** PASS — current team overlay text uses width-aware truncation; future `team_describe` or overlay fields for predicates, channels, interrupts, or subteams must truncate similarly.

### pi-mono TUI Philosophy

- **Overlay, not alternate screen:** PASS — interrupt approval is documented as an inline follow-up event with approve/reject/abort payloads.
- **Theme-aware rendering:** PASS — no new rendering was added in the assessment slice; future visible markers must route through `theme.fg()`.
- **Consistent markers:** PASS — use `>` for selected rows; use text labels first for graph state; `⏸` is reserved for interrupted state as a supplemental marker.

### pi-teams Architecture Principles

- **Graph as shared primitive:** PASS — graph affordances are specified at `TeamGraph`, `TeamGraphEdge`, `TeamAgentBinding`, `GraphNodeResult`, and `GraphRunResult` boundaries.
- **No external graph framework:** PASS — all affordances are implementable in `team-graph.ts` with native TypeScript and existing pi APIs.
- **Evidence-gated:** PASS — GA-001 through GA-004 each document current representational gaps and target scenarios.
- **Schema-additive:** PASS — changes remain v2-compatible and optional.

## Decisions carried into the living plan

1. Reuse `⏸` for interrupted graph state, paired with the text label `interrupted`.
2. Represent conditional skips primarily as `skipped` plus an error reason such as `(condition not met)`.
3. Use structured deterministic predicates for conditional edges, not prompt strings or arbitrary code.
4. Use declared typed channel schemas with writer constraints, not free-form channel records.
5. Treat `extensions/pi-teams/team-manifest.ts` as the Stage 1 manifest validation entrypoint.

Navigator review accepted these findings; implementation status and follow-up work are tracked in `docs/teams-graph-affordances.md`.
