import { mkdir, readFile } from "node:fs/promises";
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

interface FleetState {
	registrations: Map<string, Registration>;
	idempotency: Map<string, { fingerprint: string; receipt: SendReceipt }>;
	acknowledged: Map<string, Set<string>>;
	unregistered: Map<string, string>;
}

const receiptSchema = z.strictObject({
	message_id: z.string().min(1),
	accepted_at: z.number().int().nonnegative(),
	state: z.literal("accepted"),
	correlation_id: z.string().optional(),
});
const diskSchema = z.strictObject({
	version: z.literal(1),
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
	};
}

function cloneState(state: FleetState): FleetState {
	return {
		registrations: new Map(state.registrations),
		idempotency: new Map(state.idempotency),
		acknowledged: new Map([...state.acknowledged].map(([key, ids]) => [key, new Set(ids)])),
		unregistered: new Map(state.unregistered),
	};
}

function decodeState(input: unknown): FleetState {
	const current = diskSchema.safeParse(input);
	if (current.success) {
		return {
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
		};
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
	return state;
}

function encodeState(state: FleetState): string {
	return `${JSON.stringify({
		version: 1,
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
		await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
		try {
			this.state = decodeState(JSON.parse(await readFile(this.path, "utf8")));
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
			const draft = cloneState(this.state);
			const result = await mutation(draft);
			await writeFileAtomic(this.path, encodeState(draft), { mode: 0o600 });
			this.state = draft;
			return result;
		} finally {
			release();
		}
	}
}
