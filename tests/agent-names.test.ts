import { describe, expect, it } from "vitest";
import { agentDisplayName } from "../lib/agent-names.js";
import type { AgentRecord } from "../lib/agent-registry.js";

describe("agentDisplayName", () => {
	const mockAgent = (id: string, name: string): AgentRecord =>
		({
			id,
			name,
			pid: 1,
			cwd: "/",
			model: "mock-model",
			startedAt: 0,
		}) as AgentRecord;

	it("Unique agent name returns just the name", () => {
		const agent1 = mockAgent("12345678", "Alice");
		const agent2 = mockAgent("87654321", "Bob");
		const records = [agent1, agent2];

		expect(agentDisplayName(agent1, records)).toBe("Alice");
		expect(agentDisplayName(agent2, records)).toBe("Bob");
	});

	it("Duplicate agent names return the name appended with a # and the first 6 characters of the id", () => {
		const agent1 = mockAgent("12345678", "Alice");
		const agent2 = mockAgent("abcdefgh", "Alice");
		const records = [agent1, agent2];

		expect(agentDisplayName(agent1, records)).toBe("Alice#123456");
		expect(agentDisplayName(agent2, records)).toBe("Alice#abcdef");
	});

	it("Case-insensitive duplicate agent names are also treated as duplicates", () => {
		const agent1 = mockAgent("12345678", "Alice");
		const agent2 = mockAgent("abcdefgh", "ALICE");
		const records = [agent1, agent2];

		expect(agentDisplayName(agent1, records)).toBe("Alice#123456");
		expect(agentDisplayName(agent2, records)).toBe("ALICE#abcdef");
	});
});
