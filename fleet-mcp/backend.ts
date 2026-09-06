import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "../lib/agent-registry.js";
import { createMaildirTransport, inboxPaths } from "../lib/transports/maildir.js";
import {
	listExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../extensions/pi-panopticon/registry/external-registrar.js";
import type { FleetConfig } from "./config.js";
import { nativeInboxAvailable, visibleNativePeers } from "./native-peers.js";

export interface BackendMessage {
	id: string;
	from: string;
	senderId?: string;
	text: string;
	ts: number;
}

export interface FleetBackend {
	register(displayName: string): Promise<AgentRecord>;
	unregister(agentId: string): Promise<void>;
	agents(): Promise<AgentRecord[]>;
	send(sender: AgentRecord, recipient: AgentRecord, text: string): Promise<{ accepted: boolean; reference?: string }>;
	inbox(owner: AgentRecord): BackendMessage[];
	ack(owner: AgentRecord, messageId: string): void;
	pending(owner: AgentRecord): number;
}

/** Same-host Panopticon registration and direct Maildir messaging. */
export class DirectMaildirBackend implements FleetBackend {
	private readonly transport = createMaildirTransport();
	private readonly registrarConfig: { workspaceRoot: string; mailboxRoot: string };

	constructor(private readonly config: FleetConfig) {
		this.registrarConfig = { workspaceRoot: config.workspaceRoot, mailboxRoot: config.mailboxRoot };
	}

	async register(displayName: string): Promise<AgentRecord> {
		return registerExternalAgent(this.registrarConfig, { name: displayName }, await visibleNativePeers(this.config.nativeAgentId));
	}

	unregister(agentId: string): Promise<void> {
		return unregisterExternalAgent(this.registrarConfig, agentId);
	}

	async agents(): Promise<AgentRecord[]> {
		return [...await listExternalAgents(this.registrarConfig), ...await visibleNativePeers(this.config.nativeAgentId)];
	}

	async send(
		sender: AgentRecord,
		recipient: AgentRecord,
		text: string,
	): Promise<{ accepted: boolean; reference?: string }> {
		if (recipient.kind !== "external" && !nativeInboxAvailable(recipient)) return { accepted: false };
		const delivery = await this.transport.send(recipient, sender.name, text, sender.id);
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
