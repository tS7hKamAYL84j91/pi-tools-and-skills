/**
 * Tests for lib/task-brief.ts — schema routing, mismatch detection, and rendering.
 */

import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
	TaskBriefSchema,
	routeModel,
	routeTopology,
	routeBrief,
	renderBriefAsPrompt,
	type TaskBrief,
} from "../lib/task-brief.js";

// ── Fixtures ────────────────────────────────────────────────────

const minimalBrief: TaskBrief = {
	classification: "sequential",
	goal: "Fix the login bug",
	successCriteria: ["Login works with valid credentials"],
	scope: { include: ["src/auth.ts"] },
};

const fullBrief: TaskBrief = {
	classification: "parallelisable",
	goal: "Find all deprecated API uses",
	successCriteria: ["List of files and line numbers", "Total count"],
	scope: {
		include: ["src/"],
		exclude: ["node_modules/", "dist/"],
	},
	context: "The deprecated API is `oldFunction()`. Replaced by `newFunction()` in v2.0.",
	topology: "centralised-mas",
};

// ── Schema validation ───────────────────────────────────────────

describe("TaskBriefSchema", () => {
	it("accepts a minimal valid brief", () => {
		expect(Value.Check(TaskBriefSchema, minimalBrief)).toBe(true);
	});

	it("accepts a full valid brief", () => {
		expect(Value.Check(TaskBriefSchema, fullBrief)).toBe(true);
	});

	it("rejects missing classification", () => {
		const bad = { ...minimalBrief, classification: undefined };
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("rejects invalid classification", () => {
		const bad = { ...minimalBrief, classification: "unknown" };
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("rejects missing goal", () => {
		const { goal: _, ...bad } = minimalBrief;
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("rejects empty successCriteria", () => {
		const bad = { ...minimalBrief, successCriteria: [] };
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("rejects missing scope.include", () => {
		const bad = { ...minimalBrief, scope: {} };
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("rejects invalid topology", () => {
		const bad = { ...minimalBrief, topology: "distributed" };
		expect(Value.Check(TaskBriefSchema, bad)).toBe(false);
	});

	it("accepts all four classifications", () => {
		for (const c of ["sequential", "parallelisable", "high-entropy-search", "tool-heavy"] as const) {
			const brief = { ...minimalBrief, classification: c };
			expect(Value.Check(TaskBriefSchema, brief)).toBe(true);
		}
	});
});

// ── Model routing ───────────────────────────────────────────────

describe("routeModel", () => {
	it("routes sequential to Sonnet", () => {
		expect(routeModel("sequential")).toBe("anthropic/claude-sonnet-4-6");
	});

	it("routes parallelisable to Gemini Flash", () => {
		expect(routeModel("parallelisable")).toBe("google/gemini-2.5-flash");
	});

	it("routes high-entropy-search to Gemini Flash", () => {
		expect(routeModel("high-entropy-search")).toBe("google/gemini-2.5-flash");
	});

	it("routes tool-heavy to Sonnet", () => {
		expect(routeModel("tool-heavy")).toBe("anthropic/claude-sonnet-4-6");
	});
});

// ── Topology routing ────────────────────────────────────────────

describe("routeTopology", () => {
	it("routes sequential to single-agent", () => {
		expect(routeTopology("sequential")).toBe("single-agent");
	});

	it("routes parallelisable to centralised-mas", () => {
		expect(routeTopology("parallelisable")).toBe("centralised-mas");
	});

	it("routes high-entropy-search to centralised-mas", () => {
		expect(routeTopology("high-entropy-search")).toBe("centralised-mas");
	});

	it("routes tool-heavy to single-agent", () => {
		expect(routeTopology("tool-heavy")).toBe("single-agent");
	});
});

// ── Mismatch detection ──────────────────────────────────────────

describe("routeBrief", () => {
	it("returns no warnings when topology matches", () => {
		const result = routeBrief(fullBrief);
		expect(result.warnings).toHaveLength(0);
		expect(result.model).toBe("google/gemini-2.5-flash");
		expect(result.recommendedTopology).toBe("centralised-mas");
	});

	it("returns no warnings when topology is omitted", () => {
		const result = routeBrief(minimalBrief);
		expect(result.warnings).toHaveLength(0);
	});

	it("warns when sequential task uses centralised-mas", () => {
		const brief: TaskBrief = { ...minimalBrief, topology: "centralised-mas" };
		const result = routeBrief(brief);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("39–70%");
		expect(result.warnings[0]).toContain("Kim et al.");
	});

	it("warns when tool-heavy task uses centralised-mas", () => {
		const brief: TaskBrief = {
			...minimalBrief,
			classification: "tool-heavy",
			topology: "centralised-mas",
		};
		const result = routeBrief(brief);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("Tool-heavy");
	});

	it("informs when parallelisable task uses single-agent", () => {
		const brief: TaskBrief = {
			...minimalBrief,
			classification: "parallelisable",
			topology: "single-agent",
		};
		const result = routeBrief(brief);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("+80.8%");
	});

	it("informs when high-entropy-search uses single-agent", () => {
		const brief: TaskBrief = {
			...minimalBrief,
			classification: "high-entropy-search",
			topology: "single-agent",
		};
		const result = routeBrief(brief);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("coverage");
	});
});

// ── Brief rendering ─────────────────────────────────────────────

describe("renderBriefAsPrompt", () => {
	it("renders minimal brief", () => {
		const prompt = renderBriefAsPrompt(minimalBrief);
		expect(prompt).toContain("## Goal");
		expect(prompt).toContain("Fix the login bug");
		expect(prompt).toContain("## Success Criteria");
		expect(prompt).toContain("- Login works with valid credentials");
		expect(prompt).toContain("## Scope");
		expect(prompt).toContain("src/auth.ts");
	});

	it("renders full brief with context and excludes", () => {
		const prompt = renderBriefAsPrompt(fullBrief);
		expect(prompt).toContain("## Context");
		expect(prompt).toContain("oldFunction()");
		expect(prompt).toContain("**Exclude:** node_modules/, dist/");
	});

	it("omits Context section when not provided", () => {
		const prompt = renderBriefAsPrompt(minimalBrief);
		expect(prompt).not.toContain("## Context");
	});

	it("omits Exclude line when not provided", () => {
		const prompt = renderBriefAsPrompt(minimalBrief);
		expect(prompt).not.toContain("**Exclude:**");
	});

	it("does not include classification in rendered prompt", () => {
		const prompt = renderBriefAsPrompt(fullBrief);
		expect(prompt).not.toContain("parallelisable");
		expect(prompt).not.toContain("classification");
	});

	it("renders multiple success criteria as list items", () => {
		const prompt = renderBriefAsPrompt(fullBrief);
		expect(prompt).toContain("- List of files and line numbers");
		expect(prompt).toContain("- Total count");
	});
});
