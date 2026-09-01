import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeCognitiveLease } from "../../extensions/pi-boost/boost/cognitive-lease.js";
import {
	isValidJudgeJson,
	renderJudgePrompt,
	stripMarkdownFences,
	truncateAtSemanticBoundary,
} from "../../extensions/pi-boost/boost/cognitive-output.js";
import { planCognitiveFusion } from "../../extensions/pi-boost/boost/cognitive-planner.js";
import { extractPiPrintOutput } from "../../extensions/pi-boost/boost/cognitive-runner.js";
import { createCognitiveAuditSink } from "../../extensions/pi-boost/boost/cognitive-audit.js";
import { parseBoostCommand } from "../../extensions/pi-boost/boost/parser.js";
import type { CognitiveModelRunner } from "../../extensions/pi-boost/boost/cognitive-types.js";

const JUDGE_OUTPUT = JSON.stringify({
	answer: "synthesized",
	consensus: ["shared"],
	contradictions: [],
	partialCoverage: [],
	uniqueInsights: ["unique"],
	blindSpots: [],
	confidence: "high",
	missingEvidence: [],
});

describe("cognitive boost parser and planner", () => {
	it("parses bounded fusion options and rejects invalid values", () => {
		expect(
			parseBoostCommand("/boost fusion --profile fast -n 2 -- investigate"),
		).toMatchObject({
			ok: true,
			command: {
				kind: "fusion",
				fusion: { profile: "fast", panelSize: 2, prompt: "investigate" },
			},
		});
		expect(parseBoostCommand("/boost fusion -n 5 prompt")).toMatchObject({
			ok: false,
			error: { code: "invalid-panel-size" },
		});
		expect(
			parseBoostCommand(
				"/boost fusion --profile fast --profile thorough prompt",
			),
		).toMatchObject({ ok: false, error: { code: "repeated-option" } });
	});

	it("filters invisible and denied models, deduplicates, and prefers provider diversity for fast mode", () => {
		const plan = planCognitiveFusion({
			configuredPanel: ["a/one", "a/two", "b/one", "deny/one", "a/one"],
			configuredJudge: "b/one",
			visibleModels: ["a/one", "a/two", "b/one", "deny/one"],
			denyProviders: ["deny"],
			profile: "fast",
			maxPanelModels: 3,
			requireApprovalAboveCalls: 4,
		});
		expect(plan.panel).toEqual(["a/one", "b/one", "a/two"]);
		expect(plan.judge).toBe("b/one");
		expect(plan.estimatedCalls).toBe(4);
		expect(plan.requiresApproval).toBe(false);
		expect(plan.warnings).toContain(
			"panel model filtered by provider policy: deny/one",
		);
	});
});

