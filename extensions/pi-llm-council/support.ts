/**
 * Shared Pi LLM Council schemas and pure helpers.
 */

import { type Static, Type } from "@sinclair/typebox";
import {
	chooseChairmanModel,
	chooseCouncilModels,
	unique,
} from "./members.js";
import type { CouncilSlot } from "./status-bar.js";
import { resolveCouncilSettings, type ResolvedCouncilSettings } from "./settings.js";
import type { CouncilDefinition, CouncilDeliberation } from "./types.js";

export const CouncilFormSchema = Type.Object({
	name: Type.String({
		description: "Session-local council name (e.g. architecture, safety)",
	}),
	purpose: Type.Optional(
		Type.String({ description: "What this council is for" }),
	),
	members: Type.Optional(
		Type.Array(Type.String(), { description: "Council member model IDs" }),
	),
	chairman: Type.Optional(
		Type.String({ description: "Chairman/synthesis model ID" }),
	),
});

export const AskCouncilSchema = Type.Object({
	prompt: Type.String({ description: "Question for DEBATE; coding task for PAIR." }),
	mode: Type.Optional(
		Type.Union([Type.Literal("DEBATE"), Type.Literal("PAIR")], {
			description: "DEBATE (default) or PAIR (driver/navigator review-then-fix).",
		}),
	),
	council: Type.Optional(Type.String({ description: "DEBATE: named session council." })),
	members: Type.Optional(Type.Array(Type.String(), { description: "DEBATE: override members." })),
	chairman: Type.Optional(Type.String({ description: "DEBATE: override chairman." })),
	files: Type.Optional(Type.Array(Type.String(), { description: "PAIR: files to load." })),
	specPath: Type.Optional(Type.String({ description: "PAIR: spec path; defaults to spec.md or docs/spec.md." })),
	models: Type.Optional(Type.Object({
		driver: Type.Optional(Type.String({ description: "PAIR: coding model." })),
		navigator: Type.Optional(Type.String({ description: "PAIR: reasoning/review model." })),
	})),
	limits: Type.Optional(Type.Object({
		maxFixPasses: Type.Optional(Type.Number({ description: "PAIR: fix passes (default 1)." })),
		timeoutMs: Type.Optional(Type.Number({ description: "DEBATE: per-stage timeout ms." })),
	})),
});

export const CouncilUpdateSchema = Type.Object({
	name: Type.String({ description: "Existing council name to update" }),
	purpose: Type.Optional(
		Type.String({ description: "Replace the council purpose" }),
	),
	members: Type.Optional(
		Type.Array(Type.String(), { description: "Replacement member model IDs" }),
	),
	chairman: Type.Optional(
		Type.String({ description: "Replacement chairman/synthesis model ID" }),
	),
});

export const CouncilDissolveSchema = Type.Object({
	name: Type.String({ description: "Council name to dissolve" }),
});

export type CouncilFormInput = Static<typeof CouncilFormSchema>;
export type CouncilUpdateInput = Static<typeof CouncilUpdateSchema>;
export type AskCouncilInput = Static<typeof AskCouncilSchema>;
export type CouncilDissolveInput = Static<typeof CouncilDissolveSchema>;

export function makeDefinition(args: {
	name: string;
	purpose?: string;
	members: string[];
	chairman: string;
}): CouncilDefinition {
	return {
		name: args.name,
		purpose: args.purpose,
		members: args.members,
		chairman: args.chairman,
		createdAt: Date.now(),
	};
}

export function defaultSlot(
	snapshot: string[],
	settings: ResolvedCouncilSettings = resolveCouncilSettings(),
): CouncilSlot {
	const members = chooseCouncilModels(snapshot);
	return {
		definition: makeDefinition({
			name: settings.defaultCouncil.name,
			purpose: settings.defaultCouncil.purpose,
			members,
			chairman: chooseChairmanModel(snapshot, members),
		}),
		availableSnapshot: snapshot,
	};
}

export function configuredSlots(
	snapshot: string[],
	settings: ResolvedCouncilSettings,
): CouncilSlot[] {
	return Object.entries(settings.councils ?? {}).map(([name, config]) => {
		const members = unique(
			config.members ??
				settings.defaultMembers ??
				chooseCouncilModels(snapshot),
		);
		return {
			definition: makeDefinition({
				name,
				purpose: config.purpose,
				members,
				chairman:
					config.chairman ??
					settings.defaultChairman ??
					chooseChairmanModel(snapshot, members),
			}),
			availableSnapshot: snapshot,
		};
	});
}

export function okText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

export function deliberationDetails(
	record: CouncilDeliberation,
): Record<string, unknown> {
	const allRuns = record.synthesis
		? [...record.generation, ...record.critiques, record.synthesis]
		: [...record.generation, ...record.critiques];
	const failures = allRuns.filter((run) => !run.ok);
	return {
		id: record.id,
		council: record.council,
		members: record.members.map((member) => member.model),
		chairman: record.chairman.model,
		durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
		generationSucceeded: record.generation.filter((run) => run.ok).length,
		critiqueSucceeded: record.critiques.filter((run) => run.ok).length,
		failures: failures.map((run) => ({
			model: run.member.model,
			error: run.error,
		})),
	};
}

export function latestDeliberation(
	records: CouncilDeliberation[],
): CouncilDeliberation | undefined {
	let latest: CouncilDeliberation | undefined;
	for (const record of records) {
		if (!latest || record.startedAt > latest.startedAt) latest = record;
	}
	return latest;
}

export function councilLines(slots: Iterable<CouncilSlot>): string[] {
	return [...slots].map(
		({ definition }) =>
			`- ${definition.name}: ${definition.members.join(", ")} | chairman=${definition.chairman}${definition.purpose ? ` | ${definition.purpose}` : ""}`,
	);
}

export function selectableCouncilNames(councils: Map<string, CouncilSlot>): string[] {
	return [...councils.keys()].sort();
}
