import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "../lib/agent-registry.js";
import type { MessageMetadata, MessageType } from "../lib/message-transport.js";
import { createMaildirTransport, inboxPaths } from "../lib/transports/maildir.js";
import {
	listExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../extensions/pi-agent-hub/registry/external-registrar.js";
import type { FleetConfig } from "./config.js";
import { nativeInboxAvailable, visibleNativePeers } from "./native-peers.js";

export interface BackendMessage {
	id: string;
	from: string;
	senderId?: string;
	text: string;
	ts: number;
	type?: MessageType;
	inReplyTo?: string;
	correlationId?: string;
}

/** Whether an operator-configured native grant can be resolved right now. */
export type NativeAvailability = "unconfigured" | "available" | "unavailable";

export interface FleetBackend {
	register(displayName: string): Promise<AgentRecord>;
	unregister(agentId: string): Promise<void>;
	agents(): Promise<AgentRecord[]>;
	send(sender: AgentRecord, recipient: AgentRecord, text: string, meta?: MessageMetadata): Promise<{ accepted: boolean; reference?: string }>;
	inbox(owner: AgentRecord): BackendMessage[];
	ack(owner: AgentRecord, messageId: string): void;
	pending(owner: AgentRecord): number;
	nativeAvailability(): Promise<NativeAvailability>;
}

/** Same-host Agent Hub registration and direct Maildir messaging. */
export class DirectMaildirBackend implements FleetBackend {
	private readonly transport = createMaildirTransport();
	private readonly registrarConfig: { workspaceRoot: string; mailboxRoot: string };

	constructor(private readonly config: FleetConfig) {
		this.registrarConfig = { workspaceRoot: config.workspaceRoot, mailboxRoot: config.mailboxRoot };
	}

	async register(displayName: string): Promise<AgentRecord> {
		return registerExternalAgent(this.registrarConfig, { name: displayName }, await this.nativePeersOrNone());
	}

	unregister(agentId: string): Promise<void> {
		return unregisterExternalAgent(this.registrarConfig, agentId);
	}

	async agents(): Promise<AgentRecord[]> {
		return [...await listExternalAgents(this.registrarConfig), ...await this.nativePeersOrNone()];
	}

	async nativeAvailability(): Promise<NativeAvailability> {
		if (!this.config.nativeAgentId && !this.config.nativeSession) return "unconfigured";
		return (await this.resolveNativePeers()).available ? "available" : "unavailable";
	}

	/**
	 * A configured but unusable native grant (stale process, reloaded session,
	 * revoked authority) denies *native* access. It must not take the external
	 * mailbox service down with it: the external agents this process serves stay
	 * reachable, and `fleet_status` reports the grant as unavailable. Identity is
	 * never re-bound to a name, so no authority transfers to a new process.
	 */
	private async nativePeersOrNone(): Promise<AgentRecord[]> {
		return (await this.resolveNativePeers()).peers;
	}

	private async resolveNativePeers(): Promise<{ peers: AgentRecord[]; available: boolean }> {
		try {
			return { peers: await visibleNativePeers(this.config.nativeAgentId, this.config.nativeSession), available: true };
		} catch {
			return { peers: [], available: false };
		}
	}

	async send(
		sender: AgentRecord,
		recipient: AgentRecord,
		text: string,
		meta?: MessageMetadata,
	): Promise<{ accepted: boolean; reference?: string }> {
		if (recipient.kind !== "external" && !nativeInboxAvailable(recipient)) return { accepted: false };
		const delivery = await this.transport.send(recipient, sender.name, text, sender.id, meta);
		return { accepted: delivery.accepted, ...(delivery.reference ? { reference: delivery.reference } : {}) };
	}

	inbox(owner: AgentRecord): BackendMessage[] {
		return this.transport.receive(owner.id, owner.mailboxPath);
	}

	ack(owner: AgentRecord, messageId: string): void {
		this.transport.ack(owner.id, messageId, owner.mailboxPath);
		if (existsSync(join(inboxPaths(owner.id, owner.mailboxPath).new, messageId))) throw new Error("Inbox acknowledgement was not persisted");
	}

	pending(owner: AgentRecord): number {
		return this.transport.pendingCount(owner.id, owner.mailboxPath);
	}
}
