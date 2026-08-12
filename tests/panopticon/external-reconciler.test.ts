/**
 * Tests for reconciler handling of external agents.
 */
import { describe, expect, it } from "vitest";
import { checkAgentHealth } from "../../extensions/pi-panopticon/registry/reconciler.js";
import type { AgentRecord, Registry } from "../../extensions/pi-panopticon/types.js";
import { vi } from "vitest";

function makeRegistry(selfId: string, peers: AgentRecord[]): Registry {
	return {
		selfId,
		getRecord: vi.fn(() => undefined),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		isRootSession: vi.fn(() => true),
		readAllPeers: vi.fn(() => peers),
		flush: vi.fn(),
	};
}

describe("reconciler external agents", () => {
	it("does not flag external agents as terminated", () => {
		const external: AgentRecord = {
			id: "ext-1",
			name: "worker-1",
			kind: "external",
			pid: 0,
			cwd: "/tmp/worker",
			model: "external",
			startedAt: 0,
			heartbeat: 0,
			status: "waiting",
			mailboxPath: "/tmp/worker/inbox",
		};
		const registry = makeRegistry("self", [external]);
		const findings = checkAgentHealth(registry, "self");
		expect(findings).toHaveLength(0);
	});

	it("still surfaces pending messages for external agents", () => {
		const external: AgentRecord = {
			id: "ext-1",
			name: "worker-1",
			kind: "external",
			pid: 0,
			cwd: "/tmp/worker",
			model: "external",
			startedAt: 0,
			heartbeat: 0,
			status: "waiting",
			pendingMessages: 3,
			mailboxPath: "/tmp/worker/inbox",
		};
		const registry = makeRegistry("self", [external]);
		const findings = checkAgentHealth(registry, "self");
		expect(findings).toHaveLength(1);
		expect(findings[0]?.heuristic).toBe("pending-messages");
	});
});
