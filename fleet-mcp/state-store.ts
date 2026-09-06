import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { assertPrivateFileForRead, assertPrivateFileTarget, auditPrivateDirectory } from "../lib/private-local-mode.js";
import { join } from "node:path";
import * as z from "zod/v4";
import { writeFileAtomic } from "../lib/file-persistence.js";

export interface SendReceipt {
	message_id: string;
	accepted_at: number;
	state: "accepted";
	correlation_id?: string;
}

export interface Registration {
	agentId: string;
	displayName: string;
}

export interface BroadcastSnapshot {
	fingerprint: string;
	targets: string[];
	results: Array<{ recipient_id: string; receipt?: SendReceipt; error?: { code: string; retryable: boolean } }>;
}

interface FleetState {
	registrations: Map<string, Registration>;
	idempotency: Map<string, { fingerprint: string; receipt: SendReceipt }>;
	acknowledged: Map<string, Set<string>>;
	unregistered: Map<string, string>;
	broadcasts: Map<string, BroadcastSnapshot>;
}

const receiptSchema = z.strictObject({
	message_id: z.string().min(1),
	accepted_at: z.number().int().nonnegative(),
	state: z.literal("accepted"),
	correlation_id: z.string().optional(),
});
const diskSchema = z.strictObject({
	version: z.union([z.literal(1), z.literal(2)]),
	registrations: z.array(
		z.strictObject({ principal: z.string().min(1), agentId: z.string().min(1), displayName: z.string() }),
	),
	idempotency: z.array(
		z.strictObject({ principalKey: z.string().min(1), fingerprint: z.string(), receipt: receiptSchema }),
	),
	acknowledged: z.array(
		z.strictObject({ principal: z.string().min(1), messageIds: z.array(z.string().min(1)) }),
	),
	unregistered: z.array(z.strictObject({ principal: z.string().min(1), agentId: z.string().min(1) })),
	broadcasts: z.array(z.strictObject({
		key: z.string(), fingerprint: z.string(), targets: z.array(z.string()).max(100),
		results: z.array(z.strictObject({ recipient_id: z.string(), receipt: receiptSchema.optional(), error: z.strictObject({ code: z.string(), retryable: z.boolean() }).optional() })).max(100),
	})).default([]),
});
const legacySchema = z.strictObject({
	registrations: z.record(z.string(), z.string()),
	idempotency: z.record(z.string(), z.strictObject({ fingerprint: z.string(), receipt: receiptSchema })),
});

function emptyState(): FleetState {
	return {
		registrations: new Map(),
		idempotency: new Map(),
		acknowledged: new Map(),
		unregistered: new Map(),
		broadcasts: new Map(),
	};
}

function cloneState(state: FleetState): FleetState {
	return {
		registrations: new Map(state.registrations),
		idempotency: new Map(state.idempotency),
		acknowledged: new Map([...state.acknowledged].map(([key, ids]) => [key, new Set(ids)])),
		unregistered: new Map(state.unregistered),
		broadcasts: new Map(state.broadcasts),
	};
}

function decodeState(input: unknown): FleetState {
	const current = diskSchema.safeParse(input);
	if (current.success) {
		const state: FleetState = {
			registrations: new Map(
				current.data.registrations.map(({ principal, agentId, displayName }) => [
					principal,
					{ agentId, displayName },
				]),
			),
			idempotency: new Map(
				current.data.idempotency.map(({ principalKey, fingerprint, receipt }) => [
					principalKey,
					{ fingerprint, receipt },
				]),
			),
			acknowledged: new Map(
				current.data.acknowledged.map(({ principal, messageIds }) => [principal, new Set(messageIds)]),
			),
			unregistered: new Map(current.data.unregistered.map(({ principal, agentId }) => [principal, agentId])),
			broadcasts: new Map(current.data.broadcasts.map(({ key, ...snapshot }) => [key, snapshot])),
		};
		return current.data.version === 1 ? upgradeGenerationKeys(state) : state;
	}

	const legacy = legacySchema.safeParse(input);
	if (!legacy.success) throw new Error("Unsupported or corrupt Fleet MCP state");
	const state = emptyState();
	for (const [principal, agentId] of Object.entries(legacy.data.registrations)) {
		state.registrations.set(principal, { agentId, displayName: "" });
	}
	for (const [principalKey, entry] of Object.entries(legacy.data.idempotency)) {
		state.idempotency.set(principalKey, entry);
	}
	return upgradeGenerationKeys(state);
}

/** External registration IDs are unique generations; retain older receipts without reusing them. */
function upgradeGenerationKeys(state: FleetState): FleetState {
	for (const [key, receipt] of [...state.idempotency]) {
		let parts: unknown;
		try { parts = JSON.parse(key); } catch { continue; }
		if (!Array.isArray(parts) || parts.length !== 2 || !parts.every((part) => typeof part === "string")) continue;
		const principal = parts[0];
		if (principal === undefined) continue;
		const registration = state.registrations.get(principal);
		if (!registration) continue;
		state.idempotency.set(JSON.stringify([parts[0], registration.agentId, parts[1]]), receipt);
		state.idempotency.delete(key);
	}
	for (const [principal, registration] of state.registrations) {
		const acknowledgements = state.acknowledged.get(principal);
		if (!acknowledgements) continue;
		state.acknowledged.set(JSON.stringify([principal, registration.agentId]), acknowledgements);
		state.acknowledged.delete(principal);
	}
	return state;
}

function encodeState(state: FleetState): string {
	return `${JSON.stringify({
		version: 2,
		registrations: [...state.registrations].map(([principal, registration]) => ({
			principal,
			...registration,
		})),
		idempotency: [...state.idempotency].map(([principalKey, entry]) => ({ principalKey, ...entry })),
		acknowledged: [...state.acknowledged].map(([principal, messageIds]) => ({
			principal,
			messageIds: [...messageIds],
		})),
		unregistered: [...state.unregistered].map(([principal, agentId]) => ({ principal, agentId })),
		broadcasts: [...state.broadcasts].map(([key, snapshot]) => ({ key, ...snapshot })),
	})}\n`;
}

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Versioned private state with an in-process serialization boundary for all mutations. */
export class FleetStateStore {
	private state = emptyState();
	private tail: Promise<void> = Promise.resolve();
	private readonly path: string;

	constructor(private readonly stateDir: string) {
		this.path = join(stateDir, "state.json");
	}

	async init(): Promise<void> {
		assertPrivateFileTarget(this.path);
		await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
		if (!auditPrivateDirectory(this.stateDir).ok) throw new Error("Fleet state directory must be private");
		try {
			const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				assertPrivateFileForRead(this.path);
				this.state = decodeState(JSON.parse(await file.readFile("utf8")));
			} finally { await file.close(); }
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
	}

	async read<T>(reader: (state: Readonly<FleetState>) => T): Promise<T> {
		await this.tail;
		return reader(this.state);
	}

	async update<T>(mutation: (state: FleetState) => T | Promise<T>): Promise<T> {
		const previous = this.tail;
		let release: () => void = () => {};
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			assertPrivateFileTarget(this.path);
			if (!auditPrivateDirectory(this.stateDir).ok) throw new Error("Fleet state directory must be private");
			const draft = cloneState(this.state);
			const result = await mutation(draft);
			assertPrivateFileTarget(this.path);
			await writeFileAtomic(this.path, encodeState(draft), { mode: 0o600 });
			this.state = draft;
			return result;
		} finally {
			release();
		}
	}
}
