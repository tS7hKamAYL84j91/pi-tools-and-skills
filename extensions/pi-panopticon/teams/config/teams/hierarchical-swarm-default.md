---
schemaVersion: 2
id: "hierarchical-swarm-default"
name: "Hierarchical Swarm"
description: "Manager and worker hierarchy. Runtime topology is selected from manifest defaults."
protocol: "hierarchical-swarm"
hierarchicalSwarmBounds: { maxDepth: 2, maxChildrenPerNode: 3, maxTotalNodes: 8, maxWip: 3, maxRepairCycles: 3, ttlMs: 1800000, writeIsolationMode: "tree-global-exclusive" }
hierarchicalSwarmRoleTemplates:
  - role: "root"
    bindingRole: "root_orchestrator"
    reviewerRole: "root"
    reviewRequired: true
  - role: "manager"
    bindingRole: "sub_orchestrator"
    reviewerRole: "root"
    reviewRequired: true
  - role: "worker"
    bindingRole: "leaf_worker"
    reviewerRole: "manager"
    reviewRequired: true
agents:
  - role: "root_orchestrator"
    subagent: "consult_navigator"
    model: "ollama/gemma4:31b"
  - role: "sub_orchestrator"
    subagent: "consult_navigator"
    model: "ollama/gemma4:31b"
  - role: "leaf_worker"
    subagent: "consult_navigator"
    model: "ollama/gemma4:26b"
---

Contract-only default manifest for ADR-040. It has no execution handler in Phase 0.
