/** Deterministic, single-pass task decomposition for bounded swarms. */

import type {
	SwarmPlan,
	SwarmProfile,
	SwarmReviewProfile,
	SwarmTask,
} from "./swarm-types.js";

const MAX_TASKS = 6;
const READ_ONLY_TOOLS = ["read", "bash"];
const WRITE_TOOLS = ["read", "bash", "edit", "write"];
const ACTION_PREFIX = /^(?:and\s+|then\s+|also\s+)/i;
const ARCHITECTURE_TERMS = /\b(?:adr|architecture|security|public api|persistence)\b/i;
const READ_ONLY_TERMS = /\b(?:audit|inspect|research|review|scan|search|verify)\b/i;

function stableId(goal: string): string {
	let hash = 2_166_136_261;
	for (const character of goal) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16_777_619);
	}
	return `swarm-${(hash >>> 0).toString(36)}`;
}

function normaliseClause(clause: string): string {
	return clause.replace(/^[-*\d.)\s]+/, "").replace(ACTION_PREFIX, "").trim();
}

function splitGoal(goal: string): string[] {
	const explicit = goal
		.split(/(?:\r?\n|;)+/)
		.map(normaliseClause)
		.filter((clause) => clause.length > 0);
	if (explicit.length > 1) return explicit.slice(0, MAX_TASKS);
	const sequenced = goal
		.split(/\b(?:then|after that|followed by)\b/i)
		.map(normaliseClause)
		.filter((clause) => clause.length > 0);
	return sequenced.slice(0, MAX_TASKS);
}

function taskTitle(clause: string): string {
	const compact = clause.replace(/\s+/g, " ");
	return compact.length <= 72 ? compact : `${compact.slice(0, 69)}...`;
}

function reviewProfile(profile: SwarmProfile, clause: string): SwarmReviewProfile {
	if (profile === "thorough") return "stacked";
	if (profile === "balanced" && ARCHITECTURE_TERMS.test(clause)) return "architecture";
	return "navigator";
}

interface TaskOptions {
	swarmId: string;
	clause: string;
	index: number;
	previousTaskId?: string;
	profile: SwarmProfile;
}

function createTask(options: TaskOptions): SwarmTask {
	const id = `S-${options.swarmId}-${options.index + 1}`;
	const readOnly = READ_ONLY_TERMS.test(options.clause);
	return {
		id,
		title: taskTitle(options.clause),
		brief: `${options.clause}\n\nReturn DONE or BLOCKED with verifiable artifact evidence.`,
		dependencies: options.previousTaskId ? [options.previousTaskId] : [],
		allowedTools: readOnly ? [...READ_ONLY_TOOLS] : [...WRITE_TOOLS],
		readOnly,
		reviewProfile: reviewProfile(options.profile, options.clause),
		state: "pending",
		artifacts: [],
		repairCycles: 0,
	};
}

/** Produces a stable dependency-ordered plan without spawning workers. */
export function planSwarm(goal: string, profile: SwarmProfile = "balanced"): SwarmPlan {
	const normalisedGoal = goal.trim().replace(/\s+/g, " ");
	const swarmId = stableId(normalisedGoal);
	if (normalisedGoal.length < 3) {
		return {
			swarmId,
			goal: normalisedGoal,
			profile,
			state: "blocked",
			tasks: [],
			blockedReason: "Goal is empty or too short to decompose.",
		};
	}
	const clauses = splitGoal(goal);
	if (clauses.length === 0) {
		return {
			swarmId,
			goal: normalisedGoal,
			profile,
			state: "blocked",
			tasks: [],
			blockedReason: "Goal has no actionable task content.",
		};
	}
	const tasks: SwarmTask[] = [];
	for (const clause of clauses) {
		tasks.push(
			createTask({
				swarmId,
				clause,
				index: tasks.length,
				previousTaskId: tasks.at(-1)?.id,
				profile,
			}),
		);
	}
	return { swarmId, goal: normalisedGoal, profile, state: "planned", tasks };
}
