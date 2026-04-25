import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/agent-api.js", () => ({
	findAgentByName: vi.fn(),
}));

import { findAgentByName } from "../lib/agent-api.js";
import {
	resolveChairman,
	resolveMembers,
} from "../extensions/council/agent-ref.js";

const mockFind = findAgentByName as ReturnType<typeof vi.fn>;

beforeEach(() => {
	mockFind.mockReset();
});

describe("resolveMembers — model entries", () => {
	it("passes through model ids as plain CouncilMembers labelled A, B, C…", () => {
		const result = resolveMembers([
			"openai/gpt-5.5",
			"anthropic/claude-opus-4-6",
			"google/gemini-2.5-pro",
		]);
		expect(result.errors).toEqual([]);
		expect(result.agents).toEqual([]);
		expect(result.members).toEqual([
			{ label: "Agent A", model: "openai/gpt-5.5" },
			{ label: "Agent B", model: "anthropic/claude-opus-4-6" },
			{ label: "Agent C", model: "google/gemini-2.5-pro" },
		]);
		expect(mockFind).not.toHaveBeenCalled();
	});
});

describe("resolveMembers — duplicate detection", () => {
	it("warns when the same live agent is listed twice", () => {
		mockFind.mockImplementation((name: string) => {
			if (name === "bob") {
				return {
					id: "bob-id",
					name: "bob",
					pid: 1,
					alive: true,
					heartbeatAge: 1_000,
					model: "anthropic/claude-opus-4-6",
					status: "running",
				};
			}
			return null;
		});
		const result = resolveMembers(["agent:bob", "openai/gpt-5.5", "agent:bob"]);
		expect(result.errors).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/bob/);
		expect(result.warnings[0]).toMatch(/once per stage/);
	});
});

describe("resolveMembers — agent: entries", () => {
	it("looks up live agents and attaches agentName/agentId/model", () => {
		mockFind.mockImplementation((name: string) => {
			if (name === "bob") {
				return {
					id: "111-aaa",
					name: "bob",
					pid: 1234,
					alive: true,
					heartbeatAge: 5_000,
					model: "anthropic/claude-opus-4-6",
					status: "running",
				};
			}
			return null;
		});
		const result = resolveMembers(["openai/gpt-5.5", "agent:bob"]);
		expect(result.errors).toEqual([]);
		expect(result.members).toEqual([
			{ label: "Agent A", model: "openai/gpt-5.5" },
			{
				label: "Agent B",
				model: "anthropic/claude-opus-4-6",
				agentName: "bob",
				agentId: "111-aaa",
			},
		]);
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]?.heartbeatStale).toBe(false);
	});

	it("flags unregistered agents as errors", () => {
		mockFind.mockReturnValue(null);
		const result = resolveMembers(["agent:nobody"]);
		expect(result.members).toEqual([]);
		expect(result.errors).toEqual([
			{ ref: "agent:nobody", reason: 'agent "nobody" is not registered' },
		]);
	});

	it("flags agents whose process is dead", () => {
		mockFind.mockReturnValue({
			id: "x",
			name: "ghost",
			pid: 1,
			alive: false,
			heartbeatAge: 1_000_000,
			model: "anthropic/claude",
			status: "terminated",
		});
		const result = resolveMembers(["agent:ghost"]);
		expect(result.errors[0]?.reason).toMatch(/not alive/);
	});

	it("marks heartbeatStale when the agent record is older than STALE_MS", () => {
		mockFind.mockReturnValue({
			id: "z",
			name: "drowsy",
			pid: 9,
			alive: true,
			heartbeatAge: 60_000,
			model: "openai/gpt-5",
			status: "waiting",
		});
		const result = resolveMembers(["agent:drowsy"]);
		expect(result.agents[0]?.heartbeatStale).toBe(true);
	});
});

describe("resolveChairman", () => {
	it("returns a model chairman for plain model ids", () => {
		const r = resolveChairman("openai/gpt-5.5");
		expect(r.error).toBeUndefined();
		expect(r.chairman).toEqual({ label: "Chairman", model: "openai/gpt-5.5" });
	});

	it("resolves an agent: chairman to a CouncilMember with agent fields", () => {
		mockFind.mockReturnValue({
			id: "carol-id",
			name: "carol",
			pid: 42,
			alive: true,
			heartbeatAge: 1_000,
			model: "google/gemini-2.5-pro",
			status: "running",
		});
		const r = resolveChairman("agent:carol");
		expect(r.error).toBeUndefined();
		expect(r.chairman).toEqual({
			label: "Chairman",
			model: "google/gemini-2.5-pro",
			agentName: "carol",
			agentId: "carol-id",
		});
		expect(r.agent?.name).toBe("carol");
	});

	it("returns an error for an unregistered chairman", () => {
		mockFind.mockReturnValue(null);
		const r = resolveChairman("agent:phantom");
		expect(r.chairman).toBeNull();
		expect(r.error?.reason).toMatch(/not registered/);
	});
});
