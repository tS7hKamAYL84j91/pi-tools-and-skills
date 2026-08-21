/** `/swarm` compatibility command backed by the ADR-040 Teams runtime. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TeamsFacade } from "../register.js";
import { HIERARCHICAL_SWARM_TEAM_ID, preflightHierarchicalSwarm } from "./swarm-compat.js";

interface ParsedSwarmCommand {
	goal: string;
	profile: "fast" | "balanced" | "thorough";
	wip?: number;
	execute: boolean;
}

function parseRun(raw: string): ParsedSwarmCommand {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const goal: string[] = [];
	let profile: ParsedSwarmCommand["profile"] = "balanced";
	let wip: number | undefined;
	let execute = false;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--execute") execute = true;
		else if (token === "--profile") {
			const value = tokens[++index];
			if (value !== "fast" && value !== "balanced" && value !== "thorough") throw new Error("--profile must be fast, balanced, or thorough");
			profile = value;
		} else if (token === "--wip") {
			const value = Number(tokens[++index]);
			if (!Number.isInteger(value) || value < 1) throw new Error("--wip must be a positive integer");
			wip = value;
		} else if (token) goal.push(token);
	}
	return { goal: goal.join(" "), profile, ...(wip === undefined ? {} : { wip }), execute };
}

function compatibilityRuns(teams: TeamsFacade) {
	return teams.stateManager.list().filter((run) => run.team === HIERARCHICAL_SWARM_TEAM_ID);
}

/** Registers the dry-run-first `/swarm` compatibility command. */
export function registerSwarmCommand(pi: ExtensionAPI, teams: TeamsFacade): void {
	pi.registerCommand("swarm", {
		description: "Compatibility alias for hierarchical-swarm-default. Usage: /swarm <goal> [--profile fast|balanced|thorough] [--wip N] [--execute]",
		async handler(rawArgs: string | undefined, ctx: ExtensionContext) {
			const raw = rawArgs?.trim() ?? "";
			const [action, id] = raw.split(/\s+/, 2);
			if (action === "status" && id) {
				const run = teams.stateManager.get(id);
				ctx.ui.notify(run?.team === HIERARCHICAL_SWARM_TEAM_ID ? `${run.id}: ${run.status}` : `No hierarchical-swarm team run "${id}".`, run?.team === HIERARCHICAL_SWARM_TEAM_ID ? "info" : "warning");
				return;
			}
			if (action === "list") {
				ctx.ui.notify(`${compatibilityRuns(teams).length} hierarchical-swarm team run(s) in this session.`, "info");
				return;
			}
			if (action === "cancel" && id) {
				const stopped = teams.stateManager.requestStop(id, "cancelled by /swarm");
				ctx.ui.notify(stopped ? `Team run ${id} stopping.` : `No active hierarchical-swarm team run "${id}".`, stopped ? "info" : "warning");
				return;
			}
			try {
				const parsed = parseRun(raw);
				if (parsed.wip !== undefined) throw new Error("--wip is unsupported by the compatibility alias; configure hierarchical-swarm bounds in the team manifest.");
				if (!parsed.execute) {
					const preflight = preflightHierarchicalSwarm({ cwd: ctx.cwd, goal: parsed.goal, profile: parsed.profile });
					ctx.ui.notify(preflight.text, "info");
					return;
				}
				const result = await teams.run({ id: HIERARCHICAL_SWARM_TEAM_ID, prompt: parsed.goal, profile: parsed.profile }, ctx);
				ctx.ui.notify(result.content.map((entry) => entry.text).join("\n"), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
			}
		},
	});
}
