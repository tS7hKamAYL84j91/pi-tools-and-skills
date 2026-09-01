/** Continuation run-state persistence for the pi-coas internal scheduler. */

import { ConfinedStore } from "./store.js";
import { loadRunState as loadSharedRunState, saveRunState as saveSharedRunState } from "./lib/coas-run-state.js";
import { scheduleRunsPath } from "./schedules.js";
import { assertSafeId } from "./store-paths.js";
import type { ScheduleRunState } from "./lib/coas-run-state.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

export type { ScheduleRunState } from "./lib/coas-run-state.js";

export async function loadRunState(config: CoasConfig, taskId: string): Promise<ScheduleRunState | undefined> {
	try {
		return await loadSharedRunState(config, taskId);
	} catch (error: unknown) {
		if (error instanceof Error) throw normalizeCoasStoreError(error);
		throw error;
	}
}

export async function saveRunState(config: CoasConfig, taskId: string, state: ScheduleRunState): Promise<void> {
	try {
		await saveSharedRunState(config, taskId, state);
	} catch (error: unknown) {
		if (error instanceof Error) throw normalizeCoasStoreError(error);
		throw error;
	}
}

function normalizeCoasStoreError(error: Error): Error {
	if (error.message.includes("Refusing symlinked path component")) {
		return new Error(error.message.replace("Refusing symlinked path component", "Refusing symlinked CoAS path component"));
	}
	if (error.message.includes("Refusing symlinked root")) {
		return new Error(error.message.replace("Refusing symlinked root", "Refusing symlinked CoAS root"));
	}
	return error;
}

const STALE_DAYS = 7;
const MAX_SUMMARY_CHARS = 500;
const MAX_NEXT_ACTION_CHARS = 200;
const MAX_INJECTED_CHARS = 750;
const MAX_HISTORY_ENTRIES = 100;

/** Outcome recorded in the per-task decision history. */
export type ScheduleRunOutcome =
	| "queued"
	| "dropped"
	| "awaiting-approval"
	| "interrupted"
	| "skipped-diminishing"
	| "skipped-budget"
	| "skipped-pending-approval"
	| "skipped-drift";

export interface ScheduleRunHistoryEntry {
	readonly runId: string;
	readonly startedAt: string;
	readonly outcome: ScheduleRunOutcome;
	readonly summary?: string;
}

export interface ScheduleRunHistory {
	readonly taskId: string;
	readonly entries: ScheduleRunHistoryEntry[];
}

function runHistoryPath(config: CoasConfig, taskId: string): string {
	assertSafeId("task id", taskId);
	return `${scheduleRunsPath(config, taskId)}.history.json`;
}

function isScheduleRunOutcome(value: unknown): value is ScheduleRunOutcome {
	return (
		value === "queued" ||
		value === "dropped" ||
		value === "awaiting-approval" ||
		value === "interrupted" ||
		value === "skipped-diminishing" ||
		value === "skipped-budget" ||
		value === "skipped-pending-approval" ||
		value === "skipped-drift"
	);
}

export function countRecentOutcomes(history: ScheduleRunHistory, outcome: ScheduleRunOutcome, lookback: number): number {
	let count = 0;
	for (let i = history.entries.length - 1; i >= 0 && count < lookback; i--) {
		if (history.entries[i]?.outcome === outcome) count++;
		else break;
	}
	return count;
}

export async function loadRunHistory(config: CoasConfig, taskId: string): Promise<ScheduleRunHistory | undefined> {
	const store = await ConfinedStore.openCoasHome(config);
	if (!store) return undefined;
	const raw = await store.readOptionalFile(runHistoryPath(config, taskId));
	if (raw === undefined) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const record = parsed as Record<string, unknown>;
		if (typeof record.taskId !== "string" || !Array.isArray(record.entries)) return undefined;
		const entries: ScheduleRunHistoryEntry[] = [];
		for (const item of record.entries) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const entry = item as Record<string, unknown>;
			if (
				typeof entry.runId !== "string" ||
				typeof entry.startedAt !== "string" ||
				!isScheduleRunOutcome(entry.outcome)
			) {
				continue;
			}
			entries.push({
				runId: entry.runId,
				startedAt: entry.startedAt,
				outcome: entry.outcome,
				summary: typeof entry.summary === "string" ? entry.summary : undefined,
			});
		}
		return { taskId: record.taskId, entries };
	} catch {
		return undefined;
	}
}

export async function appendRunHistory(
	config: CoasConfig,
	taskId: string,
	entry: ScheduleRunHistoryEntry,
): Promise<void> {
	const existing = await loadRunHistory(config, taskId);
	const entries = existing?.entries.slice(-MAX_HISTORY_ENTRIES + 1) ?? [];
	const next: ScheduleRunHistory = {
		taskId,
		entries: [...entries, entry],
	};
	const store = await ConfinedStore.createCoasHome(config);
	await store.writePrivateFileAtomic(runHistoryPath(config, taskId), `${JSON.stringify(next, null, 2)}\n`);
}

export interface PriorSummary {
	readonly runId: string;
	readonly text: string;
	readonly stale: boolean;
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
