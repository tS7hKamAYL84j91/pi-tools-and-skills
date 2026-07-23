import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock readPiSettingsKey to test config loading
vi.mock("../../lib/pi-settings.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/pi-settings.js")>();
	return {
		...actual,
		PI_SETTINGS_PATH: "/fake/global/.pi/agent/settings.json",
		readPiSettingsKey: vi.fn(),
	};
});

import { readPiSettingsKey } from "../../lib/pi-settings.js";
import {
	classifyInput,
	loadGovernanceConfig,
	maybeGovernanceRoute,
	resolveModel,
} from "../../extensions/pi-coas/governance.js";
import type { ModelRoutingPolicy } from "../../extensions/pi-coas/types.js";

const mockedReadPiSettingsKey = vi.mocked(readPiSettingsKey);

describe("CoAS Governance Module", () => {
	beforeEach(() => {
		mockedReadPiSettingsKey.mockReset();
	});

	describe("Input Classification", () => {
		const triggers = ["secret-adjacent", "credential", "pii"];

		it("classifies empty input as public", () => {
			const res = classifyInput("", triggers);
			expect(res.classification).toBe("public");
			expect(res.matchedTriggers).toHaveLength(0);
			expect(res.reason).toBe("empty input");
		});

		it("classifies input with no matches as public", () => {
			const res = classifyInput("Just a normal day at the office.", triggers);
			expect(res.classification).toBe("public");
			expect(res.matchedTriggers).toHaveLength(0);
		});

		it("is case insensitive", () => {
			const res = classifyInput("This is a CREDENTIAL record", triggers);
			expect(res.classification).toBe("private");
			expect(res.matchedTriggers).toContain("credential");
		});

		it("matches multiple triggers", () => {
			const res = classifyInput("Working with credential data containing pii.", triggers);
			expect(res.classification).toBe("private");
			expect(res.matchedTriggers).toContain("credential");
			expect(res.matchedTriggers).toContain("pii");
			expect(res.matchedTriggers).toHaveLength(2);
		});
	});

	describe("Model Resolution", () => {
		const policy: ModelRoutingPolicy = {
			requiresLocalOnlyForPrivateInput: true,
			localPrivateFallback: "ollama/gemma4:26b",
			localTriageOnly: "ollama/lfm2.5:latest",
			gmReviewedSimpleCode: "ollama/gemma4:26b",
			navigator: "ollama/gemma4:31b",
			advisoryFallbackChain: ["ollama/gemma4:31b", "ollama/qwen3.6:latest"],
		};

		it("routes public triage input to localTriageOnly", () => {
			const res = resolveModel(
				{ classification: "public", matchedTriggers: [], reason: "none" },
				"triage",
				policy,
			);
			expect(res.resolvedModel).toBe("ollama/lfm2.5:latest");
			expect(res.source).toBe("policyIntent");
			expect(res.escalate).toBe(false);
		});

		it("routes public code input to gmReviewedSimpleCode", () => {
			const res = resolveModel(
				{ classification: "public", matchedTriggers: [], reason: "none" },
				"code",
				policy,
			);
			expect(res.resolvedModel).toBe("ollama/gemma4:26b");
			expect(res.source).toBe("policyIntent");
		});

		it("routes public navigator/review input to navigator", () => {
			for (const intent of ["navigator", "review"] as const) {
				const res = resolveModel(
					{ classification: "public", matchedTriggers: [], reason: "none" },
					intent,
					policy,
				);
				expect(res.resolvedModel).toBe("ollama/gemma4:31b");
				expect(res.source).toBe("policyIntent");
			}
		});

		it("returns none for unknown public intent", () => {
			const res = resolveModel(
				{ classification: "public", matchedTriggers: [], reason: "none" },
				"unknown",
				policy,
			);
			expect(res.resolvedModel).toBeUndefined();
			expect(res.source).toBe("none");
			expect(res.escalate).toBe(false);
		});

		it("routes private input to first advisoryFallbackChain entry", () => {
			const res = resolveModel(
				{ classification: "private", matchedTriggers: ["credential"], reason: "matched" },
				"triage",
				policy,
			);
			expect(res.resolvedModel).toBe("ollama/gemma4:31b");
			expect(res.source).toBe("advisoryFallbackChain");
			expect(res.fallbackChain).toEqual(["ollama/gemma4:31b", "ollama/qwen3.6:latest"]);
			expect(res.escalate).toBe(false);
		});

		it("falls back to localPrivateFallback when advisoryFallbackChain is empty", () => {
			const sparsePolicy: ModelRoutingPolicy = {
				requiresLocalOnlyForPrivateInput: true,
				localPrivateFallback: "ollama/gemma4:26b",
			};
			const res = resolveModel(
				{ classification: "private", matchedTriggers: ["pii"], reason: "matched" },
				"triage",
				sparsePolicy,
			);
			expect(res.resolvedModel).toBe("ollama/gemma4:26b");
			expect(res.source).toBe("localPrivateFallback");
			expect(res.fallbackChain).toEqual(["ollama/gemma4:26b"]);
		});

		it("escalates when private input has no local fallback available", () => {
			const strictPolicy: ModelRoutingPolicy = {
				requiresLocalOnlyForPrivateInput: true,
			};
			const res = resolveModel(
				{ classification: "private", matchedTriggers: ["secret"], reason: "matched" },
				"triage",
				strictPolicy,
			);
			expect(res.resolvedModel).toBeUndefined();
			expect(res.source).toBe("none");
			expect(res.escalate).toBe(true);
			expect(res.fallbackChain).toEqual([]);
		});
	});

	describe("Configuration Loading", () => {
		it("returns empty object on missing/malformed config", () => {
			mockedReadPiSettingsKey.mockReturnValue(undefined);
			const config = loadGovernanceConfig("/some/cwd");
			expect(config).toEqual({});
		});

		it("prefers project settings over global settings", () => {
			mockedReadPiSettingsKey.mockImplementation((_key, path) => {
				if (path?.includes("/some/cwd")) return { localOnlyTriggers: ["project"] };
				if (path?.includes("global")) return { localOnlyTriggers: ["global"] };
				return undefined;
			});
			const config = loadGovernanceConfig("/some/cwd");
			expect(config.localOnlyTriggers).toEqual(["project"]);
		});

		it("parses nested modelRoutingPolicy", () => {
			mockedReadPiSettingsKey.mockReturnValue({
				localOnlyTriggers: ["secret-adjacent"],
				modelRoutingPolicy: {
					requiresLocalOnlyForPrivateInput: true,
					localPrivateFallback: "ollama/gemma4:26b",
					localTriageOnly: "ollama/lfm2.5:latest",
					gmReviewedSimpleCode: "ollama/gemma4:26b",
					navigator: "ollama/gemma4:31b",
					advisoryFallbackChain: ["ollama/gemma4:31b", "ollama/qwen3.6:latest"],
				},
			});
			const config = loadGovernanceConfig("/some/cwd");
			expect(config.localOnlyTriggers).toEqual(["secret-adjacent"]);
			expect(config.modelRoutingPolicy?.requiresLocalOnlyForPrivateInput).toBe(true);
			expect(config.modelRoutingPolicy?.localPrivateFallback).toBe("ollama/gemma4:26b");
			expect(config.modelRoutingPolicy?.advisoryFallbackChain).toEqual([
				"ollama/gemma4:31b",
				"ollama/qwen3.6:latest",
			]);
		});
	});

	describe("maybeGovernanceRoute orchestration", () => {
		it("classifies and resolves private input", () => {
			mockedReadPiSettingsKey.mockReturnValue({
				localOnlyTriggers: ["credential"],
				modelRoutingPolicy: {
					requiresLocalOnlyForPrivateInput: true,
					localPrivateFallback: "ollama/gemma4:26b",
				},
			});
			const res = maybeGovernanceRoute("this contains a credential", "triage", "/some/cwd");
			expect(res.classification.classification).toBe("private");
			expect(res.resolvedModel).toBe("ollama/gemma4:26b");
			expect(res.source).toBe("localPrivateFallback");
		});

		it("classifies and resolves public triage input", () => {
			mockedReadPiSettingsKey.mockReturnValue({
				modelRoutingPolicy: {
					localTriageOnly: "ollama/lfm2.5:latest",
				},
			});
			const res = maybeGovernanceRoute("normal operational question", "triage", "/some/cwd");
			expect(res.classification.classification).toBe("public");
			expect(res.resolvedModel).toBe("ollama/lfm2.5:latest");
			expect(res.source).toBe("policyIntent");
		});
	});
});
