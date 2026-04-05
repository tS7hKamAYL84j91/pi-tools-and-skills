/**
 * Tests for peer resolution helpers (extensions/pi-panopticon/peers.ts)
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";
import type { Registry } from "../extensions/pi-panopticon/types.js";
import {
	getSelfName,
	resolvePeer,
	peerNames,
	notFound,
} from "../extensions/pi-panopticon/peers.js";

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "abc-123",
		name: "test-agent",
		pid: 12345,
		cwd: "/tmp/test",
		model: "anthropic/claude",
		startedAt: Date.now() - 60_000,
		heartbeat: Date.now(),
		status: "waiting",
		...overrides,
	};
}

function makeRegistry(selfRecord: AgentRecord | undefined, peers: AgentRecord[]): Registry {
	return {
		selfId: selfRecord?.id ?? "self-id",
		getRecord: () => selfRecord,
		readAllPeers: () => peers,
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		flush: vi.fn(),
	};
}

describe("getSelfName", () => {
	it("returns the agent's name", () => {
		const reg = makeRegistry(makeRecord({ name: "alice" }), []);
		expect(getSelfName(reg)).toBe("alice");
	});

	it("returns 'unknown' when no record", () => {
		const reg = makeRegistry(undefined, []);
		expect(getSelfName(reg)).toBe("unknown");
	});
});

describe("resolvePeer", () => {
	it("finds a peer by name (case-insensitive)", () => {
		const self = makeRecord({ id: "self", name: "me" });
		const peer = makeRecord({ id: "peer", name: "Alice" });
		const reg = makeRegistry(self, [self, peer]);

		expect(resolvePeer(reg, "alice")?.id).toBe("peer");
	});

	it("excludes self from results", () => {
		const self = makeRecord({ id: "self", name: "alice" });
		const reg = makeRegistry(self, [self]);

		expect(resolvePeer(reg, "alice")).toBeUndefined();
	});

	it("returns undefined when not found", () => {
		const reg = makeRegistry(makeRecord({ id: "self" }), []);
		expect(resolvePeer(reg, "nobody")).toBeUndefined();
	});
});

describe("peerNames", () => {
	it("returns comma-separated peer names", () => {
		const self = makeRecord({ id: "self", name: "me" });
		const a = makeRecord({ id: "a", name: "alice" });
		const b = makeRecord({ id: "b", name: "bob" });
		const reg = makeRegistry(self, [self, a, b]);

		expect(peerNames(reg)).toBe("alice, bob");
	});

	it("returns '(none)' when no peers", () => {
		const self = makeRecord({ id: "self", name: "me" });
		const reg = makeRegistry(self, [self]);

		expect(peerNames(reg)).toBe("(none)");
	});
});

describe("notFound", () => {
	it("returns a tool result with error details", () => {
		const reg = makeRegistry(makeRecord({ id: "self" }), []);
		const result = notFound(reg, "ghost");

		expect(result.content[0]?.text).toContain("ghost");
		expect(result.content[0]?.text).toContain("(none)");
		expect(result.details).toEqual({ name: "ghost", error: "not_found" });
	});
});
