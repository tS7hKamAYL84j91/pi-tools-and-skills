import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pairPrimerPrompt } from "../extensions/pi-llm-council/pair-prompts.js";
import { critiquePrompt } from "../extensions/pi-llm-council/prompts.js";
import { resolveCouncilSettings } from "../extensions/pi-llm-council/settings.js";
import type {
	CouncilMember,
	ModelRun,
} from "../extensions/pi-llm-council/types.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-llm-council",
	"config",
	"config.json",
);
const NO_SETTINGS = "/nonexistent/path/settings.json";
const PROMPTS_CONFIG = resolveCouncilSettings(NO_SETTINGS, CONFIG_PATH).prompts;

const memberA: CouncilMember = { label: "Agent A", model: "openai/gpt-5.5" };
const memberB: CouncilMember = {
	label: "Agent B",
	model: "anthropic/claude-opus-4-6",
};
const memberC: CouncilMember = {
	label: "Agent C",
	model: "google/gemini-2.5-pro",
};

function makeRun(member: CouncilMember, output: string): ModelRun {
	return {
		member,
		prompt: "Q?",
		systemPrompt: "sys",
		output,
		durationMs: 1,
		ok: true,
	};
}

describe("critiquePrompt self-exclusion", () => {
	const generation = [
		makeRun(memberA, "A's distinctive answer signature"),
		makeRun(memberB, "B's distinctive answer signature"),
		makeRun(memberC, "C's distinctive answer signature"),
	];
	const members = [memberA, memberB, memberC];

	it("omits the viewer's own answer from the critique input", () => {
		const prompt = critiquePrompt({
			originalPrompt: "Q?",
			generation,
			members,
			viewer: memberB,
			promptsConfig: PROMPTS_CONFIG,
		});
		expect(prompt).toContain("A's distinctive answer signature");
		expect(prompt).toContain("C's distinctive answer signature");
		expect(prompt).not.toContain("B's distinctive answer signature");
	});

	it("anonymizes peer model ids in the included answers", () => {
		const generationWithModelMention = [
			makeRun(memberA, "openai/gpt-5.5 says ..."),
			makeRun(memberB, "B's answer"),
		];
		const prompt = critiquePrompt({
			originalPrompt: "Q?",
			generation: generationWithModelMention,
			members,
			viewer: memberB,
			promptsConfig: PROMPTS_CONFIG,
		});
		expect(prompt).not.toContain("openai/gpt-5.5");
		expect(prompt).toContain("Agent A says ...");
	});

	it("notes self-exclusion explicitly so reviewers don't look for their answer", () => {
		const prompt = critiquePrompt({
			originalPrompt: "Q?",
			generation,
			members,
			viewer: memberA,
			promptsConfig: PROMPTS_CONFIG,
		});
		expect(prompt).toMatch(/your own answer is excluded/i);
	});
});

describe("pairPrimerPrompt", () => {
	it("renders the configured pair primer template", () => {
		const prompt = pairPrimerPrompt({
			pairName: "review",
			navigator: "ollama/glm-5.1:cloud",
			task: "tighten the tests",
			promptsConfig: PROMPTS_CONFIG,
		});

		expect(prompt).toContain('[Pair-coding "review"');
		expect(prompt).toContain("Navigator: ollama/glm-5.1:cloud");
		expect(prompt).toContain('id="pair-consult"');
		expect(prompt).toContain("Task: tighten the tests");
	});
});
