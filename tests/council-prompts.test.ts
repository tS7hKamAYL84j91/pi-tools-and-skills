import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderTemplate } from "../extensions/pi-teams/prompt-renderer.js";
import { promptAssetLines } from "../extensions/pi-teams/prompt-resolver.js";
import { renderPeerCritiquePrompt } from "../extensions/pi-teams/protocol-prompts.js";
import { resolveTeamSettings } from "../extensions/pi-teams/settings.js";
import type {
	TeamParticipant,
	ModelRun,
} from "../extensions/pi-teams/types.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-teams",
	"config",
	"config.json",
);
const NO_SETTINGS = "/nonexistent/path/settings.json";
const PROMPTS_CONFIG = resolveTeamSettings(NO_SETTINGS, CONFIG_PATH).prompts;

const memberA: TeamParticipant = { label: "Agent A", model: "openai/gpt-5.5" };
const memberB: TeamParticipant = {
	label: "Agent B",
	model: "anthropic/claude-opus-4-6",
};
const memberC: TeamParticipant = {
	label: "Agent C",
	model: "google/gemini-2.5-pro",
};

function makeRun(member: TeamParticipant, output: string): ModelRun {
	return {
		member,
		prompt: "Q?",
		systemPrompt: "sys",
		output,
		durationMs: 1,
		ok: true,
	};
}

describe("peer critique prompt self-exclusion", () => {
	const generation = [
		makeRun(memberA, "A's distinctive answer signature"),
		makeRun(memberB, "B's distinctive answer signature"),
		makeRun(memberC, "C's distinctive answer signature"),
	];
	const members = [memberA, memberB, memberC];

	it("omits the viewer's own answer from the critique input", () => {
		const prompt = renderPeerCritiquePrompt({
			originalPrompt: "Q?",
			generation,
			members,
			viewer: memberB,
			template: promptAssetLines(PROMPTS_CONFIG, "debate/critique/template"),
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
		const prompt = renderPeerCritiquePrompt({
			originalPrompt: "Q?",
			generation: generationWithModelMention,
			members,
			viewer: memberB,
			template: promptAssetLines(PROMPTS_CONFIG, "debate/critique/template"),
		});
		expect(prompt).not.toContain("openai/gpt-5.5");
		expect(prompt).toContain("Agent A says ...");
	});

	it("notes self-exclusion explicitly so reviewers don't look for their answer", () => {
		const prompt = renderPeerCritiquePrompt({
			originalPrompt: "Q?",
			generation,
			members,
			viewer: memberA,
			template: promptAssetLines(PROMPTS_CONFIG, "debate/critique/template"),
		});
		expect(prompt).toMatch(/your own answer is excluded/i);
	});
});

describe("pair primer asset", () => {
	it("renders the configured pair primer template", () => {
		const prompt = renderTemplate([...promptAssetLines(PROMPTS_CONFIG, "consult/primer")], {
			pairName: "review",
			navigator: "ollama/glm-5.1:cloud",
			taskLine: "\n\nTask: tighten the tests",
		});

		expect(prompt).toContain('[Pair-coding "review"');
		expect(prompt).toContain("Navigator: ollama/glm-5.1:cloud");
		expect(prompt).toContain('id="consult"');
		expect(prompt).toContain("Task: tighten the tests");
	});
});
