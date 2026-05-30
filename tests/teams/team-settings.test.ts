import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	DEFAULT_SYNTHESIS_CANDIDATES,
	DEFAULT_MEMBER_CANDIDATES,
	resolveTeamSettings,
} from "../../extensions/pi-panopticon/teams/settings.js";

function withTempDir(fn: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "team-test-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function withTempSettings(settings: object, fn: (path: string) => void) {
	withTempDir((dir) => {
		const file = join(dir, "settings.json");
		writeFileSync(file, JSON.stringify(settings));
		fn(file);
	});
}

function createTeamRoot(root: string): void {
	mkdirSync(join(root, "teams"), { recursive: true });
	mkdirSync(join(root, "agents"), { recursive: true });
	mkdirSync(join(root, "prompts"), { recursive: true });
}

function writeDefaultDebate(root: string, members: string[], synthesis: string): void {
	writeFileSync(
		join(root, "teams", "llm-council.md"),
		[
			"---",
			'schemaVersion: 2',
			'id: "llm-council"',
			'name: "LLM Council"',
			'description: "Architecture review"',
			'protocol: "debate"',
			"agents:",
			...members.flatMap((model, index) => [
				'  - role: "member"',
				'    subagent: "member_agent"',
				`    model: "${model}"`,
				`    label: "Member ${index + 1}"`,
			]),
			'  - role: "synthesis"',
			'    subagent: "synthesis_agent"',
			`    model: "${synthesis}"`,
			"---",
			"",
		].join("\n"),
		"utf8",
	);
}

function writeConsult(root: string, navigator: string): void {
	writeFileSync(
		join(root, "teams", "navigator.md"),
		[
			"---",
			'schemaVersion: 2',
			'id: "navigator"',
			'name: "Consult"',
			'description: "Navigator review"',
			'protocol: "consult"',
			"agents:",
			'  - role: "navigator"',
			'    subagent: "navigator_agent"',
			`    model: "${navigator}"`,
			"---",
			"",
		].join("\n"),
		"utf8",
	);
}

describe("DEFAULT_MEMBER_CANDIDATES", () => {
	it("comes from the built-in llm-council team", () => {
		expect(DEFAULT_MEMBER_CANDIDATES).toEqual([
			"ollama/deepseek-v4-pro:cloud",
			"ollama/qwen3.5:cloud",
			"ollama/kimi-k2.6:cloud",
			"ollama/minimax-m2.7:cloud",
		]);
	});
});

describe("DEFAULT_SYNTHESIS_CANDIDATES", () => {
	it("comes from the built-in llm-council team", () => {
		expect(DEFAULT_SYNTHESIS_CANDIDATES).toEqual([
			"openai-codex/gpt-5.5",
			"ollama/deepseek-v4-pro:cloud",
			"ollama/qwen3.5:cloud",
			"ollama/kimi-k2.6:cloud",
			"ollama/minimax-m2.7:cloud",
		]);
	});
});

describe("resolveTeamSettings", () => {
	it("returns built-in team defaults when no settings file exists", () => {
		const resolved = resolveTeamSettings("/nonexistent/path/settings.json");
		expect(resolved.defaultMembers).toEqual(DEFAULT_MEMBER_CANDIDATES);
		expect(resolved.defaultSynthesis).toBe("openai-codex/gpt-5.5");
	});

	it("uses teams.roots as the source of team defaults", () => {
		withTempDir((root) => {
			createTeamRoot(root);
			writeDefaultDebate(root, ["custom/model-1", "custom/model-2"], "custom/synthesis");
			writeConsult(root, "custom/navigator");
			withTempSettings({ teams: { roots: [root] } }, (file) => {
				const resolved = resolveTeamSettings(file);
				expect(resolved.defaultMembers).toEqual(["custom/model-1", "custom/model-2"]);
				expect(resolved.defaultSynthesis).toBe("custom/synthesis");
				expect(resolved.defaultConsult?.navigator).toBe("custom/navigator");
			});
		});
	});

	it("loads system prompts from agent descriptors", () => {
		withTempDir((root) => {
			createTeamRoot(root);
			writeFileSync(
				join(root, "agents", "navigator.md"),
				[
					"---",
					'name: "consult_navigator"',
					'promptId: "consult/navigator/system"',
					"---",
					"# IDENTITY",
					"",
					"Agent navigator body.",
				].join("\n"),
			);
			withTempSettings({ teams: { roots: [root] } }, (file) => {
				const resolved = resolveTeamSettings(file);
				expect(resolved.prompts["consult/navigator/system"]).toEqual([
					"# IDENTITY",
					"",
					"Agent navigator body.",
				]);
			});
		});
	});

	it("later roots override earlier prompt templates", () => {
		withTempDir((first) => {
			withTempDir((second) => {
				createTeamRoot(first);
				createTeamRoot(second);
				writeFileSync(
					join(first, "prompts", "navigator.md"),
					[
						"---",
						'id: "consult/navigator/system"',
						"---",
						"First body.",
					].join("\n"),
				);
				writeFileSync(
					join(second, "prompts", "navigator.md"),
					[
						"---",
						'id: "consult/navigator/system"',
						"---",
						"Second body.",
					].join("\n"),
				);
				withTempSettings({ teams: { roots: [first, second] } }, (file) => {
					const resolved = resolveTeamSettings(file);
					expect(resolved.prompts["consult/navigator/system"]).toEqual(["Second body."]);
				});
			});
		});
	});
});
