import { Buffer } from "node:buffer";
import type { AgentRecord } from "../lib/agent-registry.js";
import { DirectMaildirBackend, type FleetBackend } from "./backend.js";
import type { FleetConfig } from "./config.js";
import { FleetStateStore, type Registration, type SendReceipt, type BroadcastSnapshot } from "./state-store.js";

export class FleetError extends Error {
	constructor(
		readonly code: string,
		readonly retryable = false,
	) {
		super(code);
	}
}

function registrationKey(principal: string, agentId: string, idempotencyKey: string): string {
	return JSON.stringify([principal, agentId, idempotencyKey]);
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return { text, truncated: false };
	let end = maxBytes;
	// If the cut lands inside a code point, omit that entire character.
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

/** Authorization, ownership and durable protocol semantics independent of MCP transports. */
export class FleetGateway {
	private readonly backend: FleetBackend;
	private readonly state: FleetStateStore;

	constructor(
		private readonly config: FleetConfig,
		dependencies: { backend?: FleetBackend; state?: FleetStateStore } = {},
	) {
		this.backend = dependencies.backend ?? new DirectMaildirBackend(config);
		this.state = dependencies.state ?? new FleetStateStore(config.stateDir);
	}

	/** Called only with an operator-authenticated identity, never a tool argument. */
	forPrincipal(principal: string): FleetGateway {
		return new FleetGateway({ ...this.config, principal }, { backend: this.backend, state: this.state });
	}

	async init(): Promise<void> {
		try {
			await this.state.init();
		} catch {
			throw new FleetError("INTERNAL");
		}
	}

	private checkWorkspace(alias: string): void {
		if (alias !== this.config.workspaceAlias) throw new FleetError("FORBIDDEN");
	}

	private async registration(): Promise<Registration> {
		const registration = await this.state.read((state) => state.registrations.get(this.config.principal));
		if (!registration) throw new FleetError("UNAUTHENTICATED");
		return registration;
	}

	private async backendAgents(): Promise<AgentRecord[]> {
		try {
			return await this.backend.agents();
		} catch {
			throw new FleetError("BACKEND_UNAVAILABLE", true);
		}
	}

	private async ownAgent(): Promise<AgentRecord> {
		const registration = await this.registration();
		const owner = (await this.backendAgents()).find((agent) => agent.id === registration.agentId);
		if (!owner) throw new FleetError("FORBIDDEN");
		return owner;
	}

	async register(workspace: string, displayName: string): Promise<{ agent_id: string }> {
		this.checkWorkspace(workspace);
		return this.state.update(async (state) => {
			const existing = state.registrations.get(this.config.principal);
			if (existing) {
				if (!(await this.backendAgents()).some((agent) => agent.id === existing.agentId && agent.kind === "external")) throw new FleetError("BACKEND_UNAVAILABLE", true);
				if (existing.displayName && existing.displayName !== displayName) throw new FleetError("CONFLICT");
				if (!existing.displayName) state.registrations.set(this.config.principal, { ...existing, displayName });
				return { agent_id: existing.agentId };
			}
			let record: AgentRecord;
			try {
				record = await this.backend.register(displayName);
			} catch (error) {
				if (error instanceof Error && error.message.includes("already registered")) {
					throw new FleetError("CONFLICT");
				}
				throw new FleetError("BACKEND_UNAVAILABLE", true);
			}
			state.registrations.set(this.config.principal, { agentId: record.id, displayName });
			state.unregistered.delete(this.config.principal);
			return { agent_id: record.id };
		});
	}

	async agents(workspace: string): Promise<unknown[]> {
		this.checkWorkspace(workspace);
		return (await this.backendAgents()).map((agent) => ({
			agent_id: agent.id,
			name: agent.name,
			kind: agent.kind,
			status: agent.status,
			observed_at: Date.now(),
			liveness_confidence: "registry-observed",
		}));
	}

	async send(
		workspace: string,
		recipientId: string,
		text: string,
		idempotencyKey: string,
		correlationId?: string,
	): Promise<SendReceipt> {
		this.checkWorkspace(workspace);
		if (Buffer.byteLength(text, "utf8") > this.config.limits.maxTextBytes) {
			throw new FleetError("INVALID_ARGUMENT");
		}
		if (!idempotencyKey || idempotencyKey.length > 256) throw new FleetError("INVALID_ARGUMENT");

		return this.state.update(async (state) => {
			const registration = state.registrations.get(this.config.principal);
			if (!registration) throw new FleetError("UNAUTHENTICATED");
			const key = registrationKey(this.config.principal, registration.agentId, idempotencyKey);
			const fingerprint = JSON.stringify([recipientId, text, correlationId]);
			const prior = state.idempotency.get(key);
			if (prior) {
				if (prior.fingerprint !== fingerprint) throw new FleetError("CONFLICT");
				if (!(await this.backendAgents()).some((agent) => agent.id === registration.agentId && agent.kind === "external")) throw new FleetError("FORBIDDEN");
				return prior.receipt;
			}

			const receipt = await this.deliver(registration.agentId, recipientId, text, correlationId);
			state.idempotency.set(key, { fingerprint, receipt });
			return receipt;
		});
	}

	private async deliver(ownerId: string, recipientId: string, text: string, correlationId?: string): Promise<SendReceipt> {
		const agents = await this.backendAgents();
		const owner = agents.find((agent) => agent.id === ownerId && agent.kind === "external");
		if (!owner) throw new FleetError("FORBIDDEN");
		const recipient = agents.find((agent) => agent.id === recipientId);
		if (!recipient) throw new FleetError("NOT_FOUND");
		let delivery: { accepted: boolean; reference?: string };
		try { delivery = await this.backend.send(owner, recipient, text); }
		catch { throw new FleetError("BACKEND_UNAVAILABLE", true); }
		if (!delivery.accepted || !delivery.reference) throw new FleetError("BACKEND_UNAVAILABLE", true);
		return { message_id: delivery.reference, accepted_at: Date.now(), state: "accepted", ...(correlationId ? { correlation_id: correlationId } : {}) };
	}

	async broadcast(workspace: string, text: string, idempotencyKey: string, filter?: string) {
		this.checkWorkspace(workspace);
		if (!idempotencyKey || idempotencyKey.length > 256 || Buffer.byteLength(text, "utf8") > this.config.limits.maxTextBytes) throw new FleetError("INVALID_ARGUMENT");
		const fingerprint = JSON.stringify([text, filter ?? null]);
		const initial = await this.state.update(async (state) => {
			const owner = state.registrations.get(this.config.principal);
			if (!owner) throw new FleetError("UNAUTHENTICATED");
			const key = registrationKey(this.config.principal, owner.agentId, idempotencyKey);
			let snapshot = state.broadcasts.get(key);
			if (snapshot && snapshot.fingerprint !== fingerprint) throw new FleetError("CONFLICT");
			const agents = await this.backendAgents();
			if (!agents.some((agent) => agent.id === owner.agentId && agent.kind === "external")) throw new FleetError("FORBIDDEN");
			if (!snapshot) {
				const targets = [...new Set(agents.filter((agent) => agent.id !== owner.agentId && (!filter || agent.name.toLowerCase().includes(filter.toLowerCase()))).map((agent) => agent.id))].sort();
				if (targets.length > 100) throw new FleetError("INVALID_ARGUMENT");
				snapshot = { fingerprint, targets, results: [] };
				state.broadcasts.set(key, snapshot);
			}
			return { key, ownerId: owner.agentId, snapshot };
		});
		let snapshot = initial.snapshot;
		for (const recipientId of snapshot.targets) {
			snapshot = await this.state.update(async (state) => {
				if (state.registrations.get(this.config.principal)?.agentId !== initial.ownerId) throw new FleetError("UNAUTHENTICATED");
				const current = state.broadcasts.get(initial.key);
				if (!current) throw new FleetError("INTERNAL");
				if (current.results.some((result) => result.recipient_id === recipientId && result.receipt)) return current;
				let result: BroadcastSnapshot["results"][number];
				try { result = { recipient_id: recipientId, receipt: await this.deliver(initial.ownerId, recipientId, text) }; }
				catch (error) {
					const failure = error instanceof FleetError ? error : new FleetError("INTERNAL");
					result = { recipient_id: recipientId, error: { code: failure.code, retryable: failure.retryable } };
				}
				const updated = { ...current, results: [...current.results.filter((entry) => entry.recipient_id !== recipientId), result] };
				state.broadcasts.set(initial.key, updated);
				return updated;
			});
		}
		const results = snapshot.targets.map((id) => snapshot.results.find((result) => result.recipient_id === id));
		return { state: results.every((result) => result?.receipt) ? "complete" : "partial", targets: snapshot.targets, results };
	}

	async inbox(workspace: string): Promise<unknown[]> {
		this.checkWorkspace(workspace);
		const owner = await this.ownAgent();
		return this.backend
			.inbox(owner)
			.slice(0, this.config.limits.pageSize)
			.map((message) => {
				const bounded = truncateUtf8(message.text, this.config.limits.maxTextBytes);
				return {
					message_id: message.id,
					sender_id: message.senderId ?? (/^ext-[A-Za-z0-9._-]+$/.test(message.from) ? message.from : null),
					sender_label: message.from,
					text: bounded.text,
					truncated: bounded.truncated,
					timestamp: message.ts,
					provenance: "maildir",
					authentication_confidence: "unknown",
				};
			});
	}

	async ack(workspace: string, messageIds: string[]): Promise<Array<{ message_id: string; acknowledged: boolean }>> {
		this.checkWorkspace(workspace);
		if (messageIds.length > this.config.limits.maxAckIds) throw new FleetError("INVALID_ARGUMENT");
		if (messageIds.some((id) => !/^[A-Za-z0-9._-]+\.json$/.test(id))) throw new FleetError("INVALID_ARGUMENT");

		return this.state.update(async (state) => {
			const registration = state.registrations.get(this.config.principal);
			if (!registration) throw new FleetError("UNAUTHENTICATED");
			const owner = (await this.backendAgents()).find((agent) => agent.id === registration.agentId);
			if (!owner) throw new FleetError("FORBIDDEN");
			const pending = new Set(this.backend.inbox(owner).map((message) => message.id));
			const ownerKey = JSON.stringify([this.config.principal, registration.agentId]);
			const acknowledged = state.acknowledged.get(ownerKey) ?? new Set<string>();
			const results = messageIds.map((messageId) => {
				if (acknowledged.has(messageId)) return { message_id: messageId, acknowledged: true };
				if (!pending.has(messageId)) return { message_id: messageId, acknowledged: false };
				try { this.backend.ack(owner, messageId); }
				catch { throw new FleetError("BACKEND_UNAVAILABLE", true); }
				acknowledged.add(messageId);
				return { message_id: messageId, acknowledged: true };
			});
			state.acknowledged.set(ownerKey, acknowledged);
			return results;
		});
	}

	async unregister(workspace: string, agentId: string): Promise<void> {
		this.checkWorkspace(workspace);
		await this.state.update(async (state) => {
			const existing = state.registrations.get(this.config.principal);
			if (!existing) {
				if (state.unregistered.get(this.config.principal) === agentId) return;
				throw new FleetError("FORBIDDEN");
			}
			if (existing.agentId !== agentId) throw new FleetError("FORBIDDEN");
			try {
				await this.backend.unregister(agentId);
			} catch {
				throw new FleetError("BACKEND_UNAVAILABLE", true);
			}
			state.registrations.delete(this.config.principal);
			state.unregistered.set(this.config.principal, agentId);
		});
	}

	async status(workspace: string): Promise<unknown> {
		this.checkWorkspace(workspace);
		const owner = await this.ownAgent();
		return {
			backend: "maildir",
			connected: true,
			own_identity: owner.id,
			pending: this.backend.pending(owner),
			observed_at: Date.now(),
		};
	}

	async ready(): Promise<boolean> {
		try {
			await this.backend.agents();
			return true;
		} catch {
			return false;
		}
	}
}
