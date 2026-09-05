/** Persistent, secret-free scheduler slot reservation state. */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ConfinedStore } from "./store.js";
import { assertSafeId } from "./store-paths.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

type SlotStatus =
	| "reserved"
	| "approval_pending"
	| "rejected"
	| "deferred"
	| "admitted"
	| "host_called"
	| "host_call_returned"
	| "failed_pre_handoff"
	| "uncertain";

export interface SlotClaim {
	readonly taskId: string;
	readonly slotKey: string;
	readonly token: string;
}

export interface ScheduleSlotState {
	claim(schedule: ScheduleEntry, key: string, now: Date): Promise<SlotClaim | undefined>;
	setApprovalPending(claim: SlotClaim, now: Date): Promise<boolean>;
	approve(claim: SlotClaim, now: Date): Promise<boolean>;
	admit(claim: SlotClaim, now: Date): Promise<boolean>;
	markHostCalled(claim: SlotClaim, now: Date): Promise<boolean>;
	markHostCallReturned(claim: SlotClaim, now: Date): Promise<boolean>;
	markFailedPreHandoff(claim: SlotClaim, now: Date): Promise<boolean>;
	markUncertain(claim: SlotClaim, now: Date): Promise<boolean>;
}

interface SlotRecord extends SlotClaim {
	readonly status: SlotStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly attemptId?: string;
}

function slotPath(config: CoasConfig, taskId: string, slotKey: string): string {
	assertSafeId("task id", taskId);
	const encodedSlot = Buffer.from(slotKey).toString("base64url");
	return join(config.coasHome, "schedule-runs", `${taskId}.slot-${encodedSlot}.json`);
}

async function storeFor(config: CoasConfig): Promise<ConfinedStore> {
	return await ConfinedStore.openCoasHome(config) ?? await ConfinedStore.createCoasHome(config);
}

function isSlotStatus(value: unknown): value is SlotStatus {
	return value === "reserved" || value === "approval_pending" || value === "rejected" || value === "deferred" ||
		value === "admitted" || value === "host_called" || value === "host_call_returned" ||
		value === "failed_pre_handoff" || value === "uncertain";
}

function parseRecord(raw: string, taskId?: string, slotKey?: string): SlotRecord | undefined {
	try {
		const value = JSON.parse(raw) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		const item = value as Record<string, unknown>;
		if ((taskId !== undefined && item.taskId !== taskId) || (slotKey !== undefined && item.slotKey !== slotKey) || typeof item.taskId !== "string" || typeof item.slotKey !== "string" || typeof item.token !== "string" || item.token.length < 16 ||
			!isSlotStatus(item.status) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
			Number.isNaN(Date.parse(item.createdAt)) || Number.isNaN(Date.parse(item.updatedAt))) return undefined;
		if (item.attemptId !== undefined && typeof item.attemptId !== "string") return undefined;
		// SAFETY: each field is validated above; the cast preserves the readonly domain shape.
		return item as unknown as SlotRecord;
	} catch {
		return undefined;
	}
}

async function readRecord(store: ConfinedStore, path: string, taskId?: string, slotKey?: string): Promise<SlotRecord | undefined> {
	const raw = await store.readOptionalFile(path);
	return raw === undefined ? undefined : parseRecord(raw, taskId, slotKey);
}

async function hasNewerDeliveredSlot(store: ConfinedStore, config: CoasConfig, taskId: string, slotKey: string): Promise<boolean> {
	const root = join(config.coasHome, "schedule-runs");
	if (!await store.fileExists(root)) return false;
	for (const entry of await store.readDirectory(root)) {
		if (!entry.isFile() || !entry.name.startsWith(`${taskId}.slot-`) || !entry.name.endsWith(".json")) continue;
		const record = await readRecord(store, join(root, entry.name), taskId);
		if (record?.status === "host_call_returned" && record.slotKey > slotKey) return true;
	}
	return false;
}

interface TransitionArgs {
	readonly config: CoasConfig;
	readonly claim: SlotClaim;
	readonly expected: SlotStatus | readonly SlotStatus[];
	readonly status: SlotStatus;
	readonly now: Date;
}

async function transition(args: TransitionArgs): Promise<boolean> {
	const { config, claim, expected, status, now } = args;
	const store = await storeFor(config);
	const path = slotPath(config, claim.taskId, claim.slotKey);
	return store.withAdvisoryLock(path, async () => {
		const current = await readRecord(store, path, claim.taskId, claim.slotKey);
		const expectedStatuses = Array.isArray(expected) ? expected : [expected];
		if (!current || current.token !== claim.token || !expectedStatuses.includes(current.status)) return false;
		const next: SlotRecord = { ...current, status, updatedAt: now.toISOString() };
		await store.writePrivateFileAtomic(path, `${JSON.stringify(next)}\n`);
		return true;
	});
}

export function createScheduleSlotState(getConfig: () => CoasConfig | undefined): ScheduleSlotState {
	return {
		claim: (schedule, key, now) => {
			const config = getConfig();
			return config ? claimScheduleSlot(config, schedule.taskId, key, now) : Promise.resolve(undefined);
		},
		setApprovalPending: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "reserved", status: "approval_pending", now }) : Promise.resolve(false);
		},
		approve: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "approval_pending", status: "admitted", now }) : Promise.resolve(false);
		},
		admit: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "reserved", status: "admitted", now }) : Promise.resolve(false);
		},
		markHostCalled: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "admitted", status: "host_called", now }) : Promise.resolve(false);
		},
		markHostCallReturned: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "host_called", status: "host_call_returned", now }) : Promise.resolve(false);
		},
		markFailedPreHandoff: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: "admitted", status: "failed_pre_handoff", now }) : Promise.resolve(false);
		},
		markUncertain: (claim, now) => {
			const config = getConfig();
			return config ? transition({ config, claim, expected: ["admitted", "host_called"], status: "uncertain", now }) : Promise.resolve(false);
		},
	};
}

async function claimScheduleSlot(config: CoasConfig, taskId: string, slotKey: string, now: Date): Promise<SlotClaim | undefined> {
	const store = await storeFor(config);
	const path = slotPath(config, taskId, slotKey);
	return store.withAdvisoryLock(path, async () => {
		if (await hasNewerDeliveredSlot(store, config, taskId, slotKey)) return undefined;
		const raw = await store.readOptionalFile(path);
		if (raw !== undefined) return undefined;
		const claim: SlotClaim = { taskId, slotKey, token: randomUUID() };
		const timestamp = now.toISOString();
		const record: SlotRecord = { ...claim, status: "reserved", createdAt: timestamp, updatedAt: timestamp };
		return await store.writePrivateFileExclusive(path, `${JSON.stringify(record)}\n`) ? claim : undefined;
	});
}
