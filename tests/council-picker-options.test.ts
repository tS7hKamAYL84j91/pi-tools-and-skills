import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/agent-api.js", () => ({
	listLiveAgents: vi.fn(),
}));

import { listLiveAgents } from "../lib/agent-api.js";
import { councilPickerOptions } from "../extensions/council/members.js";

const mockListLiveAgents = listLiveAgents as ReturnType<typeof vi.fn>;

beforeEach(() => {
	mockListLiveAgents.mockReset();
});

const SNAPSHOT = ["openai/gpt-5.5", "anthropic/claude-opus", "google/gemini"];

describe("councilPickerOptions", () => {
	it("returns model snapshot only when no live agents", () => {
		mockListLiveAgents.mockReturnValue([]);
		const { options, describe } = councilPickerOptions(SNAPSHOT);
		expect(options).toEqual(SNAPSHOT);
		expect(describe("openai/gpt-5.5")).toBe("openai");
	});

	it("prepends agent: refs ahead of model snapshot", () => {
		mockListLiveAgents.mockReturnValue([
			{ id: "1", name: "bob", pid: 1, alive: true, heartbeatAge: 0, model: "anthropic/claude-haiku", status: "running" },
			{ id: "2", name: "alice", pid: 2, alive: true, heartbeatAge: 0, model: "ollama/glm-5.1:cloud", status: "running" },
		]);
		const { options, describe } = councilPickerOptions(SNAPSHOT);
		expect(options.slice(0, 2)).toEqual(["agent:bob", "agent:alice"]);
		expect(options.slice(2)).toEqual(SNAPSHOT);
		expect(describe("agent:bob")).toBe("live • anthropic/claude-haiku");
		expect(describe("agent:alice")).toBe("live • ollama/glm-5.1:cloud");
		expect(describe("openai/gpt-5.5")).toBe("openai");
	});

	it("forwards excludeAgentName to listLiveAgents (case-insensitive)", () => {
		mockListLiveAgents.mockReturnValue([]);
		councilPickerOptions(SNAPSHOT, "Mahwir");
		expect(mockListLiveAgents).toHaveBeenCalledWith("Mahwir");
	});

	it("describes an agent ref as 'live' when registry lookup fails", () => {
		mockListLiveAgents.mockReturnValue([]);
		const { describe } = councilPickerOptions(SNAPSHOT);
		expect(describe("agent:phantom")).toBe("live");
	});
});
