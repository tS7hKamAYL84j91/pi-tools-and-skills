/** Session-scoped, bounded liveness recovery for an active pi-goal run. */
import type { GoalSessionScope } from "./goal-binding.js";
import { loadGoal, saveGoal } from "./goal-persist.js";
import { stopGoal, updateGoal, withLifecycle } from "./goal-plan.js";
import type { GoalState } from "./goal-types.js";

const DEFAULT_SOFT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HARD_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MIN_TIMEOUT_MS = 1000;
const WATCHDOG_POLL_MS = 1000;

interface TimerHandle {
	unref?: () => void;
}

interface GoalWatchdogConfig {
	readonly softTimeoutMs: number;
	readonly hardTimeoutMs: number;
}

interface GoalWatchdogHost {
	readonly cwd: string;
	readonly scope?: GoalSessionScope;
	readonly now?: () => number;
	readonly schedule?: (callback: () => void, delayMs: number) => TimerHandle;
	readonly cancel?: (handle: TimerHandle) => void;
	readonly isTurnActive: () => boolean;
	readonly hasQueuedContinuation: () => boolean;
	readonly notify: (message: string, level: "info" | "warning" | "error") => void;
	readonly sendNudge: (state: GoalState) => void;
	readonly refresh?: (state: GoalState) => Promise<void>;
}

export function readGoalWatchdogConfig(env: NodeJS.ProcessEnv = process.env): GoalWatchdogConfig {
	const soft = boundedTimeout(env.PI_GOAL_LIVENESS_SOFT_MS, DEFAULT_SOFT_TIMEOUT_MS);
	const hard = boundedTimeout(env.PI_GOAL_LIVENESS_HARD_MS, DEFAULT_HARD_TIMEOUT_MS);
	return { softTimeoutMs: Math.min(soft, hard), hardTimeoutMs: Math.max(soft, hard) };
}

function boundedTimeout(value: string | undefined, fallback: number): number {
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(parsed)));
}

export function startGoalWatchdog(host: GoalWatchdogHost, config = readGoalWatchdogConfig()): () => void {
	let stopped = false;
	let timer: TimerHandle | undefined;
	let failureNotified = false;
	const now = host.now ?? Date.now;
	const schedule = host.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const cancel = host.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

	const scheduleNext = (): void => {
		if (stopped) return;
		timer = schedule(() => {
			void tick();
		}, Math.min(WATCHDOG_POLL_MS, config.softTimeoutMs));
		timer.unref?.();
	};

	const tick = async (): Promise<void> => {
		if (stopped) return;
		try {
			const state = await loadGoal(host.cwd, host.scope);
			if (state?.runActive && state.executionState !== "completed") {
				await evaluate(state);
			}
		} catch (error) {
			if (!failureNotified) {
				failureNotified = true;
				const message = error instanceof Error ? error.message : String(error);
				host.notify(`Goal liveness check failed (recovery remains bounded): ${message.slice(0, 200)}`, "warning");
			}
		} finally {
			scheduleNext();
		}
	};

	const evaluate = async (state: GoalState): Promise<void> => {
		const progressAt = Date.parse(state.lastProgressAt ?? state.updatedAt);
		if (!Number.isFinite(progressAt)) return;
		const elapsed = Math.max(0, now() - progressAt);
		if (elapsed >= config.hardTimeoutMs) {
			const failed = stopGoal(state, "failed", "Goal liveness hard timeout reached; run paused. Resume explicitly after checking the current turn and repository state.");
			await saveGoal(host.cwd, failed, host.scope);
			host.notify(failed.lastError ?? "Goal liveness hard timeout reached.", "error");
			await host.refresh?.(failed);
			return;
		}
		if (elapsed < config.softTimeoutMs) return;

		let current = state;
		if (!state.livenessWarningIssued) {
			current = withLifecycle(updateGoal(state, { livenessWarningIssued: true }), "progress", "Liveness soft threshold reached; recovery is bounded.");
			await saveGoal(host.cwd, current, host.scope);
			host.notify("Goal run has made no recorded progress; watching for an idle recovery opportunity.", "warning");
			await host.refresh?.(current);
		}
		if (current.livenessNudgeIssued || host.isTurnActive() || host.hasQueuedContinuation()) return;

		const nudged = updateGoal(current, { livenessNudgeIssued: true });
		await saveGoal(host.cwd, nudged, host.scope);
		try {
			host.sendNudge(nudged);
		host.notify("Goal liveness recovery nudged the idle current run once.", "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failed = stopGoal(nudged, "failed", `Goal liveness nudge failed: ${message}`);
		await saveGoal(host.cwd, failed, host.scope);
		host.notify(failed.lastError ?? "Goal liveness nudge failed.", "error");
		await host.refresh?.(failed);
	}
	};

	scheduleNext();
	return () => {
		stopped = true;
		if (timer) cancel(timer);
		timer = undefined;
	};
}
