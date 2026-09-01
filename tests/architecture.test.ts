/**
 * Single Vitest entry point for architecture fitness functions.
 *
 * Focused suites live in tests/architecture/ so failures are easier to map to
 * API contracts, runtime state boundaries, UX policy, clean code, or Clean
 * Architecture rules while preserving this top-level architecture test module.
 */

import "./architecture/api-contracts.js";
import "./architecture/runtime-state-boundaries.js";
import "./architecture/coas-confined-io.js";
import "./architecture/kanban-transactions.js";
import "./architecture/ux-tools-policy.js";
import "./architecture/tui-render-paths.js";
import "./architecture/tool-api-contracts.js";
import "./architecture/lib-layering.js";
import "./architecture/clean-code.js";
import "./architecture/hotspots.js";
import "./architecture/docs-hygiene.js";
import "./architecture/clean-architecture.js";
import "./architecture/adr047-shared-discovery.js";
import "./architecture/daemon-protocol-boundaries.js";
import "./architecture/adr051-goal-session-isolation.js";
import "./architecture/pi-teams-public-boundary.js";
