/** Continuation run-state persistence for the CoAS scheduler. */

import { join } from "node:path";
import { ConfinedStore } from "./confined-store.js";
import type { CoasConfig } from "./coas-types.js";

export interface ScheduleRunState {
	readonly taskId: string;
	readonly runId: string;
	readonly requestId?: string;
	readonly status: "running" | "awaiting-approval" | "complete" | "failed" | "stopped" | "interrupted";
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly summary?: string;
	readonly nextAction?: string;
	readonly reason?: string;
	readonly lastUpdatedAt: string;
}

function scheduleRunsPath(config: CoasConfig, taskId: string): string {
	return join(config.coasHome, "schedule-runs", `${taskId}.json`);
}

function isRunStatus(value: unknown): value is ScheduleRunState["status"] {
	return value === "running" || value === "awaiting-approval" || value === "complete" || value === "failed" || value === "stopped" || value === "interrupted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadRunState(config: CoasConfig, taskId: string): Promise<ScheduleRunState | undefined> {
	const store = await ConfinedStore.openRoot(config.coasHome);
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
	const store = await ConfinedStore.createRoot(config.coasHome);
	await store.writePrivateFileAtomic(scheduleRunsPath(config, taskId), `${JSON.stringify(state, null, 2)}\n`);
}