describe("cognitive boost output and lease lifecycle", () => {
	it("bounds prompt material and accepts fenced strict judge JSON", () => {
		const long = "sentence. ".repeat(200);
		expect(truncateAtSemanticBoundary(long, 120).length).toBeLessThanOrEqual(
			120,
		);
		const prompt = renderJudgePrompt(
			long,
			[
				{
					role: "panel_1",
					model: "a/one",
					ok: true,
					output: long,
					durationMs: 1,
					attempts: 1,
				},
			],
			500,
			100,
		);
		expect(prompt.length).toBeLessThanOrEqual(500);
		const fenced = `\`\`\`json\n${JUDGE_OUTPUT}\n\`\`\``;
		expect(stripMarkdownFences(fenced)).toBe(JUDGE_OUTPUT);
		expect(isValidJudgeJson(fenced)).toBe(true);
	});

	it("runs panel calls concurrently, judges once, and yields a structured answer", async () => {
		let activePanels = 0;
		let peakPanels = 0;
		const calls: string[] = [];
		const runner: CognitiveModelRunner = async (input) => {
			calls.push(input.model);
			if (input.systemPrompt.includes("panelists")) {
				activePanels += 1;
				peakPanels = Math.max(peakPanels, activePanels);
				await new Promise((resolve) => setTimeout(resolve, 5));
				activePanels -= 1;
				return { ok: true, output: `view:${input.model}`, durationMs: 5 };
			}
			return { ok: true, output: JUDGE_OUTPUT, durationMs: 1 };
		};
		const audit: unknown[] = [];
		const result = await executeCognitiveLease({
			prompt: "compare",
			profile: "balanced",
			models: ["a/one", "b/two", "c/three"],
			judge: "judge/final",
			visibleModels: ["a/one", "b/two", "c/three", "judge/final"],
			requireApprovalAboveCalls: 4,
			runner,
			audit: {
				append: async (record) => {
					audit.push(record);
				},
			},
			auditActor: "agent",
			auditSurface: "tool",
		});
		expect(peakPanels).toBe(3);
		expect(calls).toHaveLength(4);
		expect(result).toMatchObject({
			ok: true,
			degraded: false,
			answer: "synthesized",
		});
		expect(result.nodes.map((node) => node.role)).toEqual([
			"panel_1",
			"panel_2",
			"panel_3",
			"judge",
		]);
		expect(audit).toMatchObject([
			{
				actor: "agent",
				surface: "tool",
				profile: "balanced",
				panelSize: 3,
				outcome: "completed",
			},
		]);
	});

	it("runs a single-model lease with no judge synthesis", async () => {
		const calls: string[] = [];
		const runner: CognitiveModelRunner = async (input) => {
			calls.push(input.model);
			return { ok: true, output: `direct:${input.model}`, durationMs: 1 };
		};
		const result = await executeCognitiveLease({
			prompt: "unstick",
			single: true,
			models: ["a/one", "b/two"],
			judge: "judge/final",
			visibleModels: ["a/one", "b/two", "judge/final"],
			runner,
		});
		expect(calls).toEqual(["a/one"]);
		expect(result).toMatchObject({
			ok: true,
			degraded: false,
			answer: "direct:a/one",
		});
		expect(result.nodes.map((node) => node.role)).toEqual(["single"]);
		expect(result.analysis).toBeUndefined();
	});

	it("writes a private redacted audit record without prompt or model identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "cognitive-audit-"));
		try {
			const sink = createCognitiveAuditSink(root);
			await sink.append({
				timestamp: "2026-01-01T00:00:00.000Z",
				actor: "agent",
				surface: "tool",
				profile: "fast",
				panelSize: 2,
				outcome: "completed",
				durationMs: 4,
			});
			const raw = await readFile(join(root, "cognitive-audit.jsonl"), "utf8");
			expect(raw).toContain('"actor":"agent"');
			expect(raw).not.toContain("prompt");
			expect(raw).not.toContain("model");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("extracts final assistant output from JSONL and preserves raw print text", () => {
		const line = JSON.stringify({
			type: "agent_end",
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "final" }] },
			],
		});
		expect(extractPiPrintOutput(line)).toBe("final");
		expect(extractPiPrintOutput("raw output\n")).toBe("raw output");
	});

	it("stops before judge synthesis when cancellation follows panel completion", async () => {
		const controller = new AbortController();
		const result = await executeCognitiveLease({
			prompt: "x",
			models: ["a/one"],
			visibleModels: ["a/one"],
			requireApprovalAboveCalls: 2,
			signal: controller.signal,
			runner: async () => {
				controller.abort();
				return { ok: true, output: "panel", durationMs: 1 };
			},
		});
		expect(result).toMatchObject({
			ok: false,
			degraded: true,
			failureReason: "aborted",
		});
	});

	it("fails cleanly when all panels fail and degrades invalid judge output", async () => {
		const failed = await executeCognitiveLease({
			prompt: "x",
			models: ["a/one"],
			visibleModels: ["a/one"],
			requireApprovalAboveCalls: 2,
			runner: async () => ({
				ok: false,
				output: "",
				durationMs: 1,
				error: "unavailable",
			}),
		});
		expect(failed).toMatchObject({
			ok: false,
			degraded: true,
			failureReason: "all_panels_failed",
		});

		let call = 0;
		const degraded = await executeCognitiveLease({
			prompt: "x",
			models: ["a/one"],
			judge: "j/one",
			visibleModels: ["a/one", "j/one"],
			requireApprovalAboveCalls: 2,
			runner: async () =>
				++call === 1
					? { ok: true, output: "panel", durationMs: 1 }
					: { ok: true, output: "not-json", durationMs: 1 },
		});
		expect(degraded).toMatchObject({
			ok: false,
			degraded: true,
			failureReason: "invalid_judge_json",
		});
	});
});
