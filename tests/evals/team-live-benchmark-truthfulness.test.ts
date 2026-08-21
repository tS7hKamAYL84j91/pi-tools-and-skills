/**
 * Deterministic tests for the live team benchmark truthfulness helpers.
 *
 * These tests cover the failure modes observed during live benchmarks:
 *   - Codex `Unsupported parameter: max_output_tokens` was not categorized
 *   - per-role/model node success was not reported
 *   - degraded status is identified correctly
 *
 * No live provider calls are made. Only pure helpers are exercised.
 */

import { describe, expect, it } from "vitest";
import {
	categorizeError,
	isDegraded,
	resultIsValid,
	summarize,
	summarizeSchema,
} from "../../scripts/team-live-benchmark-helpers.mjs";

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

	it("treats non-empty summary as valid result for navigator", () => {
		const completedEvent = { summary: "Navigator evaluation text." };
		expect(resultIsValid("navigator", completedEvent)).toBe(true);
	});

	it("rejects empty summary for navigator", () => {
		expect(resultIsValid("navigator", { summary: "" })).toBe(false);
		expect(resultIsValid("navigator", undefined)).toBe(false);
	});

	it("summarizes valid JSON schema text", () => {
		expect(summarizeSchema('{"key": "value"}')).toEqual({ key: "value" });
		expect(summarizeSchema("not json")).toBeNull();
		expect(summarizeSchema("")).toBeNull();
	});

	it("marks a run as degraded when any node failed", () => {
		const nodes = [
			node("navigator", "provider-a/model-a", false, "timeout"),
		];
		const completedEvent = { summary: "Some summary" };
		expect(isDegraded("navigator", nodes, completedEvent)).toBe(true);
	});

	it("marks a run as non-degraded when all nodes succeed", () => {
		const nodes = [
			node("navigator", "provider-a/model-a", true),
		];
		const completedEvent = { summary: "Decisive finding." };
		expect(isDegraded("navigator", nodes, completedEvent)).toBe(false);
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
					node("navigator", "provider-a/model-a", false, "Codex error: Unsupported parameter: max_output_tokens"),
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
					node("navigator", "provider-a/model-a", true),
				],
			},
		];
		const summary = summarize(runs, "navigator");
		expect(summary.successfulRuns).toBe(2);
		expect(summary.degradedRuns).toBe(0);
		expect(summary.roleModelStats).toMatchObject({
			"navigator:provider-a/model-a": { total: 2, ok: 1, errors: { unsupported_parameter: 1 } },
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
					node("navigator", "provider-a/model-a", false, "timeout"),
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
					node("navigator", "provider-b/model-b", true),
				],
			},
		];
		const summary = summarize(runs, "navigator");
		expect(summary.successfulRuns).toBe(2);
		expect(summary.degradedRuns).toBe(1);
		expect(summary.nonDegradedRuns).toBe(1);
		expect(summary.medianEndToEndDurationMs).toBe(42_500);
		expect(summary.medianNonDegradedEndToEndDurationMs).toBe(25_000);
	});
});
