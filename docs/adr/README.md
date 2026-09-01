# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for `pi-tools-and-skills`.

## Index

| Number | Title | File |
| --- | --- | --- |
| 001 | CoAS Extension UX Error Handling Pattern | [001-coas-tool-error-handling.md](001-coas-tool-error-handling.md) |
| 002 | TruncatedText limitHit Diagnostic Field | [002-truncatedtext-limithit.md](002-truncatedtext-limithit.md) |
| 003 | Lifecycle Context Instruction Gate Simplification | [003-lifecycle-context-gate-simplification.md](003-lifecycle-context-gate-simplification.md) |
| 004 | Overlay Guard Pattern for Restricted Actions | [004-overlay-guard-pattern.md](004-overlay-guard-pattern.md) |
| 005 | Shared Selection Marker `>` | [005-shared-selection-marker.md](005-shared-selection-marker.md) |
| 006 | Teams as the Reference TUI Pattern | [006-teams-reference-pattern.md](006-teams-reference-pattern.md) |
| 007 | Selection State Must Not Rely on Color Alone | [007-selection-state-non-color.md](007-selection-state-non-color.md) |
| 008 | Browser Toggle Search Mode | [008-browser-toggle-search.md](008-browser-toggle-search.md) |
| 009 | Reserved Command Names | [009-reserved-command-names.md](009-reserved-command-names.md) |
| 010 | `/name` as Canonical Human Identity Command | [010-name-canonical-identity.md](010-name-canonical-identity.md) |
| 011 | Command/Tool Stem Parity | [011-command-stem-parity.md](011-command-stem-parity.md) |
| 012 | Programmatic Naming Tool Replaces `set_alias` | [012-programmatic-naming-tool.md](012-programmatic-naming-tool.md) |
| 013 | `/name` Overrides Spawn Name with Metadata Preservation | [013-name-overrides-spawn.md](013-name-overrides-spawn.md) |
| 014 | Panopticon Reconciliation Alert Policy | [014-panopticon-reconciliation-alert-policy.md](014-panopticon-reconciliation-alert-policy.md) |
| 015 | Matrix Attachment Ingestion | [015-matrix-attachment-ingestion.md](015-matrix-attachment-ingestion.md) |
| 016 | Panopticon Agents Overlay Direct Messaging | [016-panopticon-agents-overlay-direct-messaging.md](016-panopticon-agents-overlay-direct-messaging.md) |
| 017 | Opt-in Session Spooling Hook Lifecycle | [017-session-spooling-hook-lifecycle.md](017-session-spooling-hook-lifecycle.md) |
| 018 | pi-teams Run State and Detail Boundary | [018-team-run-state-detail-boundary.md](018-team-run-state-detail-boundary.md) |
| 019 | CoAS owns recurring scheduling over kanban board tools | [019-coas-owned-scheduling-boundary.md](019-coas-owned-scheduling-boundary.md) |
| 021 | pi-teams Durable Checkpoint and Resume Design | [021-pi-teams-checkpoint-resume-design.md](021-pi-teams-checkpoint-resume-design.md) |
| 022 | Panopticon MEMORY.md Snapshot Boundary | [022-panopticon-memory-snapshot.md](022-panopticon-memory-snapshot.md) |
| 023 | pi-teams Approval Gate API Quarantine | [023-pi-teams-approval-gate-quarantine.md](023-pi-teams-approval-gate-quarantine.md) |
| 024 | pi-teams Observability JSONL Disposition | [024-pi-teams-observability-jsonl-disposition.md](024-pi-teams-observability-jsonl-disposition.md) |
| 024 | Private Local IPC Mode Hardening | [024-private-local-mode-hardening.md](024-private-local-mode-hardening.md) |
| 025 | Panopticon Runtime Control Plane | [025-panopticon-runtime-control-plane.md](025-panopticon-runtime-control-plane.md) |
| 026 | Project Built-in Teams into `~/.pi/agent/teams` as User Source of Truth | [026-project-built-in-teams-into-user-scope.md](026-project-built-in-teams-into-user-scope.md) |
| 027 | Team-Run Node Observability | [027-team-run-node-observability.md](027-team-run-node-observability.md) |
| 029 | Strengthened `/team on` with Context + New `/team review` | [029-team-context-review.md](029-team-context-review.md) |
| 030 | CoAS Workspace Context Policy | [030-coas-workspace-context-policy.md](030-coas-workspace-context-policy.md) |
| 031 | Kanban Markdown Sync (board.log ⇄ board.md) | [031-kanban-markdown-sync.md](031-kanban-markdown-sync.md) |
| 032 | Ephemeral Queue-Level Telemetry for pi-coas Internal Scheduler | [032-coas-ephemeral-scheduler-telemetry.md](032-coas-ephemeral-scheduler-telemetry.md) |
| 033 | Deterministic Evaluation Harness | [033-deterministic-evaluation-harness.md](033-deterministic-evaluation-harness.md) |
| 033 | Structured Tool Failure Metadata | [033-tool-failure-metadata.md](033-tool-failure-metadata.md) |
| 034 | Team Speed Profiles | [034-team-speed-profiles.md](034-team-speed-profiles.md) |
| 035 | Workload Governance / Model Routing Consumer in pi-coas | [035-workload-governance-model-routing-consumer.md](035-workload-governance-model-routing-consumer.md) |
| 036 | /swarm — pi-panopticon bounded worker-pool orchestration | [036-swarm-panopticon-bounded-worker-pool-orchestration.md](036-swarm-panopticon-bounded-worker-pool-orchestration.md) |
| 037 | Semgrep OSS scan step for agent-generated code review gates | [037-semgrep-oss-scan-step.md](037-semgrep-oss-scan-step.md) |
| 038 | CoAS filesystem symlink confinement | [038-coas-symlink-confinement.md](038-coas-symlink-confinement.md) |
| 039 | Declarative swarm Team protocol | [039-declarative-swarm-team-protocol.md](039-declarative-swarm-team-protocol.md) |
| 040 | Bounded hierarchical swarm orchestration | [040-bounded-hierarchical-swarm-orchestration.md](040-bounded-hierarchical-swarm-orchestration.md) |
| 041 | `/swarm` Direct Execution and File-Goal Delivery | [041-swarm-direct-execution-and-file-goal-delivery.md](041-swarm-direct-execution-and-file-goal-delivery.md) |
| 042 | CoAS scheduled approval resume | [042-coas-scheduled-approval-resume.md](042-coas-scheduled-approval-resume.md) |
| 043 | External Agent Mailbox Registration in Panopticon | [043-external-agent-mailbox.md](043-external-agent-mailbox.md) |
| 044 | Spawn-don't-await scheduled runs with startup catchup | [044-spawn-dont-await-catchup.md](044-spawn-dont-await-catchup.md) |
| 045 | Principal-approved `/boost` frontier-model lease | [045-principal-boost-lease.md](045-principal-boost-lease.md) |
| 046 | Standalone pi-boost extension | [046-standalone-pi-boost-extension.md](046-standalone-pi-boost-extension.md) |
| 047 | Shared declarative configuration discovery | [047-shared-declarative-config-discovery.md](047-shared-declarative-config-discovery.md) |
| 048 | Standalone pi-teams public ownership boundary | [048-standalone-pi-teams-public-boundary.md](048-standalone-pi-teams-public-boundary.md) |
| 049 | pi-goal continuous execution and bounded liveness | [049-pi-goal-continuous-execution-and-liveness.md](049-pi-goal-continuous-execution-and-liveness.md) |
| 050 | Unified Environmental and Cognitive Boost Lease and Yield Lifecycle | [050-cognitive-boost-lease-yield.md](050-cognitive-boost-lease-yield.md) |
| 051 | pi-goal session-lineage isolation | [051-pi-goal-session-lineage-isolation.md](051-pi-goal-session-lineage-isolation.md) |

## ADR Registry Notes

- **Duplicate ADR numbers**:
  - **024**: Two files share number `024`: [`024-pi-teams-observability-jsonl-disposition.md`](024-pi-teams-observability-jsonl-disposition.md) and [`024-private-local-mode-hardening.md`](024-private-local-mode-hardening.md).
  - **033**: Two files share number `033`: [`033-deterministic-evaluation-harness.md`](033-deterministic-evaluation-harness.md) and [`033-tool-failure-metadata.md`](033-tool-failure-metadata.md).
- **Unused ADR numbers**:
  - `020` and `028` were never assigned or used.
- **Next available ADR slot**:
  - The next sequential ADR slot to assign is **053**.
