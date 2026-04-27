/**
 * Tool registration adapters for the Pi LLM Council extension.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import type { CouncilExtensionState } from "./extension-state.js";
import {
	COUNCIL_MAX,
	chooseChairmanModel,
	chooseCouncilModels,
	snapshotAvailableModels,
	unique,
} from "./members.js";
import { runPairMode } from "./pair-command.js";
import { refreshCouncilStatus } from "./status-bar.js";
import type { CouncilDefinition } from "./types.js";
import {
	AskCouncilSchema,
	CouncilDissolveSchema,
	CouncilFormSchema,
	CouncilUpdateSchema,
	defaultSlot,
	deliberationDetails,
	councilLines,
	makeDefinition,
	okText,
	type AskCouncilInput,
	type CouncilDissolveInput,
	type CouncilFormInput,
	type CouncilUpdateInput,
} from "./support.js";

export function registerCouncilTools(
	pi: ExtensionAPI,
	state: CouncilExtensionState,
): void {
	const { councils, pairs, stateManager } = state;

	pi.registerTool({
		name: "council_form",
		label: "Form Council",
		description: "Create or replace a named session-local council. Snapshots the model registry at form time so member validity is stable for the session.",
		promptSnippet: "Create a named council of models for this session",
		parameters: CouncilFormSchema,
		async execute(_id, params: CouncilFormInput, _signal, _onUpdate, ctx) {
			const snapshot = snapshotAvailableModels(ctx);
			const members = unique(params.members ?? chooseCouncilModels(snapshot)).slice(0, COUNCIL_MAX);
			if (members.length === 0) {
				throw new Error("Council must have at least one member.");
			}
			const definition = makeDefinition({
				name: params.name,
				purpose: params.purpose,
				members,
				chairman: params.chairman ?? chooseChairmanModel(snapshot, members),
			});
			const report = preflight(definition, snapshot);
			if (!report.ok) {
				throw new Error(`Council pre-flight failed:\n  ${report.reasons.join("\n  ")}`);
			}
			councils.set(definition.name, { definition, availableSnapshot: snapshot });
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
		description: "Update an existing session-local council's members, chairman, or purpose while preserving unspecified fields.",
		promptSnippet: "Change models or purpose for an existing council",
		parameters: CouncilUpdateSchema,
		async execute(_id, params: CouncilUpdateInput, _signal, _onUpdate, ctx) {
			const slot = councils.get(params.name);
			if (!slot) throw new Error(`No council "${params.name}".`);
			if (!params.members && !params.chairman && params.purpose === undefined) {
				throw new Error("Provide members, chairman, or purpose to update.");
			}
			const snapshot = snapshotAvailableModels(ctx);
			const availableSnapshot = snapshot.length > 0 ? snapshot : slot.availableSnapshot;
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
				throw new Error(`Council pre-flight failed:\n  ${report.reasons.join("\n  ")}`);
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
			if (councils.size === 0) {
				return okText("No councils formed in this session.", { councils: [] });
			}
			const lines = councilLines(councils.values());
			return okText(`Councils:\n${lines.join("\n")}`, {
				councils: [...councils.values()].map((slot) => slot.definition),
			});
		},
	});

	pi.registerTool({
		name: "council_dissolve",
		label: "Dissolve Council",
		description: "Remove a named session-local council. Configured defaults reappear next session/reload.",
		promptSnippet: "Dissolve a named council for this session",
		parameters: CouncilDissolveSchema,
		async execute(_id, params: CouncilDissolveInput, _signal, _onUpdate, ctx) {
			const removed = councils.delete(params.name);
			refreshCouncilStatus(ctx, councils, pairs);
			return okText(
				removed ? `Dissolved "${params.name}".` : `No council "${params.name}".`,
				{ removed },
			);
		},
	});

	pi.registerTool({
		name: "ask_council",
		label: "Ask Council",
		description: "Ask a council of heterogeneous models to debate via generate → critique → synthesize. Pre-flight validates ≥2 provider families and surfaces the call estimate before launch.",
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
			const slot = councils.get(params.council ?? "default") ?? defaultSlot(snapshotAvailableModels(ctx));
			const members = unique(params.members ?? slot.definition.members);
			const definition: CouncilDefinition = {
				...slot.definition,
				members,
				chairman: params.chairman ?? slot.definition.chairman,
			};
			const report = preflight(definition, slot.availableSnapshot);
			ctx.ui.notify(`Council "${definition.name}" debating with ${definition.members.length} member(s)...`, "info");
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
				const failures = [...record.generation, ...record.critiques].filter((run) => !run.ok);
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
				return okText(body, { ...deliberationDetails(record), warnings: report.warnings });
			} finally {
				refreshCouncilStatus(ctx, councils, pairs);
			}
		},
	});
}
