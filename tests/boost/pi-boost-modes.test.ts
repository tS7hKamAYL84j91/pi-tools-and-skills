/** Focused unit tests for boost modes: parsing, framing, and context extraction. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	CHALLENGE_FRAME,
	PLAN_FRAME,
	findRecentUserProblem,
	formatBoostMessage,
	parseBoostMode,
	recentUserProblem,
	type BoostMode,
} from "../../extensions/pi-boost/boost-modes.js";
import {
	createLeaseState,
	leaseState,
	renewExpiredLease,
	type LeaseStatus,
} from "../../extensions/pi-boost/lease-state.js";

describe("parseBoostMode", () => {
	it("parses explicit challenge mode", () => {
		expect(parseBoostMode("challenge investigate memory leak")).toEqual({
			mode: "challenge",
			prompt: "investigate memory leak",
		});
	});

	it("parses explicit plan mode", () => {
		expect(parseBoostMode("plan refactor the router")).toEqual({
			mode: "plan",
			prompt: "refactor the router",
		});
	});

	it("defaults to plain mode (verbatim prompt) when first word is not an opt-in mode", () => {
		expect(parseBoostMode("investigate memory leak")).toEqual({
			mode: "plain",
			prompt: "investigate memory leak",
		});
	});

	it("handles bare mode without a prompt", () => {
		expect(parseBoostMode("plan")).toEqual({ mode: "plan", prompt: "" });
		expect(parseBoostMode("challenge")).toEqual({ mode: "challenge", prompt: "" });
	});

	it("handles leading and trailing whitespace", () => {
		expect(parseBoostMode("   plan   fix the bug   ")).toEqual({
			mode: "plan",
			prompt: "fix the bug",
		});
		expect(parseBoostMode("   challenge   fix the bug   ")).toEqual({
			mode: "challenge",
			prompt: "fix the bug",
		});
		expect(parseBoostMode("   fix the bug   ")).toEqual({
			mode: "plain",
			prompt: "fix the bug",
		});
		expect(parseBoostMode("")).toEqual({ mode: "plain", prompt: "" });
	});

	it("does not trigger mode on words that merely start with plan or challenge", () => {
		expect(parseBoostMode("planner tool")).toEqual({
			mode: "plain",
			prompt: "planner tool",
		});
		expect(parseBoostMode("challenging problem")).toEqual({
			mode: "plain",
			prompt: "challenging problem",
		});
	});
});

describe("formatBoostMessage", () => {
	it("formats all valid BoostMode values", () => {
		const modes: BoostMode[] = ["plain", "plan", "challenge"];
		for (const mode of modes) {
			expect(formatBoostMessage(mode, "step")).toContain("step");
		}
	});

	it("formats plain mode verbatim without framing", () => {
		expect(formatBoostMessage("plain", "my question")).toBe("my question");
	});

	it("formats challenge mode with CHALLENGE_FRAME", () => {
		const result = formatBoostMessage("challenge", "my question");
		expect(result).toBe(`${CHALLENGE_FRAME}my question`);
		expect(result).toContain("alternative approaches and one concrete useful next move");
	});

	it("formats plan mode with PLAN_FRAME", () => {
		const result = formatBoostMessage("plan", "my request");
		expect(result).toBe(`${PLAN_FRAME}my request`);
		expect(result).toContain("TODO plan");
		expect(result).toContain("write it to TODO.md");
		expect(result).toContain("This is planning only");
	});
});

describe("findRecentUserProblem", () => {
	it("returns undefined for empty branch", () => {
		expect(findRecentUserProblem([])).toBeUndefined();
	});

	it("returns undefined when branch has only assistant or system messages", () => {
		const entries = [
			{ type: "message", message: { role: "system", content: "You are an assistant" } },
			{ type: "message", message: { role: "assistant", content: "I can help with that" } },
			{ type: "custom", customType: "metadata", data: {} },
		];
		expect(findRecentUserProblem(entries)).toBeUndefined();
	});

	it("returns undefined for empty or whitespace-only user messages", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "" } },
			{ type: "message", message: { role: "user", content: "   \n\t  " } },
		];
		expect(findRecentUserProblem(entries)).toBeUndefined();
	});

	it("extracts text from plain string user message", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "build fails on Node 22" } },
		];
		expect(findRecentUserProblem(entries)).toBe("build fails on Node 22");
	});

	it("extracts and joins text from array content", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "part one" },
						null,
						{ type: "image", url: "https://example.com/img.png" },
						{ type: "text", text: "part two" },
					],
				},
			},
		];
		expect(findRecentUserProblem(entries)).toBe("part one part two");
	});

	it("skips boost-injected frames and returns earlier user problem", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "underlying bug in parser" } },
			{ type: "message", message: { role: "user", content: `${PLAN_FRAME}first plan attempt` } },
			{ type: "message", message: { role: "user", content: `${CHALLENGE_FRAME}second challenge attempt` } },
		];
		expect(findRecentUserProblem(entries)).toBe("underlying bug in parser");
	});

	it("skips legacy anti-rut frame without challenge suffix", () => {
		const legacyFrame =
			"Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\n";
		const entries = [
			{ type: "message", message: { role: "user", content: "real problem" } },
			{ type: "message", message: { role: "user", content: `${legacyFrame}old boost prompt` } },
		];
		expect(findRecentUserProblem(entries)).toBe("real problem");
	});

	it("skips legacy plan frame without write-to-TODO clause", () => {
		const legacyPlanFrame =
			"Produce a concise, actionable TODO plan for the request below: list the concrete steps, their dependencies, and the first step to take. This is planning only — do not start implementing, modify files, or treat it as authorization to execute; the user will review the plan first.\n\n";
		const entries = [
			{ type: "message", message: { role: "user", content: "real problem" } },
			{ type: "message", message: { role: "user", content: `${legacyPlanFrame}old plan prompt` } },
		];
		expect(findRecentUserProblem(entries)).toBe("real problem");
	});

	it("bounds returned problem text to 1500 characters", () => {
		const longText = "a".repeat(2000);
		const entries = [
			{ type: "message", message: { role: "user", content: longText } },
		];
		const result = findRecentUserProblem(entries);
		expect(result).toHaveLength(1500);
		expect(result).toBe("a".repeat(1500));
	});

	it("ignores malformed non-object entries gracefully", () => {
		const entries = [null, undefined, 42, "not-an-entry", { type: "message" }];
		expect(findRecentUserProblem(entries)).toBeUndefined();
	});
});

describe("recentUserProblem", () => {
	it("returns undefined when sessionManager is absent", async () => {
		const ctx = {} as ExtensionContext;
		expect(await recentUserProblem(ctx)).toBeUndefined();
	});

	it("handles sessionManager throwing gracefully", async () => {
		const ctx = {
			sessionManager: {
				getBranch: () => {
					throw new Error("corrupted session");
				},
			},
		} as unknown as ExtensionContext;
		expect(await recentUserProblem(ctx)).toBeUndefined();
	});

	it("returns recent problem from valid sessionManager branch", async () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{ type: "message", message: { role: "user", content: "fix the build" } },
				],
			},
		} as unknown as ExtensionContext;
		expect(await recentUserProblem(ctx)).toBe("fix the build");
	});
});

describe("leaseState and renewExpiredLease", () => {
	it("identifies all four LeaseStatus states", () => {
		const lease = createLeaseState();
		const now = 1_000_000;
		const ttl = 600_000;

		// Default state is off
		expect(leaseState(lease, now, ttl)).toBe<LeaseStatus>("off");

		// In-flight turn is active
		lease.originalModel = { provider: "p", id: "m", input: ["text"] };
		expect(leaseState(lease, now, ttl)).toBe<LeaseStatus>("active");

		// Restore failed is blocked (takes priority)
		lease.revertFailed = true;
		expect(leaseState(lease, now, ttl)).toBe<LeaseStatus>("blocked");

		// Expired after TTL when not blocked or active
		lease.revertFailed = false;
		lease.originalModel = undefined;
		lease.yieldsUsed = 1;
		lease.startedAtMs = now - ttl;
		expect(leaseState(lease, now, ttl)).toBe<LeaseStatus>("expired");
	});

	it("renews an expired lease and rejects renewing non-expired", () => {
		const lease = createLeaseState();
		const now = 1_000_000;
		const ttl = 600_000;

		// Off lease does not renew
		expect(renewExpiredLease(lease, now, ttl)).toBe(false);

		// Expired lease renews and resets counters
		lease.yieldsUsed = 2;
		lease.startedAtMs = now - ttl;
		expect(renewExpiredLease(lease, now, ttl)).toBe(true);
		expect(lease.yieldsUsed).toBe(0);
		expect(lease.startedAtMs).toBeUndefined();
		expect(leaseState(lease, now, ttl)).toBe<LeaseStatus>("off");
	});
});
