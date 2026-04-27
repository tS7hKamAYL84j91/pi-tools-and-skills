/**
 * Pi LLM Council extension — multi-model debate and consensus.
 *
 * Provides session-scoped councils of heterogeneous models. Members debate
 * in 3 stages (generate → anonymized critique → chairman synthesis) with
 * pre-flight validation, parallel timeouts, partial-progress fallback, and
 * persistent state under ~/.pi/agent/councils/.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import { registerCouncilEditCommand } from "./edit-command.js";
import { registerCouncilListCommand } from "./list-command.js";
import { type PairDefinition, registerPairCommands } from "./pair-commands.js";
import { type CouncilSlot, refreshCouncilStatus } from "./status-bar.js";
import {
	COUNCIL_MAX,
	chooseChairmanModel,
	chooseCouncilModels,
	councilPickerOptions,
	snapshotAvailableModels,
	unique,
} from "./members.js";
import { runPairMode } from "./pair-command.js";
import { pickCouncilMembers, pickModel } from "./picker.js";
import { currentPanopticonRecord } from "./runner.js";
import { type CouncilSettings, resolveCouncilSettings } from "./settings.js";
import { CouncilStateManager } from "./state.js";
import type { CouncilDefinition, CouncilDeliberation } from "./types.js";

const CouncilFormSchema = Type.Object({
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

const AskCouncilSchema = Type.Object({
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

const CouncilUpdateSchema = Type.Object({
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

const CouncilDissolveSchema = Type.Object({
	name: Type.String({ description: "Council name to dissolve" }),
});

type CouncilFormInput = Static<typeof CouncilFormSchema>;
type CouncilUpdateInput = Static<typeof CouncilUpdateSchema>;
type AskCouncilInput = Static<typeof AskCouncilSchema>;
type CouncilDissolveInput = Static<typeof CouncilDissolveSchema>;

function makeDefinition(args: {
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

function defaultSlot(snapshot: string[]): CouncilSlot {
	const members = chooseCouncilModels(snapshot);
	return {
		definition: makeDefinition({
			name: "default",
			purpose: "General high-stakes reasoning and architecture review",
			members,
			chairman: chooseChairmanModel(snapshot, members),
		}),
		availableSnapshot: snapshot,
	};
}

function configuredSlots(
	snapshot: string[],
	settings: CouncilSettings,
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

function okText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function deliberationDetails(
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

function latestDeliberation(
	stateManager: CouncilStateManager,
): CouncilDeliberation | undefined {
	let latest: CouncilDeliberation | undefined;
	for (const record of stateManager.list()) {
		if (!latest || record.startedAt > latest.startedAt) latest = record;
	}
	return latest;
}

function councilLines(slots: Iterable<CouncilSlot>): string[] {
	return [...slots].map(
		({ definition }) =>
			`- ${definition.name}: ${definition.members.join(", ")} | chairman=${definition.chairman}${definition.purpose ? ` | ${definition.purpose}` : ""}`,
	);
}

function selectableCouncilNames(councils: Map<string, CouncilSlot>): string[] {
	return [...councils.keys()].sort();
}


export default function (pi: ExtensionAPI) {
	const councils = new Map<string, CouncilSlot>();
	const pairs = new Map<string, PairDefinition>();
	const stateManager = new CouncilStateManager();

	pi.on("session_start", async (_event, ctx) => {
		const snapshot = snapshotAvailableModels(ctx);
		const settings = resolveCouncilSettings();
		councils.clear();
		const slots = [
			defaultSlot(snapshot),
			...configuredSlots(snapshot, settings),
		];
		for (const slot of slots) councils.set(slot.definition.name, slot);
		refreshCouncilStatus(ctx, councils, pairs);
	});

	pi.registerTool({
		name: "council_form",
		label: "Form Council",
		description:
			"Create or replace a named session-local council. Snapshots the model registry at form time so member validity is stable for the session.",
		promptSnippet: "Create a named council of models for this session",
		parameters: CouncilFormSchema,
		async execute(_id, params: CouncilFormInput, _signal, _onUpdate, ctx) {
			const snapshot = snapshotAvailableModels(ctx);
			const members = unique(
				params.members ?? chooseCouncilModels(snapshot),
			).slice(0, COUNCIL_MAX);
			if (members.length === 0)
				throw new Error("Council must have at least one member.");
			const definition = makeDefinition({
				name: params.name,
				purpose: params.purpose,
				members,
				chairman: params.chairman ?? chooseChairmanModel(snapshot, members),
			});
			const report = preflight(definition, snapshot);
			if (!report.ok) {
				throw new Error(
					`Council pre-flight failed:\n  ${report.reasons.join("\n  ")}`,
				);
			}
			councils.set(definition.name, {
				definition,
				availableSnapshot: snapshot,
			});
			refreshCouncilStatus(ctx, councils, pairs);
			return okText(
				`Formed council "${definition.name}" with ${definition.members.length} member(s) across ${report.heterogeneity.providers.length} provider(s).`,
				{ ...definition, preflight: report },
			);
		},
	});

	pi.registerTool({
		name: "council_update",
		label: "Update Council",
		description:
			"Update an existing session-local council's members, chairman, or purpose while preserving unspecified fields.",
		promptSnippet: "Change models or purpose for an existing council",
		parameters: CouncilUpdateSchema,
		async execute(_id, params: CouncilUpdateInput, _signal, _onUpdate, ctx) {
			const slot = councils.get(params.name);
			if (!slot) throw new Error(`No council "${params.name}".`);
			if (!params.members && !params.chairman && params.purpose === undefined) {
				throw new Error("Provide members, chairman, or purpose to update.");
			}
			const snapshot = snapshotAvailableModels(ctx);
			const availableSnapshot = snapshot.length > 0
				? snapshot
				: slot.availableSnapshot;
			const members = params.members
				? unique(params.members).slice(0, COUNCIL_MAX)
				: slot.definition.members;
			const definition: CouncilDefinition = {
				...slot.definition,
				purpose: params.purpose ?? slot.definition.purpose,
				members,
				chairman: params.chairman ?? slot.definition.chairman,
			};
			const report = preflight(definition, availableSnapshot);
			if (!report.ok) {
				throw new Error(
					`Council pre-flight failed:\n  ${report.reasons.join("\n  ")}`,
				);
			}
			councils.set(definition.name, { definition, availableSnapshot });
			refreshCouncilStatus(ctx, councils, pairs);
			return okText(
				`Updated council "${definition.name}" with ${definition.members.length} member(s).`,
				{ ...definition, preflight: report },
			);
		},
	});

	pi.registerTool({
		name: "council_list",
		label: "List Councils",
		description: "List session-local councils available to ask_council.",
		promptSnippet: "List councils available in this session",
		parameters: Type.Object({}),
		async execute() {
			if (councils.size === 0)
				return okText("No councils formed in this session.", { councils: [] });
			const lines = councilLines(councils.values());
			return okText(`Councils:\n${lines.join("\n")}`, {
				councils: [...councils.values()].map((slot) => slot.definition),
			});
		},
	});

	pi.registerTool({
		name: "council_dissolve",
		label: "Dissolve Council",
		description:
			"Remove a named session-local council. Configured defaults reappear next session/reload.",
		promptSnippet: "Dissolve a named council for this session",
		parameters: CouncilDissolveSchema,
		async execute(_id, params: CouncilDissolveInput, _signal, _onUpdate, ctx) {
			const removed = councils.delete(params.name);
			refreshCouncilStatus(ctx, councils, pairs);
			return okText(
				removed
					? `Dissolved "${params.name}".`
					: `No council "${params.name}".`,
				{ removed },
			);
		},
	});

	pi.registerTool({
		name: "ask_council",
		label: "Ask Council",
		description:
			"Ask a council of heterogeneous models to debate via generate → critique → synthesize. " +
			"Pre-flight validates ≥2 provider families and surfaces the call estimate before launch.",
		promptSnippet: "Ask a multi-model council to debate a complex question",
		promptGuidelines: [
			"Use ask_council for high-impact architecture, strategy, or research where disagreement is valuable.",
			"Use council_form first when the user wants a council for an ongoing workstream.",
			"Use council_dissolve when a session council is no longer needed.",
		],
		parameters: AskCouncilSchema,
		async execute(_id, params: AskCouncilInput, _signal, _onUpdate, ctx) {
			if ((params.mode ?? "DEBATE") === "PAIR") {
				try {
					return await runPairMode({ params, ctx, councils });
				} finally {
					refreshCouncilStatus(ctx, councils, pairs);
				}
			}
			const slot =
				councils.get(params.council ?? "default") ??
				defaultSlot(snapshotAvailableModels(ctx));
			const members = unique(params.members ?? slot.definition.members);
			const definition: CouncilDefinition = {
				...slot.definition,
				members,
				chairman: params.chairman ?? slot.definition.chairman,
			};
			const report = preflight(definition, slot.availableSnapshot);
			ctx.ui.notify(
				`Council "${definition.name}" debating with ${definition.members.length} member(s)...`,
				"info",
			);
			try {
				const record = await deliberate({
					definition,
					prompt: params.prompt,
					ctx,
					availableSnapshot: slot.availableSnapshot,
					stateManager,
					parallelTimeoutMs: params.limits?.timeoutMs,
					onProgress: (text) => {
						ctx.ui.setStatus("council", `${definition.name}: ${text}`);
					},
				});
				const failures = [...record.generation, ...record.critiques].filter(
					(run) => !run.ok,
				);
				const sections: string[] = [];
				if (report.warnings.length > 0) {
					sections.push(`Pre-flight warnings:\n${report.warnings.map((w) => `- ${w}`).join("\n")}`);
				}
				if (failures.length > 0) {
					sections.push(`Partial failures:\n${formatFailures(failures)}`);
				}
				const synthOutput = record.synthesis?.output ?? "(no synthesis)";
				const body = sections.length > 0
					? `${synthOutput}\n\n${sections.join("\n\n")}`
					: synthOutput;
				return okText(body, {
					...deliberationDetails(record),
					warnings: report.warnings,
				});
			} finally {
				refreshCouncilStatus(ctx, councils, pairs);
			}
		},
	});

	pi.registerCommand("council-form", {
		description: "Interactively form a session-local model council",
		handler: async (args, ctx) => {
			const requestedName = args.trim();
			const name =
				requestedName ||
				(await ctx.ui.input("Council name", "architecture"));
			if (!name) return;

			const purposeInput = await ctx.ui.input(
				"Council purpose (optional)",
				"Design review, safety review, research...",
			);
			const purpose = purposeInput?.trim() || undefined;
			const snapshot = snapshotAvailableModels(ctx);
			const baseModels = snapshot.length > 0 ? snapshot : chooseCouncilModels(snapshot);
			const ourRecord = await currentPanopticonRecord(ctx.cwd);
			const { options, describe } = councilPickerOptions(baseModels, ourRecord?.name);
			if (options.length === 0) {
				ctx.ui.notify("No models or live agents available for council formation.", "error");
				return;
			}

			const sizeChoices = ["3", "4", "5", "6"].filter((s) => Number(s) <= options.length);
			if (sizeChoices.length === 0) {
				ctx.ui.notify(
					`Need at least 3 distinct options; only ${options.length} available.`,
					"error",
				);
				return;
			}
			const sizeChoice = await ctx.ui.select(
				"Total participants (members + chairman)",
				sizeChoices,
			);
			if (!sizeChoice) return;
			const total = Number(sizeChoice);
			const memberCount = total - 1;

			const members = await pickCouncilMembers(ctx, options, memberCount, describe);
			if (!members) return;

			const chairman = await pickModel(ctx, "Select chairman", options, {
				selected: members,
				describe,
			});
			if (!chairman) return;

			const definition = makeDefinition({
				name: name.trim(),
				purpose,
				members,
				chairman,
			});
			const report = preflight(definition, snapshot);
			if (!report.ok) {
				ctx.ui.notify(
					`Council pre-flight failed:\n${report.reasons.join("\n")}`,
					"error",
				);
				return;
			}

			councils.set(definition.name, {
				definition,
				availableSnapshot: snapshot,
			});
			refreshCouncilStatus(ctx, councils, pairs);
			ctx.ui.notify(
				`Formed council "${definition.name}" with ${definition.members.length} member(s).`,
				"info",
			);
		},
	});

	registerCouncilListCommand(pi, councils);
	registerCouncilEditCommand(pi, councils, (ctx) => {
		refreshCouncilStatus(ctx, councils, pairs);
	});
	registerPairCommands({
		pi,
		pairs,
		refreshStatus: (ctx) => refreshCouncilStatus(ctx, councils, pairs),
	});

	pi.registerCommand("council-ask", {
		description: "Interactively ask a council to deliberate",
		handler: async (args, ctx) => {
			const names = selectableCouncilNames(councils);
			if (names.length === 0) {
				ctx.ui.notify("No councils available.", "warning");
				return;
			}
			const councilName =
				names.length === 1 ? names[0] : await ctx.ui.select("Council", names);
			if (!councilName) return;
			const slot = councils.get(councilName);
			if (!slot) {
				ctx.ui.notify(`No council "${councilName}".`, "error");
				return;
			}
			const promptInput = args.trim() || (await ctx.ui.editor("Council prompt", ""));
			const prompt = promptInput?.trim();
			if (!prompt) return;

			const report = preflight(slot.definition, slot.availableSnapshot);
			for (const warning of report.warnings) {
				ctx.ui.notify(warning, "warning");
			}

			ctx.ui.notify(`Council "${slot.definition.name}" deliberating...`, "info");
			try {
				const record = await deliberate({
					definition: slot.definition,
					prompt,
					ctx,
					availableSnapshot: slot.availableSnapshot,
					stateManager,
					onProgress: (text) => {
						ctx.ui.setStatus("council", `${slot.definition.name}: ${text}`);
					},
				});
				const synthesis = record.synthesis?.output ?? "(no synthesis)";
				pi.sendUserMessage(
					`[Council "${slot.definition.name}" synthesis]\n\n${synthesis}`,
					{ deliverAs: "followUp" },
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			} finally {
				refreshCouncilStatus(ctx, councils, pairs);
			}
		},
	});

	pi.registerCommand("council-dissolve", {
		description: "Interactively dissolve a session-local council",
		handler: async (_args, ctx) => {
			const names = selectableCouncilNames(councils);
			if (names.length === 0) {
				ctx.ui.notify("No councils available.", "warning");
				return;
			}
			const name = await ctx.ui.select("Dissolve council", names);
			if (!name) return;
			const confirmed = await ctx.ui.confirm(
				"Dissolve council?",
				`Remove session-local council "${name}"?`,
			);
			if (!confirmed) return;
			councils.delete(name);
			refreshCouncilStatus(ctx, councils, pairs);
			ctx.ui.notify(`Dissolved "${name}".`, "info");
		},
	});

	pi.registerCommand("council-last", {
		description: "Inject the last council synthesis into the chat",
		handler: async (_args, ctx) => {
			const latest = latestDeliberation(stateManager);
			if (!latest) {
				ctx.ui.notify(
					"No council deliberations have been recorded.",
					"warning",
				);
				return;
			}
			const synthesis = latest.synthesis?.output ?? "(no synthesis)";
			pi.sendUserMessage(
				`[Last council synthesis — "${latest.council}"]\n\n${synthesis}`,
				{ deliverAs: "followUp" },
			);
		},
	});
}
