# ADR 030: CoAS Workspace Context Policy

## Status

Accepted

## Context

`pi-coas` workspace context can grow too large for safe prompt inclusion. EO sessions also need project-local workspace discovery before falling back to the user-global CoAS home.

## Decision

Use project-local `.pi/coas/workspace/<id>` as the standard registry when present. Existing `.pi/coas/workspaces/<id>` registries remain readable for migration compatibility.

`coas_workspace_read` uses gradual disclosure: summary by default, explicit guarded section/full modes only.

`coas_workspace_update` keeps active `CONTEXT.md` small by archiving oversized content and rewriting active memory as SPR-style stable facts plus archive index.

```mermaid
flowchart TD
  CWD[session cwd] --> P{nearest .pi/coas has workspace(s)?}
  P -- yes --> L[project-local .pi/coas/workspace]
  P -- no --> G[global COAS_HOME/default]
  R[coas_workspace_read] --> S[summary metadata/headings/preview]
  R -->|explicit guarded| SEC[section/full]
  U[coas_workspace_update] --> T{CONTEXT.md over threshold?}
  T -- no --> A[append stable fact]
  T -- yes --> AR[copy to archive/] --> SPR[rewrite active SPR CONTEXT.md]
```
