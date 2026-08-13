/**
 * Continuation run-state persistence for the pi-coas internal scheduler.
 */
import { ConfinedStore } from "./store.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";
import { scheduleRunsPath } from "./schedules.js";

const STALE_DAYS = 7;
const MAX_SUMMARY_CHARS = 500;
const MAX_NEXT_ACTION_CHARS = 200;
const MAX_INJECTED_CHARS = 750;

export interface ScheduleRunState {
	readonly taskId: string;
	readonly runId: string;
	/** Approval claim-check identity, when this run is gated. */
	readonly requestId?: string;
	readonly status: "running" | "awaiting-approval" | "complete" | "failed" | "stopped" | "interrupted";
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly summary?: string;
	readonly nextAction?: string;
	readonly reason?: string;
	readonly lastUpdatedAt: string;
}

export interface PriorSummary {
	readonly runId: string;
	readonly text: string;
	readonly stale: boolean;
}

function isRunStatus(value: unknown): value is ScheduleRunState["status"] {
	return value === "running" || value === "awaiting-approval" || value === "complete" || value === "failed" || value === "stopped" || value === "interrupted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadRunState(config: CoasConfig, taskId: string): Promise<ScheduleRunState | undefined> {
	const store = await ConfinedStore.openCoasHome(config);
	if (!store) return undefined;
	const raw = await store.readOptionalFile(scheduleRunsPath(config, taskId));
	if (raw === undefined) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) return undefined;
		if (
			typeof parsed.taskId !== "string" ||
			typeof parsed.runId !== "string" ||
			!isRunStatus(parsed.status) ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.lastUpdatedAt !== "string"
		) {
			return undefined;
		}
		return {
			taskId: parsed.taskId,
			runId: parsed.runId,
			requestId: typeof parsed.requestId === "string" ? parsed.requestId : undefined,
			status: parsed.status,
			startedAt: parsed.startedAt,
			completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : undefined,
			summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
			nextAction: typeof parsed.nextAction === "string" ? parsed.nextAction : undefined,
			reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
			lastUpdatedAt: parsed.lastUpdatedAt,
		};
	} catch {
		return undefined;
	}
}

export async function saveRunState(config: CoasConfig, taskId: string, state: ScheduleRunState): Promise<void> {
	const store = await ConfinedStore.createCoasHome(config);
	await store.writePrivateFileAtomic(scheduleRunsPath(config, taskId), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readPriorSummary(
	config: CoasConfig,
	schedule: ScheduleEntry,
	now: Date,
): Promise<PriorSummary | undefined> {
	if (!schedule.continuation) return undefined;
	const state = await loadRunState(config, schedule.taskId);
	if (!state || state.status !== "complete" || !state.summary) return undefined;

	const nowMs = now.getTime();
	const completedMs = state.completedAt ? Date.parse(state.completedAt) : Number.NaN;
	const stale = Number.isNaN(completedMs) || (nowMs - completedMs) / 86_400_000 > STALE_DAYS;

	const base = stale
		? `Prior run summary may be stale. Last completed: ${state.completedAt ?? "unknown"}.`
		: `Prior run (${state.runId}) summary:`;
	const summary = state.summary.slice(0, MAX_SUMMARY_CHARS);
	const nextAction = state.nextAction?.slice(0, MAX_NEXT_ACTION_CHARS);
	const parts = [base, summary];
	if (nextAction) parts.push(`Next action: ${nextAction}`);
	const text = parts.join("\n").slice(0, MAX_INJECTED_CHARS);
	return { runId: state.runId, text, stale };
}

export async function countContinuationReady(config: CoasConfig, schedules: ScheduleEntry[]): Promise<number> {
	let ready = 0;
	for (const schedule of schedules) {
		if (!schedule.continuation) continue;
		const state = await loadRunState(config, schedule.taskId);
		if (state?.status === "complete" && state.summary) ready++;
	}
	return ready;
}
