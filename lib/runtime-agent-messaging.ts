/** Panopticon runtime messaging adapter for agent-linked orchestration. */

import type { AgentRecord } from "./agent-registry.js";
import type { DeliveryResult, InboundMessage, MessageTransport } from "./message-transport.js";
import type { RuntimeControlPlane, RuntimeEntityRef } from "./runtime-control-plane.js";

export interface RuntimeAgentMessageRequest {
	readonly agent: AgentRecord;
	readonly from: string;
	readonly message: string;
	readonly parent?: RuntimeEntityRef;
	runtime?: RuntimeControlPlane;
}

export async function sendRuntimeAgentMessage(
	transport: MessageTransport,
	request: RuntimeAgentMessageRequest,
): Promise<DeliveryResult> {
	const entity: RuntimeEntityRef = { id: request.agent.id, kind: "agent" };
	request.runtime?.emitEvent({
		type: "runtime.message.send_requested",
		entity,
		parent: request.parent,
		message: request.from,
	});
	const result = await transport.send(request.agent, request.from, request.message);
	request.runtime?.emitEvent({
		type: result.accepted ? "runtime.message.accepted" : "runtime.message.rejected",
		entity,
		parent: request.parent,
		message: result.error ?? result.reference,
	});
	return result;
}

export function receiveRuntimeAgentMessages(
	transport: MessageTransport,
	agentId: string,
): InboundMessage[] {
	return transport.receive(agentId);
}

export function ackRuntimeAgentMessage(
	transport: MessageTransport,
	agentId: string,
	messageId: string,
): void {
	transport.ack(agentId, messageId);
}
