# ADR 030: Automations Workspace Context Policy

## Status

Accepted

## Context

`pi-automations` workspace context can grow too large for safe prompt inclusion. EO sessions also need project-local workspace discovery before falling back to the user-global Automations home.

## Decision

Use project-local `.pi/automations/workspace/<id>` as the standard registry when present. Existing `.pi/automations/workspaces/<id>` registries remain readable for migration compatibility.

`automations_workspace_read` uses gradual disclosure: summary by default, explicit guarded section/full modes only.

`automations_workspace_update` keeps active `CONTEXT.md` small by archiving oversized content and rewriting active memory as SPR-style stable facts plus archive index.

```mermaid
flowchart TD
  CWD[session cwd] --> P{nearest .pi/automations has workspace(s)?}
  P -- yes --> L[project-local .pi/automations/workspace]
  P -- no --> G[global AUTOMATIONS_HOME/default]
  R[automations_workspace_read] --> S[summary metadata/headings/preview]
  R -->|explicit guarded| SEC[section/full]
  U[automations_workspace_update] --> T{CONTEXT.md over threshold?}
  T -- no --> A[append stable fact]
  T -- yes --> AR[copy to archive/] --> SPR[rewrite active SPR CONTEXT.md]
```
