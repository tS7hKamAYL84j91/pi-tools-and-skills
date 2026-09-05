import type { AgentRecord } from "../lib/agent-registry.js";
import { createMaildirTransport } from "../lib/transports/maildir.js";
import {
	listExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../extensions/pi-panopticon/registry/external-registrar.js";
import type { FleetConfig } from "./config.js";

export interface BackendMessage {
	id: string;
	from: string;
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

/** Adapter for the approved v1 backend: Panopticon registration plus direct Maildir messaging. */
export class DirectMaildirBackend implements FleetBackend {
	private readonly transport = createMaildirTransport();
	private readonly registrarConfig: { workspaceRoot: string; mailboxRoot: string };

	constructor(config: FleetConfig) {
		this.registrarConfig = { workspaceRoot: config.workspaceRoot, mailboxRoot: config.mailboxRoot };
	}

	register(displayName: string): Promise<AgentRecord> {
		return registerExternalAgent(this.registrarConfig, { name: displayName });
	}

	unregister(agentId: string): Promise<void> {
		return unregisterExternalAgent(this.registrarConfig, agentId);
	}

	agents(): Promise<AgentRecord[]> {
		return listExternalAgents(this.registrarConfig);
	}

	async send(
		sender: AgentRecord,
		recipient: AgentRecord,
		text: string,
	): Promise<{ accepted: boolean; reference?: string }> {
		const delivery = await this.transport.send(recipient, sender.id, text);
		return { accepted: delivery.accepted, ...(delivery.reference ? { reference: delivery.reference } : {}) };
	}

	inbox(owner: AgentRecord): BackendMessage[] {
		return this.transport.receive(owner.id, owner.mailboxPath);
	}

	ack(owner: AgentRecord, messageId: string): void {
		this.transport.ack(owner.id, messageId, owner.mailboxPath);
	}

	pending(owner: AgentRecord): number {
		return this.transport.pendingCount(owner.id, owner.mailboxPath);
	}
}
