/**
 * Slash-command registration adapters for the Pi LLM Council extension.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { deliberate, preflight } from "./deliberation.js";
import { registerCouncilEditCommand } from "./edit-command.js";
import type { CouncilExtensionState } from "./extension-state.js";
import { registerCouncilListCommand } from "./list-command.js";
import {
	chooseCouncilModels,
	councilPickerOptions,
	snapshotAvailableModels,
} from "./members.js";
import { registerPairCommands } from "./pair-commands.js";
import { pickCouncilMembers, pickModel } from "./picker.js";
import { currentPanopticonRecord } from "./runner.js";
import { refreshCouncilStatus } from "./status-bar.js";
import {
	latestDeliberation,
	makeDefinition,
	selectableCouncilNames,
} from "./support.js";

export function registerCouncilCommands(
	pi: ExtensionAPI,
	state: CouncilExtensionState,
): void {
	const { councils, pairs, stateManager } = state;
	const refreshStatus = (ctx: Parameters<typeof refreshCouncilStatus>[0]) => {
		refreshCouncilStatus(ctx, councils, pairs);
	};

	pi.registerCommand("council-form", {
		description: "Interactively form a session-local model council",
		handler: async (args, ctx) => {
			const requestedName = args.trim();
			const name = requestedName || (await ctx.ui.input("Council name", "architecture"));
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
				ctx.ui.notify(`Need at least 3 distinct options; only ${options.length} available.`, "error");
				return;
			}
			const sizeChoice = await ctx.ui.select("Total participants (members + chairman)", sizeChoices);
			if (!sizeChoice) return;
			const memberCount = Number(sizeChoice) - 1;

			const members = await pickCouncilMembers(ctx, options, memberCount, describe);
			if (!members) return;

			const chairman = await pickModel(ctx, "Select chairman", options, { selected: members, describe });
			if (!chairman) return;

			const definition = makeDefinition({ name: name.trim(), purpose, members, chairman });
			const report = preflight(definition, snapshot);
			if (!report.ok) {
				ctx.ui.notify(`Council pre-flight failed:\n${report.reasons.join("\n")}`, "error");
				return;
			}

			councils.set(definition.name, { definition, availableSnapshot: snapshot });
			refreshStatus(ctx);
			ctx.ui.notify(`Formed council "${definition.name}" with ${definition.members.length} member(s).`, "info");
		},
	});

	registerCouncilListCommand(pi, councils);
	registerCouncilEditCommand(pi, councils, refreshStatus);
	registerPairCommands({ pi, pairs, refreshStatus });

	pi.registerCommand("council-ask", {
		description: "Interactively ask a council to deliberate",
		handler: async (args, ctx) => {
			const names = selectableCouncilNames(councils);
			if (names.length === 0) {
				ctx.ui.notify("No councils available.", "warning");
				return;
			}
			const councilName = names.length === 1 ? names[0] : await ctx.ui.select("Council", names);
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
				pi.sendUserMessage(`[Council "${slot.definition.name}" synthesis]\n\n${synthesis}`, { deliverAs: "followUp" });
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				refreshStatus(ctx);
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
			const confirmed = await ctx.ui.confirm("Dissolve council?", `Remove session-local council "${name}"?`);
			if (!confirmed) return;
			councils.delete(name);
			refreshStatus(ctx);
			ctx.ui.notify(`Dissolved "${name}".`, "info");
		},
	});

	pi.registerCommand("council-last", {
		description: "Inject the last council synthesis into the chat",
		handler: async (_args, ctx) => {
			const latest = latestDeliberation(stateManager.list());
			if (!latest) {
				ctx.ui.notify("No council deliberations have been recorded.", "warning");
				return;
			}
			const synthesis = latest.synthesis?.output ?? "(no synthesis)";
			pi.sendUserMessage(`[Last council synthesis — "${latest.council}"]\n\n${synthesis}`, { deliverAs: "followUp" });
		},
	});
}
