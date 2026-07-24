/** `/swarm` command parsing and lifecycle shortcuts. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { planSwarm } from "./swarm-planner.js";
import type { SwarmRunner } from "./swarm-runner.js";
import type { SwarmProfile } from "./swarm-types.js";

interface ParsedSwarmCommand {
	goal: string;
	profile: SwarmProfile;
	wip: number;
	execute: boolean;
}

function parseRun(raw: string): ParsedSwarmCommand {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const goal: string[] = [];
	let profile: SwarmProfile = "balanced";
	let wip = 3;
	let execute = false;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--execute") execute = true;
		else if (token === "--profile") {
			const value = tokens[++index];
			if (value !== "fast" && value !== "balanced" && value !== "thorough") {
				throw new Error("--profile must be fast, balanced, or thorough");
			}
			profile = value;
		} else if (token === "--wip") {
			const value = Number(tokens[++index]);
			if (!Number.isInteger(value) || value < 1) throw new Error("--wip must be a positive integer");
			wip = value;
		} else if (token) goal.push(token);
	}
	return { goal: goal.join(" "), profile, wip, execute };
}

/** Registers dry-run-first `/swarm` commands. */
export function registerSwarmCommand(pi: ExtensionAPI, runner: SwarmRunner): void {
	pi.registerCommand("swarm", {
		description: "Plan or run a bounded swarm. Usage: /swarm <goal> [--profile fast|balanced|thorough] [--wip N] [--execute]",
		async handler(rawArgs: string | undefined, ctx: ExtensionContext) {
			const raw = rawArgs?.trim() ?? "";
			const [action, id] = raw.split(/\s+/, 2);
			if (action === "status" && id) {
				const record = runner.get(id);
				ctx.ui.notify(record ? `${id}: ${record.state}` : `Unknown swarm '${id}'.`, record ? "info" : "warning");
				return;
			}
			if (action === "list") {
				ctx.ui.notify(`${runner.list().length} swarm(s) in this session.`, "info");
				return;
			}
			if (action === "cancel" && id) {
				await runner.stop(id, "cancelled by /swarm");
				ctx.ui.notify(`Swarm ${id} stopped.`, "info");
				return;
			}
			try {
				const parsed = parseRun(raw);
				const plan = planSwarm(parsed.goal, parsed.profile);
				if (!parsed.execute) {
					ctx.ui.notify(`Dry-run ${plan.swarmId}: ${plan.tasks.length} task(s). Add --execute to spawn.`, plan.state === "blocked" ? "warning" : "info");
					return;
				}
				const record = runner.start(plan, ctx.cwd, parsed.wip);
				ctx.ui.notify(`Swarm ${plan.swarmId}: ${record.state}.`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
			}
		},
	});
}
