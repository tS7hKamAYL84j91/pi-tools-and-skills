import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";
import type { DeliveryResult, InboundMessage, MessageTransport } from "../lib/message-transport.js";
import {
	ackRuntimeAgentMessage,
	receiveRuntimeAgentMessages,
	sendRuntimeAgentMessage,
} from "../lib/runtime-agent-messaging.js";
import { RuntimeControlPlane } from "../lib/runtime-control-plane.js";

class FakeTransport implements MessageTransport {
	readonly sent: string[] = [];
	messages: InboundMessage[] = [];
	acked: string[] = [];

	async send(_peer: AgentRecord, _from: string, message: string): Promise<DeliveryResult> {
		this.sent.push(message);
		return { accepted: true, immediate: false, reference: "queued" };
	}

	receive(): InboundMessage[] { return this.messages; }
	ack(_agentId: string, messageId: string): void { this.acked.push(messageId); }
	prune(): void {}
	init(): void {}
	pendingCount(): number { return this.messages.length; }
	cleanup(): void {}
}

function agent(): AgentRecord {
	return {
		id: "agent-1",
		name: "reviewer",
		pid: 123,
		cwd: "/repo",
		model: "test/model",
		startedAt: 1,
		heartbeat: 2,
		status: "running",
	};
}

describe("runtime agent messaging adapter", () => {
	it("routes sends through the transport and emits runtime events", async () => {
		const runtime = new RuntimeControlPlane();
		const parent = runtime.registerEntity({ id: "team-run-1", kind: "team_run", label: "Team run" });
		const transport = new FakeTransport();

		const result = await sendRuntimeAgentMessage(transport, {
			agent: agent(),
			from: "lead",
			message: "hello",
			parent,
			runtime,
		});

		expect(result.accepted).toBe(true);
		expect(transport.sent).toEqual(["hello"]);
		expect(runtime.listEvents().map((event) => event.type)).toContain("runtime.message.accepted");
	});

	it("keeps receive and ack behind the runtime adapter boundary", () => {
		const transport = new FakeTransport();
		transport.messages = [{ id: "msg-1", from: "peer", text: "ok", ts: 1 }];

		expect(receiveRuntimeAgentMessages(transport, "agent-1")).toHaveLength(1);
		ackRuntimeAgentMessage(transport, "agent-1", "msg-1");
		expect(transport.acked).toEqual(["msg-1"]);
	});
});
