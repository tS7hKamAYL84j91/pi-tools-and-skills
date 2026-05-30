import { describe, expect, it } from "vitest";
import { isLiveAgentRef, liveAgentName, runLiveAgentNode } from "../extensions/pi-teams/live-agent.js";
import type { InboundMessage, MessageTransport, DeliveryResult } from "../lib/message-transport.js";
import type { AgentInfo } from "../lib/agent-api.js";
import { RuntimeControlPlane } from "../lib/runtime-control-plane.js";

class FakeTransport implements MessageTransport {
	readonly sent: string[] = [];
	messages: InboundMessage[] = [];
	acked: string[] = [];

	async send(_peer: { id: string }, _from: string, message: string): Promise<DeliveryResult> {
		this.sent.push(message);
		return { accepted: true, immediate: false, reference: "sent" };
	}

	receive(): InboundMessage[] {
		return this.messages;
	}

	ack(_agentId: string, messageId: string): void {
		this.acked.push(messageId);
		this.messages = this.messages.filter((message) => message.id !== messageId);
	}

	prune(): void {}
	init(): void {}
	pendingCount(): number { return this.messages.length; }
	cleanup(): void {}
}

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
	return {
		id: "peer-1",
		name: "reviewer",
		registryName: "reviewer",
		pid: 123,
		alive: true,
		heartbeatAge: 5,
		model: "test/live-model",
		status: "waiting",
		...overrides,
	};
}

function runArgs(signal = new AbortController().signal) {
	return {
		binding: { role: "review", subagent: "agent:reviewer", label: "Reviewer" },
		model: "test/live-model",
		prompt: "Check this patch.",
		systemPrompt: "Be precise.",
		signal,
		parentId: "orchestrator-1",
		orchestratorName: "lead",
	};
}

describe("live-agent refs", () => {
	it("parses explicit agent refs only", () => {
		expect(isLiveAgentRef("agent:reviewer")).toBe(true);
		expect(liveAgentName("agent:reviewer")).toBe("reviewer");
		expect(isLiveAgentRef("reviewer")).toBe(false);
		expect(isLiveAgentRef("agent:")).toBe(false);
	});

	it("sends the rendered graph node package and captures the matching response", async () => {
		const transport = new FakeTransport();
		transport.messages = [{
			id: "msg-1",
			from: "reviewer",
			text: "TEAM_NODE_RESPONSE req-1\n\nLooks good.",
			ts: Date.now(),
		}];
		const result = await runLiveAgentNode(runArgs(), {
			findAgent: () => agent(),
			listAgents: () => [agent()],
			transport,
			requestId: () => "req-1",
		});
		expect(result.ok).toBe(true);
		expect(result.output).toBe("Looks good.");
		expect(result.member.agentName).toBe("reviewer");
		expect(transport.acked).toEqual(["msg-1"]);
		expect(transport.sent[0]).toContain("<system-prompt>\nBe precise.\n</system-prompt>");
		expect(transport.sent[0]).toContain("<prompt>\nCheck this patch.\n</prompt>");
	});

	it("registers and links live-agent entities to runtime team-run parents", async () => {
		const runtime = new RuntimeControlPlane();
		const parent = runtime.registerEntity({ id: "team-run-1", kind: "team_run", label: "Team run" });
		const transport = new FakeTransport();
		transport.messages = [{
			id: "msg-1",
			from: "reviewer",
			text: "TEAM_NODE_RESPONSE req-1\n\nDone.",
			ts: Date.now(),
		}];

		const result = await runLiveAgentNode({ ...runArgs(), runtimeParent: parent }, {
			findAgent: () => agent(),
			listAgents: () => [agent()],
			transport,
			requestId: () => "req-1",
			runtime,
		});

		expect(result.ok).toBe(true);
		expect(runtime.inspectEntity(parent)?.children).toEqual([{ id: "peer-1", kind: "agent" }]);
		expect(runtime.inspectEntity({ id: "peer-1", kind: "agent" })?.parent).toEqual(parent);
		expect(runtime.listEvents().map((event) => event.type)).toContain("runtime.entity.linked");
	});

	it("rejects unavailable and self live agents clearly", async () => {
		const transport = new FakeTransport();
		await expect(runLiveAgentNode(runArgs(), {
			findAgent: () => null,
			listAgents: () => [agent({ name: "other" })],
			transport,
			requestId: () => "req-1",
		})).rejects.toThrow("Available live agents: other");
		await expect(runLiveAgentNode(runArgs(), {
			findAgent: () => agent({ id: "orchestrator-1" }),
			listAgents: () => [agent()],
			transport,
			requestId: () => "req-1",
		})).rejects.toThrow("this orchestrator");
	});

	it("leaves fresh unmatched replies unread and archives stale protocol replies", async () => {
		const transport = new FakeTransport();
		transport.messages = [
			{ id: "fresh-wrong-token", from: "reviewer", text: "TEAM_NODE_RESPONSE other\n\nnot yours", ts: Date.now() },
			{ id: "fresh-wrong-sender", from: "other", text: "TEAM_NODE_RESPONSE req-1\n\nnot yours", ts: Date.now() },
			{ id: "stale-protocol", from: "reviewer", text: "TEAM_NODE_RESPONSE stale\n\nold", ts: Date.now() - 25 * 60 * 60 * 1000 },
			{ id: "match", from: "reviewer", text: "TEAM_NODE_RESPONSE req-1\n\nfinal", ts: Date.now() },
		];

		const result = await runLiveAgentNode(runArgs(), {
			findAgent: () => agent(),
			listAgents: () => [agent()],
			transport,
			requestId: () => "req-1",
		});

		expect(result.output).toBe("final");
		expect(transport.acked).toEqual(["stale-protocol", "match"]);
		expect(transport.messages.map((message) => message.id)).toEqual(["fresh-wrong-token", "fresh-wrong-sender"]);
	});

	it("honors cancellation while waiting for a response", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await runLiveAgentNode(runArgs(controller.signal), {
			findAgent: () => agent(),
			listAgents: () => [agent()],
			transport: new FakeTransport(),
			requestId: () => "req-1",
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBe("cancelled");
	});
});
