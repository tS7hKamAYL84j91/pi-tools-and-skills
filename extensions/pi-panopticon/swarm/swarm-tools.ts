/** Tool registration for swarm planning and lifecycle control. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RuntimeControlPlane, RuntimeEntityRef } from "../../../lib/runtime-control-plane.js";
import { fail, ok } from "../../../lib/tool-result.js";
import { planSwarm } from "./swarm-planner.js";
import type { SwarmRunner } from "./swarm-runner.js";
import type { SwarmProfile, SwarmRecord } from "./swarm-types.js";

const ProfileSchema = Type.Union([
	Type.Literal("fast"),
	Type.Literal("balanced"),
	Type.Literal("thorough"),
]);

interface SwarmRegistration {
	runner: SwarmRunner;
	runtime: RuntimeControlPlane;
}

function registerRuntime(
	registration: SwarmRegistration,
	record: SwarmRecord,
): RuntimeEntityRef {
	const ref: RuntimeEntityRef = { id: record.plan.swarmId, kind: "swarm" };
	registration.runtime.registerEntity({
		...ref,
		label: record.plan.goal,
		status: record.state === "running" ? "running" : "failed",
		stop: (reason) => {
			void registration.runner.stop(record.plan.swarmId, reason).then(() => {
				registration.runtime.updateStatus(ref, "stopped");
			});
		},
	});
	return ref;
}

/** Registers swarm_run, swarm_status, swarm_list, and swarm_stop. */
export function registerSwarmTools(pi: ExtensionAPI, registration: SwarmRegistration): void {
	pi.registerTool({
		name: "swarm_run",
		label: "Run Swarm",
		description: "Plan or execute one deterministic bounded worker pool. Dry-run defaults to true.",
		parameters: Type.Object({
			goal: Type.String(),
			profile: Type.Optional(ProfileSchema),
			wip: Type.Optional(Type.Number()),
			dry_run: Type.Optional(Type.Boolean({ default: true })),
			async: Type.Optional(Type.Boolean({ default: false })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const profile = (params.profile ?? "balanced") as SwarmProfile;
			const plan = planSwarm(params.goal, profile);
			if (params.dry_run !== false) return ok("Swarm plan created; no workers spawned.", { plan, dryRun: true });
			try {
				const record = registration.runner.start(plan, ctx.cwd, params.wip);
				registerRuntime(registration, record);
				return ok(`Swarm ${plan.swarmId} ${record.state}.`, { record, async: params.async ?? false });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error), { code: "validation" });
			}
		},
	});

	pi.registerTool({
		name: "swarm_status",
		label: "Swarm Status",
		description: "Inspect one session-local swarm.",
		parameters: Type.Object({ swarmId: Type.String() }),
		async execute(_id, params) {
			const record = registration.runner.get(params.swarmId);
			return record ? ok(`Swarm ${params.swarmId}: ${record.state}`, { record }) : fail(`Unknown swarm '${params.swarmId}'.`, { code: "validation" });
		},
	});

	pi.registerTool({
		name: "swarm_list",
		label: "List Swarms",
		description: "List session-local swarm records.",
		parameters: Type.Object({ activeOnly: Type.Optional(Type.Boolean()) }),
		async execute(_id, params) {
			const records = registration.runner.list().filter((record) => !params.activeOnly || record.state === "running");
			return ok(`${records.length} swarm(s).`, { records });
		},
	});

	pi.registerTool({
		name: "swarm_stop",
		label: "Stop Swarm",
		description: "Cancel a swarm and tear down its workers.",
		parameters: Type.Object({
			swarmId: Type.String(),
			reason: Type.Optional(Type.String()),
		}),
		async execute(_id, params) {
			try {
				const record = await registration.runner.stop(params.swarmId, params.reason);
				registration.runtime.updateStatus({ id: params.swarmId, kind: "swarm" }, "stopped");
				return ok(`Swarm ${params.swarmId} stopped.`, { record });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error), { code: "validation" });
			}
		},
	});
}
