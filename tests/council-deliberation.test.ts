import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/agent-api.js", () => ({
	findAgentByName: vi.fn(),
}));

import { findAgentByName } from "../lib/agent-api.js";
import { preflight } from "../extensions/council/deliberation.js";
import type { CouncilDefinition } from "../extensions/council/types.js";

const mockFind = findAgentByName as ReturnType<typeof vi.fn>;

beforeEach(() => {
	mockFind.mockReset();
});

function definition(over: Partial<CouncilDefinition> = {}): CouncilDefinition {
	return {
		name: "test",
		members: [
			"openai/gpt-5.5",
			"anthropic/claude-opus-4-6",
			"google/gemini-2.5-pro",
		],
		chairman: "openai/gpt-5.5",
		createdAt: 0,
		...over,
	};
}

const HETEROGENEOUS_SNAPSHOT = [
	"anthropic/claude-opus-4-6",
	"google/gemini-2.5-pro",
	"openai/gpt-5.5",
];

describe("preflight", () => {
	it("passes when heterogeneity ok and all models in snapshot", () => {
		const report = preflight(definition(), HETEROGENEOUS_SNAPSHOT);
		expect(report.ok).toBe(true);
		expect(report.heterogeneity.ok).toBe(true);
		expect(report.missingFromSnapshot).toEqual([]);
		expect(report.reasons).toEqual([]);
	});

	it("warns but does not fail when all members share a provider prefix", () => {
		// Provider-prefix matching is a proxy: OpenRouter and similar gateways
		// expose diverse model lineages under a single prefix. The check
		// surfaces the concern as a warning rather than blocking deliberation.
		const report = preflight(
			definition({
				members: ["openai/gpt-5", "openai/gpt-5.5"],
				chairman: "openai/gpt-4.5",
			}),
			["openai/gpt-5", "openai/gpt-5.5", "openai/gpt-4.5"],
		);
		expect(report.ok).toBe(true);
		expect(report.heterogeneity.ok).toBe(false);
		expect(report.reasons).toEqual([]);
		expect(report.warnings.some((w) => w.includes("distinct providers"))).toBe(
			true,
		);
	});

	it("fails when models are missing from a non-empty snapshot", () => {
		const report = preflight(
			definition({ members: ["openai/gpt-5.5", "anthropic/missing"] }),
			["openai/gpt-5.5"],
		);
		expect(report.ok).toBe(false);
		expect(report.missingFromSnapshot).toContain("anthropic/missing");
	});

	it("treats an empty snapshot as 'unknown availability' and skips that check", () => {
		const report = preflight(definition(), []);
		expect(report.missingFromSnapshot).toEqual([]);
		expect(report.ok).toBe(true);
	});

	it("totalCalls accounts for N members generating + critiquing + 1 chairman synthesis", () => {
		const report = preflight(definition(), HETEROGENEOUS_SNAPSHOT);
		// 3 members × 2 stages (generate + critique) + 1 chairman synthesis = 7
		expect(report.totalCalls).toBe(7);
	});

	it("resolves agent: members against the registry and uses their model for heterogeneity", () => {
		mockFind.mockImplementation((name: string) => {
			if (name === "bob") {
				return {
					id: "bob-id",
					name: "bob",
					pid: 1,
					alive: true,
					heartbeatAge: 1_000,
					model: "anthropic/claude-opus-4-6",
					status: "running",
				};
			}
			return null;
		});
		const report = preflight(
			definition({
				members: ["openai/gpt-5.5", "agent:bob", "google/gemini-2.5-pro"],
			}),
			HETEROGENEOUS_SNAPSHOT,
		);
		expect(report.ok).toBe(true);
		expect(report.members[1]?.agentName).toBe("bob");
		expect(report.agents).toHaveLength(1);
	});

	it("fails when an agent: ref cannot be resolved", () => {
		mockFind.mockReturnValue(null);
		const report = preflight(
			definition({
				members: ["openai/gpt-5.5", "agent:nobody", "google/gemini-2.5-pro"],
			}),
			HETEROGENEOUS_SNAPSHOT,
		);
		expect(report.ok).toBe(false);
		expect(report.reasons.some((r) => r.includes("nobody"))).toBe(true);
	});

	it("does not flag an agent's underlying model as missing from the orchestrator's snapshot", () => {
		// Bob runs a model the orchestrator can't see locally. Bob will use his
		// own model in his own session — the snapshot mismatch is irrelevant.
		mockFind.mockImplementation((name: string) => {
			if (name === "bob") {
				return {
					id: "bob-id",
					name: "bob",
					pid: 1,
					alive: true,
					heartbeatAge: 1_000,
					model: "remote/exotic-model-not-in-snapshot",
					status: "running",
				};
			}
			return null;
		});
		const report = preflight(
			definition({
				members: ["openai/gpt-5.5", "agent:bob", "google/gemini-2.5-pro"],
			}),
			HETEROGENEOUS_SNAPSHOT,
		);
		expect(report.ok).toBe(true);
		expect(report.missingFromSnapshot).toEqual([]);
	});

	it("warns about stale heartbeats but does not fail", () => {
		mockFind.mockReturnValue({
			id: "drowsy-id",
			name: "drowsy",
			pid: 7,
			alive: true,
			heartbeatAge: 60_000,
			model: "anthropic/claude-opus-4-6",
			status: "waiting",
		});
		const report = preflight(
			definition({
				members: ["openai/gpt-5.5", "agent:drowsy", "google/gemini-2.5-pro"],
			}),
			HETEROGENEOUS_SNAPSHOT,
		);
		expect(report.ok).toBe(true);
		expect(report.warnings.some((w) => w.includes("drowsy"))).toBe(true);
	});
});
