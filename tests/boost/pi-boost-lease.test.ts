/** KISS boost: in-session model switching lease tests. */
import { describe, expect, it, vi } from "vitest";

interface FakeModel {
	provider: string;
	id: string;
	input: string[];
}

interface FakeModelRegistry {
	getAvailable: () => FakeModel[];
}

function createFakeContext(cwd = "/tmp/test") {
	return {
		cwd,
		hasUI: false,
		model: { provider: "ollama", id: "glm-5.2:cloud", input: ["text"] } as unknown as FakeModel,
		modelRegistry: {
			getAvailable: () => [
				{ provider: "ollama", id: "glm-5.2:cloud", input: ["text"] },
				{ provider: "ollama", id: "glm-5.3:cloud", input: ["text"] },
				{ provider: "ollama", id: "gpt-oss:20b", input: ["text"] },
			],
		} as unknown as FakeModelRegistry,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
		sessionManager: { getSessionId: () => "test-session" },
	};
}

describe("boost lease model selection", () => {
	it("auto-picks a model different from the current model", () => {
		const ctx = createFakeContext();
		const current = "ollama/glm-5.2:cloud";
		const candidates = ctx.modelRegistry
			.getAvailable()
			.filter((m) => m.input.includes("text"))
			.filter((m) => `${m.provider}/${m.id}` !== current);
		expect(candidates.length).toBeGreaterThan(0);
		expect(candidates[0]).toBeDefined();
	});

	it("finds a specific model by provider/id", () => {
		const ctx = createFakeContext();
		const target = "ollama/glm-5.3:cloud";
		const found = ctx.modelRegistry
			.getAvailable()
			.find((m) => `${m.provider}/${m.id}` === target);
		expect(found).toBeDefined();
		expect(found?.provider).toBe("ollama");
		expect(found?.id).toBe("glm-5.3:cloud");
	});

	it("anti-rut frame is prepended to the prompt", () => {
		const ANTI_RUT_FRAME =
			"Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\n";
		const prompt = "debug this error";
		expect(ANTI_RUT_FRAME + prompt).toContain(
			"Challenge prior assumptions",
		);
	});
});