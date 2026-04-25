/** Interactive /council-edit command registration. */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { preflight } from "./deliberation.js";
import { chooseCouncilModels, snapshotAvailableModels } from "./members.js";
import { pickCouncilMembers, pickModel } from "./picker.js";
import type { CouncilDefinition } from "./types.js";

interface CouncilSlotLike {
	definition: CouncilDefinition;
	availableSnapshot: string[];
}

function selectableCouncilNames(councils: Map<string, CouncilSlotLike>): string[] {
	return [...councils.keys()].sort();
}

export function registerCouncilEditCommand(
	pi: ExtensionAPI,
	councils: Map<string, CouncilSlotLike>,
	onUpdated: (ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("council-edit", {
		description: "Edit an existing council's members, chairman, or purpose",
		handler: async (args, ctx) => {
			const names = selectableCouncilNames(councils);
			if (names.length === 0) {
				ctx.ui.notify("No councils available.", "warning");
				return;
			}
			const requestedName = args.trim();
			const name = requestedName || await ctx.ui.select("Council", names);
			if (!name) return;
			const slot = councils.get(name);
			if (!slot) {
				ctx.ui.notify(`No council "${name}".`, "error");
				return;
			}

			const action = await ctx.ui.select("Edit council", [
				"Replace members",
				"Change chairman",
				"Change purpose",
			]);
			if (!action) return;

			const snapshot = snapshotAvailableModels(ctx);
			const availableSnapshot = snapshot.length > 0
				? snapshot
				: slot.availableSnapshot;
			const modelOptions = availableSnapshot.length > 0
				? availableSnapshot
				: chooseCouncilModels(availableSnapshot);
			let members = slot.definition.members;
			let chairman = slot.definition.chairman;
			let purpose = slot.definition.purpose;

			if (action === "Replace members") {
				const picked = await pickCouncilMembers(ctx, modelOptions);
				if (!picked) return;
				members = picked;
			} else if (action === "Change chairman") {
				const picked = await pickModel(
					ctx,
					"Select chairman model",
					modelOptions,
					members,
				);
				if (!picked) return;
				chairman = picked;
			} else {
				const nextPurpose = await ctx.ui.input(
					"Council purpose",
					purpose ?? "Design review, safety review, research...",
				);
				if (nextPurpose === undefined) return;
				purpose = nextPurpose.trim() || undefined;
			}

			const definition: CouncilDefinition = {
				...slot.definition,
				purpose,
				members,
				chairman,
			};
			const report = preflight(definition, availableSnapshot);
			if (!report.ok) {
				ctx.ui.notify(
					`Council pre-flight failed:\n${report.reasons.join("\n")}`,
					"error",
				);
				return;
			}
			councils.set(definition.name, { definition, availableSnapshot });
			onUpdated(ctx);
			ctx.ui.notify(`Updated council "${definition.name}".`, "info");
		},
	});
}
