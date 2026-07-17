/**
 * Deterministic tests for the live team benchmark truthfulness helpers.
 *
 * These tests cover the failure modes observed on 2026-07-12:
 *   - schema-valid degraded fallback was counted as a valid judge result
 *   - Codex `Unsupported parameter: max_output_tokens` was not categorized
 *   - per-role/model node success was not reported
 *
 * No live provider calls are made. Only pure helpers are exercised.
 */

import { describe, expect, it } from "vitest";
import {
	categorizeError,
	fusionSchemaValid,
	isDegraded,
	judgeNode,
	resultIsValid,
	summarize,
	summarizeSchema,
} from "../../scripts/team-live-benchmark-helpers.mjs";

function validFusionSummary() {
	return JSON.stringify({
		answer: "The change is correct and bounded.",
		confidence: "high",
		consensus: ["bounded scope"],
		contradictions: [],
		partialCoverage: [],
		uniqueInsights: ["test coverage is adequate"],
		blindSpots: [],
		missingEvidence: [],
	});
}

function degradedFallbackSummary() {
	return JSON.stringify({
		answer: "Fusion judge validation failed; review the degraded diagnostics before acting.",
		confidence: "low",
		consensus: [],
		contradictions: [],
		partialCoverage: [],
		uniqueInsights: [],
		blindSpots: ["judge returned invalid JSON"],
		missingEvidence: ["judge analysis unavailable"],
	});
}

function node(role: string, model: string, ok: boolean, error?: string) {
	return {
		role,
		model,
		ok,
		durationMs: 5000,
		...(error ? { errorCategory: categorizeError(error) } : {}),
	};
}

describe("team-live-benchmark truthfulness", () => {
	it("categorizes the observed Codex unsupported-parameter failure", () => {
		expect(categorizeError("Codex error: Unsupported parameter: max_output_tokens")).toBe("unsupported_parameter");
	});

	it("categorizes usage-limit failures without recording raw text", () => {
		expect(categorizeError("Codex error: The usage limit has been reached")).toBe("usage_limit");
	});

	it("categorizes authentication failures", () => {
		expect(categorizeError('401 "Authentication failed"')).toBe("authentication");
	});

	it("returns unknown for unrecognized errors", () => {
		expect(categorizeError("something unexpected happened")).toBe("unknown");
	});

	it("treats schema-valid non-degraded fusion as valid", () => {
		const nodes = [
			node("panel_1", "provider-a/model-a", true),
			node("panel_2", "provider-b/model-b", true),
			node("judge", "provider-a/model-a", true),
		];
		const completedEvent = { summary: validFusionSummary() };
		expect(resultIsValid("fusion-analysis", completedEvent)).toBe(true);
		expect(isDegraded("fusion-analysis", nodes, completedEvent)).toBe(false);
	});

	it("marks schema-valid fallback as degraded when the judge failed", () => {
		const nodes = [
			node("panel_1", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
			node("panel_2", "provider-b/model-b", true),
			node("judge", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
		];
		const completedEvent = { summary: degradedFallbackSummary() };
		expect(resultIsValid("fusion-analysis", completedEvent)).toBe(true);
		expect(isDegraded("fusion-analysis", nodes, completedEvent)).toBe(true);
	});

	it("marks a run as degraded when any panel failed even if the judge succeeded", () => {
		const nodes = [
			node("panel_1", "provider-a/model-a", false, "timeout"),
			node("panel_2", "provider-b/model-b", true),
			node("judge", "provider-c/model-c", true),
		];
		const completedEvent = { summary: validFusionSummary() };
		expect(isDegraded("fusion-analysis", nodes, completedEvent)).toBe(true);
	});

	it("rejects malformed fusion summaries", () => {
		expect(fusionSchemaValid(summarizeSchema("not json"))).toBe(false);
		expect(fusionSchemaValid(summarizeSchema(JSON.stringify({ answer: "x" })))).toBe(false);
	});

	it("reports per-role/model success and error categories", () => {
		const runs = [
			{
				index: 1,
				exitCode: 0,
				endToEndDurationMs: 25_000,
				routingValid: true,
				teamDurationMs: 15_000,
				schemaValid: true,
				judgeValid: true,
				degraded: false,
				resultValid: true,
				failureCategory: null,
				nodes: [
					node("panel_1", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
					node("panel_2", "provider-b/model-b", true),
					node("judge", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
				],
			},
			{
				index: 2,
				exitCode: 0,
				endToEndDurationMs: 22_000,
				routingValid: true,
				teamDurationMs: 14_000,
				schemaValid: true,
				judgeValid: true,
				degraded: false,
				resultValid: true,
				failureCategory: null,
				nodes: [
					node("panel_1", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
					node("panel_2", "provider-b/model-b", true),
					node("judge", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
				],
			},
		];
		const summary = summarize(runs, "fusion-analysis");
		expect(summary.successfulRuns).toBe(2);
		expect(summary.degradedRuns).toBe(0); // runs themselves are marked non-degraded here
		expect(summary.roleModelStats).toMatchObject({
			"panel_1:provider-a/model-a": { total: 2, ok: 0, errors: { unsupported_parameter: 2 } },
			"panel_2:provider-b/model-b": { total: 2, ok: 2, errors: {} },
			"judge:provider-a/model-a": { total: 2, ok: 0, errors: { unsupported_parameter: 2 } },
		});
	});

	it("separates all-completed timing from non-degraded timing", () => {
		const runs = [
			{
				index: 1,
				exitCode: 0,
				endToEndDurationMs: 60_000,
				routingValid: true,
				teamDurationMs: 50_000,
				schemaValid: true,
				judgeValid: false,
				degraded: true,
				resultValid: false,
				failureCategory: "degraded",
				nodes: [
					node("panel_1", "provider-a/model-a", false, "timeout"),
					node("panel_2", "provider-b/model-b", true),
					node("judge", "provider-c/model-c", false, "timeout"),
				],
			},
			{
				index: 2,
				exitCode: 0,
				endToEndDurationMs: 25_000,
				routingValid: true,
				teamDurationMs: 15_000,
				schemaValid: true,
				judgeValid: true,
				degraded: false,
				resultValid: true,
				failureCategory: null,
				nodes: [
					node("panel_1", "provider-a/model-a", true),
					node("panel_2", "provider-b/model-b", true),
					node("judge", "provider-c/model-c", true),
				],
			},
		];
		const summary = summarize(runs, "fusion-analysis");
		expect(summary.successfulRuns).toBe(2);
		expect(summary.degradedRuns).toBe(1);
		expect(summary.nonDegradedRuns).toBe(1);
		expect(summary.medianEndToEndDurationMs).toBe(42_500);
		expect(summary.medianNonDegradedEndToEndDurationMs).toBe(25_000);
	});

	it("locates the judge node", () => {
		const nodes = [node("panel_1", "m", true), node("judge", "m", true)];
		expect(judgeNode(nodes)?.role).toBe("judge");
	});
});