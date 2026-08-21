import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateTeamManifest } from "../../extensions/pi-teams/team-manifest.js";
import { loadTeamRegistry } from "../../extensions/pi-teams/team-registry.js";
import type { TeamSpec } from "../../extensions/pi-teams/team-types.js";
import { withTempConfig, writeSubagent } from "./team-test-helpers.js";

function hierarchicalTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "hierarchical",
		name: "Hierarchical",
		protocol: "hierarchical-swarm",
		prompts: {},
		agents: ["orchestrator"],
		agentBindings: [
			{ role: "root_orchestrator", subagent: "orchestrator", model: "test/root" },
			{ role: "sub_orchestrator", subagent: "orchestrator", model: "test/manager" },
			{ role: "leaf_worker", subagent: "orchestrator", model: "test/worker" },
		],
		models: {},
		limits: {},
		hierarchicalSwarm: {
			roleTemplates: [
				{ role: "root", bindingRole: "root_orchestrator", review: { reviewerRole: "root", required: true } },
				{ role: "manager", bindingRole: "sub_orchestrator", review: { reviewerRole: "root", required: true } },
				{ role: "worker", bindingRole: "leaf_worker", review: { reviewerRole: "manager", required: true } },
			],
			bounds: {
				maxDepth: 2,
				maxChildrenPerNode: 3,
				maxTotalNodes: 8,
				maxWip: 3,
				maxRepairCycles: 3,
				writeIsolation: { mode: "tree-global-exclusive" },
			},
		},
		source: "project",
		path: "hierarchical.md",
	};
}

describe("hierarchical-swarm manifest", () => {
	it("accepts root, manager, and worker templates", () => {
		expect(validateTeamManifest(hierarchicalTeam())).toEqual({ ok: true });
	});

	it("requires every role and validates configured limits without a hard ceiling", () => {
		const missingWorker = hierarchicalTeam();
		const missingWorkerHierarchy = missingWorker.hierarchicalSwarm;
		if (!missingWorkerHierarchy) throw new Error("test hierarchy missing");
		missingWorkerHierarchy.roleTemplates = missingWorkerHierarchy.roleTemplates.filter((template) => template.role !== "worker");
		expect(() => validateTeamManifest(missingWorker)).toThrow(/must define worker/);

		const userConfiguredDepth = hierarchicalTeam();
		const userConfiguredHierarchy = userConfiguredDepth.hierarchicalSwarm;
		if (!userConfiguredHierarchy) throw new Error("test hierarchy missing");
		userConfiguredHierarchy.bounds.maxDepth = 100;
		userConfiguredHierarchy.bounds.ttlMs = 3_600_000;
		expect(validateTeamManifest(userConfiguredDepth)).toEqual({ ok: true });

		const invalidDepth = hierarchicalTeam();
		const invalidDepthHierarchy = invalidDepth.hierarchicalSwarm;
		if (!invalidDepthHierarchy) throw new Error("test hierarchy missing");
		invalidDepthHierarchy.bounds.maxDepth = 0;
		expect(() => validateTeamManifest(invalidDepth)).toThrow(/maxDepth/);
	});

	it("rejects worker bindings with spawn-capable tools", () => {
		for (const tool of ["spawn_agent", "team_run", "swarm_run"]) {
			const unsafeWorker = hierarchicalTeam();
			const worker = unsafeWorker.agentBindings.find((binding) => binding.role === "leaf_worker");
			if (!worker) throw new Error("worker binding missing");
			worker.tools = ["read", tool];
			expect(() => validateTeamManifest(unsafeWorker)).toThrow(/worker binding must not expose/);
		}
	});

	it("requires the hierarchy contract only for the hierarchical protocol", () => {
		const missingContract = hierarchicalTeam();
		missingContract.hierarchicalSwarm = undefined;
		expect(() => validateTeamManifest(missingContract)).toThrow(/requires hierarchicalSwarm/);
	});

	it("compiles a hierarchical-swarm manifest through the registry", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "orchestrator");
			writeFileSync(
				join(root, "teams", "hierarchical.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "hierarchical"',
					'name: "Hierarchical"',
					'protocol: "hierarchical-swarm"',
					'hierarchicalSwarmBounds: { maxDepth: 2, maxChildrenPerNode: 3, maxTotalNodes: 8, maxWip: 3, maxRepairCycles: 3, writeIsolationMode: "tree-global-exclusive" }',
					"hierarchicalSwarmRoleTemplates:",
					'  - role: "root"',
					'    bindingRole: "root_orchestrator"',
					'    reviewerRole: "root"',
					"    reviewRequired: true",
					'  - role: "manager"',
					'    bindingRole: "sub_orchestrator"',
					'    reviewerRole: "root"',
					"    reviewRequired: true",
					'  - role: "worker"',
					'    bindingRole: "leaf_worker"',
					'    reviewerRole: "manager"',
					"    reviewRequired: true",
					"agents:",
					'  - role: "root_orchestrator"',
					'    subagent: "orchestrator"',
					'    model: "test/root"',
					'  - role: "sub_orchestrator"',
					'    subagent: "orchestrator"',
					'    model: "test/manager"',
					'  - role: "leaf_worker"',
					'    subagent: "orchestrator"',
					'    model: "test/worker"',
					"---",
					"Contract body.",
				].join("\n"),
				"utf8",
			);
			const registry = loadTeamRegistry(configPath, { roots: [] });
			expect(registry.warnings).toEqual([]);
			expect(registry.teams.get("hierarchical")?.protocol).toBe("hierarchical-swarm");
		});
	});
});
