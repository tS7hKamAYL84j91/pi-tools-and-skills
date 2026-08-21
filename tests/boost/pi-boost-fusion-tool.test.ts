import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveBoostSettings } from "../../extensions/pi-boost/boost-settings.js";
import { registerBoostFusionTool } from "../../extensions/pi-boost/boost/fusion-tool.js";
import type { CognitiveModelRunner } from "../../extensions/pi-boost/boost/cognitive-types.js";

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
	readonly details?: Record<string, unknown>;
}

interface CapturedTool {
	execute(
		id: string,
		params: { prompt: string; profile?: string; models?: string[]; judge?: string; panelSize?: number; timeoutMs?: number },
		signal: AbortSignal,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<ToolResult>;
}

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function fakeContext(cwd: string): ExtensionContext {
	return {
		cwd,
		modelRegistry: {
			getAvailable: () => [
				{ provider: "a", id: "one", input: ["text"] },
				{ provider: "b", id: "two", input: ["text"] },
				{ provider: "judge", id: "final", input: ["text"] },
			],
		},
	} as unknown as ExtensionContext;
}

const runner: CognitiveModelRunner = async (input) => ({
	ok: true,
	output: input.systemPrompt.includes("judge in")
		? JSON.stringify({ answer: "final", consensus: [], contradictions: [], partialCoverage: [], uniqueInsights: [], blindSpots: [], confidence: "high", missingEvidence: [] })
		: `panel:${input.model}`,
	durationMs: 1,
});

async function setup(principal: boolean, globalPath: string): Promise<CapturedTool> {
	let captured: CapturedTool | undefined;
	const pi = {
		registerTool(definition: CapturedTool) {
			captured = definition;
		},
	};
	registerBoostFusionTool(
		pi as unknown as ExtensionAPI,
		{ selfId: "subject", isPrincipalSession: () => principal },
		{
			runner,
			hostCapabilities: { isProjectTrusted: () => false, globalSettingsPath: globalPath },
			audit: { append: async () => undefined },
		},
	);
	if (!captured) throw new Error("boost_fusion was not registered");
	return captured;
}

describe("boost_fusion authorization and fixed policy", () => {
	it("denies agents by default and permits a Principal bounded invocation", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "boost-fusion-tool-"));
		roots.push(cwd);
		const globalPath = join(cwd, "global.json");
		const ctx = fakeContext(cwd);
		const denied = await setup(false, globalPath);
		await expect(denied.execute("id", { prompt: "x" }, new AbortController().signal, undefined, ctx)).rejects.toThrow(/denied/);

		const principal = await setup(true, globalPath);
		const result = await principal.execute("id", { prompt: "x", models: ["a/one", "b/two"], judge: "judge/final", panelSize: 2 }, new AbortController().signal, undefined, ctx);
		expect(result.content[0]?.text).toBe("final");
		expect(result.details).toMatchObject({ ok: true, degraded: false });
	});

	it("allows pre-granted agents but rejects caller attempts to alter fixed caps", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "boost-fusion-agent-"));
		roots.push(cwd);
		const globalPath = join(cwd, "global.json");
		await saveBoostSettings("global", {
			profile: "fast",
			panelSize: 2,
			models: ["a/one", "b/two"],
			judge: "judge/final",
			timeoutMs: 5_000,
			agentSelfBoost: { enabled: true, allowCognitive: true, maxPanelModels: 2 },
		}, cwd, globalPath);
		const tool = await setup(false, globalPath);
		const ctx = fakeContext(cwd);
		await expect(tool.execute("id", { prompt: "x", panelSize: 4 }, new AbortController().signal, undefined, ctx)).rejects.toThrow(/fixed by operator/);
		const result = await tool.execute("id", { prompt: "x" }, new AbortController().signal, undefined, ctx);
		expect(result.content[0]?.text).toBe("final");
	});
});
