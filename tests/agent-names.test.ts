import { describe, it, expect } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";
import { agentDisplayName, findAgentByDisplayName } from "../lib/agent-names.js";

// Helper to create AgentRecords for testing
function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "default-id-12345",
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

describe("agentDisplayName", () => {
	it("returns plain name when agent name is unique", () => {
		const record = makeRecord({ id: "abc-123", name: "Alice" });
		const records = [
			record,
			makeRecord({ id: "def-456", name: "Bob" }),
		];
		expect(agentDisplayName(record, records)).toBe("Alice");
	});

	it("returns plain name when agent is the only one in records", () => {
		const record = makeRecord({ id: "abc-123", name: "Alice" });
		expect(agentDisplayName(record, [record])).toBe("Alice");
	});

	it("appends # and first 6 characters of id when agent name is duplicated", () => {
		const record1 = makeRecord({ id: "abcdefghi", name: "Alice" });
		const record2 = makeRecord({ id: "123456789", name: "alice" });
		const records = [record1, record2];

		expect(agentDisplayName(record1, records)).toBe("Alice#abcdef");
		expect(agentDisplayName(record2, records)).toBe("alice#123456");
	});
});

describe("findAgentByDisplayName", () => {
	it("returns undefined for empty or whitespace-only target", () => {
		const records = [makeRecord({ id: "abc-123", name: "Alice" })];
		expect(findAgentByDisplayName(records, "")).toBeUndefined();
		expect(findAgentByDisplayName(records, "   ")).toBeUndefined();
		expect(findAgentByDisplayName(records, "@")).toBeUndefined();
	});

	it("returns agent by unique name", () => {
		const record1 = makeRecord({ id: "abc-123", name: "Alice" });
		const record2 = makeRecord({ id: "def-456", name: "Bob" });
		const records = [record1, record2];

		expect(findAgentByDisplayName(records, "Alice")).toBe(record1);
		expect(findAgentByDisplayName(records, "alice")).toBe(record1); // case-insensitive
		expect(findAgentByDisplayName(records, "  Alice  ")).toBe(record1); // trimming
		expect(findAgentByDisplayName(records, "@alice")).toBe(record1); // leading @
	});

	it("returns agent by display label (name#id) when name is duplicated", () => {
		const record1 = makeRecord({ id: "abcdefghi", name: "Alice" });
		const record2 = makeRecord({ id: "123456789", name: "alice" });
		const records = [record1, record2];

		expect(findAgentByDisplayName(records, "Alice#abcdef")).toBe(record1);
		expect(findAgentByDisplayName(records, "alice#abcdef")).toBe(record1);
		expect(findAgentByDisplayName(records, "alice#123456")).toBe(record2);
	});

	it("returns undefined when trying to resolve a duplicated name without the #id suffix", () => {
		const record1 = makeRecord({ id: "abcdefghi", name: "Alice" });
		const record2 = makeRecord({ id: "123456789", name: "alice" });
		const records = [record1, record2];

		expect(findAgentByDisplayName(records, "Alice")).toBeUndefined();
	});
});
