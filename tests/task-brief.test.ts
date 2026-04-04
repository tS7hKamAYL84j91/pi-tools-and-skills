/**
 * Tests for lib/task-brief.ts — schema routing, mismatch detection, and rendering.
 */

import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
	TaskBriefSchema,
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
