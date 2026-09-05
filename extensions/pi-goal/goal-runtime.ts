/** Shared runtime state and UI helpers for pi-goal. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadGoal } from "./goal-persist.js";
import { goalScopeForContext } from "./goal-helpers.js";
import type { GoalSessionScope } from "./goal-binding.js";
import type { GoalOwnerIdentity, GoalState } from "./goal-types.js";

const MAX_CANCELLED_MARKERS = 20;
const GOAL_RUNTIME_KEY = Symbol.for("pi-goal.runtime");

export interface GoalDriver extends GoalOwnerIdentity {
	readonly cwd: string;
	readonly goalId: string;
	sessionId?: string;
	handoff: boolean;
}

export interface GoalRuntime {
	driver?: GoalDriver;
	resolve: ((messages: readonly unknown[]) => void) | null;
	stopRequested: boolean;
	pendingMarker: string | null;
	cancelledMarkers: Set<string>;
}

export function getGoalRuntime(): GoalRuntime {
	const globals = globalThis as Record<symbol, unknown>;
	if (!globals[GOAL_RUNTIME_KEY]) {
		globals[GOAL_RUNTIME_KEY] = {
			resolve: null,
			stopRequested: false,
			pendingMarker: null,
			cancelledMarkers: new Set<string>(),
		} satisfies GoalRuntime;
	}
	return globals[GOAL_RUNTIME_KEY] as GoalRuntime;
}

export function cancelContinuationPending(runtime: GoalRuntime): void {
	if (!runtime.pendingMarker) return;
	runtime.cancelledMarkers.add(runtime.pendingMarker);
	while (runtime.cancelledMarkers.size > MAX_CANCELLED_MARKERS) {
		const first = runtime.cancelledMarkers.values().next().value as string;
		runtime.cancelledMarkers.delete(first);
	}
	runtime.pendingMarker = null;
}

export function isCancelledContinuation(runtime: GoalRuntime, prompt: string, extractMarker: (text: string) => string | undefined): boolean {
	const marker = extractMarker(prompt);
	return marker !== undefined && runtime.cancelledMarkers.has(marker);
}

export function ownsGoal(runtime: GoalRuntime, state: GoalState): boolean {
	return runtime.driver?.goalId === state.goalId && runtime.driver.token === state.owner?.token && runtime.driver.generation === state.owner?.generation;
}

/** Stops only the local run associated with this goal; never adopts persisted owners. */
export function stopLocalRun(runtime: GoalRuntime, goalId?: string): void {
	if (goalId !== undefined && runtime.driver?.goalId !== goalId) { return; }
	runtime.stopRequested = true;
	cancelContinuationPending(runtime);
	const resolve = runtime.resolve;
	runtime.resolve = null;
	resolve?.([]);
}

export async function refreshUi(ctx: ExtensionContext, runtime: GoalRuntime, state?: GoalState | null, scope?: GoalSessionScope): Promise<void> {
	const current = state === undefined ? await loadGoal(ctx.cwd, scope ?? goalScopeForContext(ctx)) : state;
	if (current && !current.runActive) { stopLocalRun(runtime, current.goalId); }
	if (!current || current.status === "complete") {
		ctx.ui.setStatus("goal", undefined);
		ctx.ui.setWidget("goal", undefined);
		return;
	}
	const stop = runtime.stopRequested ? " stopping" : "";
	const run = current.runActive ? ` ${current.turnsUsed}/${current.turnBudget}${stop}` : "";
	const phase = current.runActive ? "running" : current.status;
	ctx.ui.setStatus("goal", `goal: ${phase}${run}`);
	ctx.ui.setWidget("goal", [`goal: ${phase} ${current.turnsUsed}/${current.turnBudget} · /goal status for details`]);
}

export function findFinalAssistantMessage(messages: readonly unknown[]): { role: string; stopReason?: string; errorMessage?: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message || typeof message !== "object") continue;
		const candidate = message as Record<string, unknown>;
		if (candidate.role !== "assistant") continue;
		return {
			role: "assistant",
			stopReason: typeof candidate.stopReason === "string" ? candidate.stopReason : undefined,
			errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
		};
	}
	return undefined;
}
