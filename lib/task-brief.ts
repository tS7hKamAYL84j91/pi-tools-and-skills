/**
 * Task Brief — Typed schema for agent task dispatch.
 *
 * Replaces unstructured prose briefs with a validated, routable type.
 * Encodes Kim et al. (2025) findings: architecture-task alignment
 * matters more than agent count. Classification drives model selection
 * and topology routing at the spawn boundary.
 *
 * Consumed by: extensions/pi-panopticon/spawner.ts
 */

import { Type, type Static } from "@sinclair/typebox";

// ── Schema ──────────────────────────────────────────────────────

export const TaskClassification = Type.Union(
	[
		Type.Literal("sequential"),
		Type.Literal("parallelisable"),
		Type.Literal("high-entropy-search"),
		Type.Literal("tool-heavy"),
	],
	{ description: "Task type — determines model and topology routing" },
);

export const Topology = Type.Union(
	[Type.Literal("single-agent"), Type.Literal("centralised-mas")],
	{ description: "Agent topology for this task" },
);

export const TaskBriefSchema = Type.Object({
	classification: TaskClassification,
	goal: Type.String({ description: "What the agent should accomplish" }),
	successCriteria: Type.Array(Type.String(), {
		description: "Measurable conditions that define done",
		minItems: 1,
	}),
	scope: Type.Object({
		include: Type.Array(Type.String(), { description: "Files, dirs, or domains in scope" }),
		exclude: Type.Optional(
			Type.Array(Type.String(), { description: "Explicitly out of scope" }),
		),
	}),
	context: Type.Optional(
		Type.String({ description: "Free-form prose context for the agent" }),
	),
	topology: Type.Optional(Topology),
});

export type TaskBrief = Static<typeof TaskBriefSchema>;
export type TaskClassification = Static<typeof TaskClassification>;
export type Topology = Static<typeof Topology>;

// ── Brief → prompt rendering ────────────────────────────────────

/** Render a TaskBrief into structured prose for the agent LLM. */
export function renderBriefAsPrompt(brief: TaskBrief): string {
	const lines: string[] = [
		`## Goal\n${brief.goal}`,
		"",
		"## Success Criteria",
		...brief.successCriteria.map((c) => `- ${c}`),
		"",
		"## Scope",
		`**Include:** ${brief.scope.include.join(", ")}`,
	];

	if (brief.scope.exclude?.length) {
		lines.push(`**Exclude:** ${brief.scope.exclude.join(", ")}`);
	}

	if (brief.context) {
		lines.push("", `## Context\n${brief.context}`);
	}

	return lines.join("\n");
}
