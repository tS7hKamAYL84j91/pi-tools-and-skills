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

// ── Model routing ───────────────────────────────────────────────

const MODEL_ROUTES: Record<string, string> = {
	"sequential": "anthropic/claude-sonnet-4-6",
	"parallelisable": "google/gemini-2.5-flash",
	"high-entropy-search": "google/gemini-2.5-flash",
	"tool-heavy": "anthropic/claude-sonnet-4-6",
};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

/** Select model based on task classification. */
export function routeModel(classification: TaskClassification): string {
	return MODEL_ROUTES[classification] ?? DEFAULT_MODEL;
}

// ── Topology routing ────────────────────────────────────────────

const TOPOLOGY_ROUTES: Record<string, Topology> = {
	"sequential": "single-agent",
	"parallelisable": "centralised-mas",
	"high-entropy-search": "centralised-mas",
	"tool-heavy": "single-agent",
};

/** Recommended topology for a task classification. */
export function routeTopology(classification: TaskClassification): Topology {
	return TOPOLOGY_ROUTES[classification] ?? "single-agent";
}

// ── Mismatch detection ──────────────────────────────────────────

export interface RoutingResult {
	model: string;
	recommendedTopology: Topology;
	warnings: string[];
}

/** Route a brief and detect topology mismatches (Kim et al. 2025). */
export function routeBrief(brief: TaskBrief): RoutingResult {
	const model = routeModel(brief.classification);
	const recommendedTopology = routeTopology(brief.classification);
	const warnings: string[] = [];

	if (brief.topology && brief.topology !== recommendedTopology) {
		if (brief.classification === "sequential" && brief.topology === "centralised-mas") {
			warnings.push(
				"⚠ Sequential tasks degrade 39–70% with MAS (Kim et al. 2025). Use single-agent.",
			);
		} else if (brief.classification === "tool-heavy" && brief.topology === "centralised-mas") {
			warnings.push(
				"⚠ Tool-heavy tasks are sequential by nature. MAS adds coordination overhead without benefit.",
			);
		} else if (brief.classification === "parallelisable" && brief.topology === "single-agent") {
			warnings.push(
				"ℹ Parallelisable task assigned to single-agent. Centralised MAS could yield +80.8% (Kim et al. 2025).",
			);
		} else if (brief.classification === "high-entropy-search" && brief.topology === "single-agent") {
			warnings.push(
				"ℹ High-entropy search assigned to single-agent. Centralised MAS improves coverage.",
			);
		}
	}

	return { model, recommendedTopology, warnings };
}

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
