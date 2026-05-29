/** Pure task lifecycle vocabulary and transition helper for pi-kanban. */

export const TASK_LIFECYCLE_STATES = ["backlog", "todo", "in_progress", "blocked", "done"] as const;
export const TASK_LIFECYCLE_EVENTS = [
	"CREATE",
	"MOVE",
	"CLAIM",
	"UNCLAIM",
	"EXPIRE",
	"BLOCK",
	"UNBLOCK",
	"COMPLETE",
	"NOTE",
	"EDIT",
	"DELETE",
	"SNAPSHOT",
	"COMPACT",
] as const;

export type TaskLifecycleState = typeof TASK_LIFECYCLE_STATES[number];
export type TaskLifecycleEvent = typeof TASK_LIFECYCLE_EVENTS[number];
type TaskLifecycleEffect =
	| "created"
	| "moved"
	| "claimed"
	| "reassigned"
	| "claim_cleared"
	| "blocked"
	| "unblocked"
	| "completed"
	| "noted"
	| "edited"
	| "deleted"
	| "maintenance"
	| "compatibility_noop"
	| "denied";

export interface TaskLifecycleContext {
	state?: TaskLifecycleState;
	deleted?: boolean;
	claimed?: boolean;
}

interface TaskLifecycleTransition {
	event: TaskLifecycleEvent;
	to?: string;
}

interface TaskLifecycleTransitionResult {
	ok: boolean;
	effect: TaskLifecycleEffect;
	state?: TaskLifecycleState;
	deleted: boolean;
	claimed: boolean;
	reason?: string;
}

function result(args: {
	ok: boolean;
	effect: TaskLifecycleEffect;
	state?: TaskLifecycleState;
	deleted: boolean;
	claimed: boolean;
	reason?: string;
}): TaskLifecycleTransitionResult {
	return {
		ok: args.ok,
		effect: args.effect,
		...(args.state ? { state: args.state } : {}),
		deleted: args.deleted,
		claimed: args.claimed,
		...(args.reason ? { reason: args.reason } : {}),
	};
}

function denied(context: Required<Pick<TaskLifecycleTransitionResult, "deleted" | "claimed">> & { state?: TaskLifecycleState }, reason: string): TaskLifecycleTransitionResult {
	return result({ ok: false, effect: "denied", state: context.state, deleted: context.deleted, claimed: context.claimed, reason });
}

export function normalizeTaskLifecycleState(value: string | undefined): TaskLifecycleState | undefined {
	if (value === "in-progress") return "in_progress";
	if (value === "backlog" || value === "todo" || value === "in_progress" || value === "blocked" || value === "done") return value;
	return undefined;
}

export function persistedTaskColumn(state: TaskLifecycleState): string {
	return state === "in_progress" ? "in-progress" : state;
}

/** Plan one lifecycle transition without reading or mutating board.log. */
export function planTaskLifecycleTransition(context: TaskLifecycleContext, transition: TaskLifecycleTransition): TaskLifecycleTransitionResult {
	const state = context.state;
	const deleted = context.deleted ?? false;
	const claimed = context.claimed ?? state === "in_progress";
	if (deleted && transition.event !== "SNAPSHOT" && transition.event !== "COMPACT") {
		return denied({ state, deleted, claimed }, "deleted tasks cannot transition");
	}
	if (transition.event === "CREATE") {
		return state === undefined
			? result({ ok: true, effect: "created", state: "backlog", deleted: false, claimed: false })
			: denied({ state, deleted, claimed }, "CREATE requires no existing task state");
	}
	if (transition.event === "MOVE") return planMove({ state, deleted, claimed }, transition.to);
	if (state === undefined) return denied({ deleted, claimed }, `${transition.event} requires an existing task`);
	if (transition.event === "CLAIM") {
		if (state === "todo") return result({ ok: true, effect: "claimed", state: "in_progress", deleted, claimed: true });
		if (state === "in_progress") return result({ ok: true, effect: "reassigned", state, deleted, claimed: true });
		return denied({ state, deleted, claimed }, "CLAIM requires todo or in_progress state");
	}
	if (transition.event === "UNCLAIM" || transition.event === "EXPIRE") {
		return state === "in_progress"
			? result({ ok: true, effect: "claim_cleared", state, deleted, claimed: false })
			: denied({ state, deleted, claimed }, `${transition.event} requires in_progress state`);
	}
	if (transition.event === "BLOCK") {
		return state === "in_progress"
			? result({ ok: true, effect: "blocked", state: "blocked", deleted, claimed: false })
			: denied({ state, deleted, claimed }, "BLOCK requires in_progress state");
	}
	if (transition.event === "UNBLOCK") {
		return state === "blocked"
			? result({ ok: true, effect: "unblocked", state: "todo", deleted, claimed: false })
			: denied({ state, deleted, claimed }, "UNBLOCK requires blocked state");
	}
	if (transition.event === "COMPLETE") {
		return state === "in_progress"
			? result({ ok: true, effect: "completed", state: "done", deleted, claimed: false })
			: denied({ state, deleted, claimed }, "COMPLETE requires in_progress state");
	}
	if (transition.event === "DELETE") return planDelete({ state, deleted, claimed });
	if (transition.event === "EDIT") {
		return state === "backlog" || state === "todo"
			? result({ ok: true, effect: "edited", state, deleted, claimed })
			: denied({ state, deleted, claimed }, "EDIT metadata changes require backlog or todo state");
	}
	if (transition.event === "NOTE") return result({ ok: true, effect: "noted", state, deleted, claimed });
	return result({ ok: true, effect: "maintenance", state, deleted, claimed });
}

function planMove(context: Required<Pick<TaskLifecycleTransitionResult, "deleted" | "claimed">> & { state?: TaskLifecycleState }, to: string | undefined): TaskLifecycleTransitionResult {
	const target = normalizeTaskLifecycleState(to);
	if (!target) return denied(context, "MOVE requires a recognized target state");
	if (!context.state) return denied(context, "MOVE requires an existing task");
	if (target === context.state) return result({ ok: true, effect: "compatibility_noop", state: context.state, deleted: context.deleted, claimed: context.claimed });
	if (context.state === "backlog" && target === "todo") return result({ ok: true, effect: "moved", state: target, deleted: context.deleted, claimed: false });
	if (context.state === "todo" && target === "backlog") return result({ ok: true, effect: "moved", state: target, deleted: context.deleted, claimed: false });
	return denied(context, "MOVE is limited to backlog/todo planning transitions or compatibility no-ops");
}

function planDelete(context: Required<Pick<TaskLifecycleTransitionResult, "deleted" | "claimed">> & { state: TaskLifecycleState }): TaskLifecycleTransitionResult {
	if (context.state === "backlog" || context.state === "todo" || context.state === "done") {
		return result({ ok: true, effect: "deleted", state: context.state, deleted: true, claimed: false });
	}
	return denied(context, "DELETE requires backlog, todo, or done state");
}
