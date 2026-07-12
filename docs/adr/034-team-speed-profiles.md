# ADR 034: Team speed profiles

- Status: Accepted
- Date: 2026-07-12

## Context

Fusion and Navigator need predictable latency/cost choices without duplicating tuning flags across tool and session-mode callers. Existing Fusion callers use `limits.maxLoops` as the panel-size override and must remain compatible.

## Decision

Add one shared `fast | balanced | thorough` team profile contract. `balanced` is the default.

Precedence is:

1. explicit `team_run` model and limit fields;
2. selected profile defaults;
3. team manifest and existing settings defaults.

Protocol safety bounds apply after resolution. In particular, Fast Navigator always has zero retries and a bounded timeout, and Fusion keeps its hard panel cap. Explicit Fusion `limits.maxLoops` remains the legacy panel-size override and takes precedence over the profile panel default.

Fast Fusion selects a bounded, provider-diverse panel where configured models permit it. Panel and judge generation/output are bounded, and the judge receives bounded panel excerpts. The judge JSON contract requires `answer` plus all analysis fields. Invalid judge output continues to return degraded fallback JSON.

Fast Navigator uses a compact prompt, bounded output, no retries, a bounded timeout, and no automatic session history. Balanced session mode retains the existing five-turn/4,000-character bounded history. Thorough allows a larger bounded history.

```mermaid
flowchart LR
  Caller[team_run or /team session mode] --> Explicit[Explicit models and limits]
  Profile[fast / balanced / thorough] --> Resolve[Profile resolver]
  Manifest[Team manifest defaults] --> Resolve
  Explicit --> Resolve
  Resolve --> Safety[Protocol safety bounds]
  Safety --> Fusion[Fusion bounded panel and judge]
  Safety --> Navigator[Navigator bounded consult]
```

## Consequences

- Callers get one typed latency/cost control instead of protocol-specific tuning.
- Existing Fusion `maxLoops` calls retain behavior.
- Fast mode intentionally trades context and output depth for latency.
- No provider benchmark, dependency, scheduler, or new persistence surface is introduced.
