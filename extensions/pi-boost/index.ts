/** KISS boost: switch model in-session, run prompt with anti-rut framing, switch back. */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { openBoostSettingsOverlay } from "./boost-settings-overlay.js";
import { resolveBoostModel, resolveMaxYields } from "./boost-settings.js";

/** Anti-rut framing prepended to every boost prompt (ADR-052). */
const ANTI_RUT_FRAME =
	"Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\n";

interface BoostLeaseState {
	yieldsUsed: number;
	/** Original model to restore after the boost turn completes. */
	originalModel: BoostCandidateModel | undefined;
}

function createLeaseState(): BoostLeaseState {
	return { yieldsUsed: 0, originalModel: undefined };
}

function modelId(model: unknown): string {
	if (
		typeof model === "object" &&
		model !== null &&
		"provider" in model &&
		"id" in model
	) {
		return `${(model as { provider: string }).provider}/${(model as { id: string }).id}`;
	}
	return "unknown";
}

/** Minimal model shape used for boost switching (avoids pi's internal Model type). */
interface BoostCandidateModel {
	readonly provider: string;
	readonly id: string;
	readonly input: readonly string[];
}

function findModel(
	ctx: ExtensionContext,
	targetId: string,
): BoostCandidateModel | undefined {
	return ctx.modelRegistry
		.getAvailable()
		.find((m) => `${m.provider}/${m.id}` === targetId) as
		| BoostCandidateModel
		| undefined;
}

/** Auto-pick a text-capable boost model from the registry (first that differs from current). */
function autoPickBoostModel(
	ctx: ExtensionContext,
): BoostCandidateModel | undefined {
	const current = ctx.model
		? `${(ctx.model as { provider: string }).provider}/${(ctx.model as { id: string }).id}`
		: "";
	const candidates = ctx.modelRegistry
		.getAvailable()
		.filter((m) => m.input.includes("text"))
		.filter(
			(m) => `${m.provider}/${m.id}` !== current,
		) as Array<BoostCandidateModel>;
	return candidates[0];
}

export function createBoostExtension(): (pi: ExtensionAPI) => void {
	const lease = createLeaseState();

	return (pi: ExtensionAPI) => {
		// Switch back to the original model after the boost turn completes.
		pi.on("agent_end", async () => {
			if (lease.originalModel) {
				const restore = lease.originalModel;
				lease.originalModel = undefined;
				await pi.setModel(restore as never);
			}
		});

		pi.registerCommand("boost", {
			description: "Switch to a boost model, run prompt, switch back",
			handler: async (args, ctx) => {
				const rest = args.trim();

				if (rest === "status") {
					ctx.ui.notify(
						`Boost: yields ${lease.yieldsUsed} used · model=${(await resolveBoostModel(ctx.cwd)) ?? "auto"} · current=${modelId(ctx.model)}`,
						"info",
					);
					return;
				}

				if (rest === "reset") {
					lease.yieldsUsed = 0;
					ctx.ui.notify("Boost lease reset: yields cleared.", "info");
					return;
				}

				if (rest === "settings" || rest === "") {
					await openBoostSettingsOverlay(ctx);
					return;
				}

				if (rest === "clear") {
					ctx.ui.notify(
						"Boost cleared. Use /boost settings to configure.",
						"info",
					);
					return;
				}

				// — Run boost: switch model, send prompt, switch back on agent_end —
				if (lease.originalModel) {
					ctx.ui.notify(
						"Boost already active: a boost turn is in flight.",
						"warning",
					);
					return;
				}

				const configuredId = await resolveBoostModel(ctx.cwd);
				const boostModel = configuredId
					? findModel(ctx, configuredId)
					: autoPickBoostModel(ctx);

				if (!boostModel) {
					ctx.ui.notify(
						`Boost denied: no boost model available (configured=${configuredId ?? "auto"}). Use /boost settings to pick a model.`,
						"warning",
					);
					return;
				}

				// Save original and switch.
				lease.originalModel =
					(ctx.model as BoostCandidateModel | undefined) ?? undefined;
				const switched = await pi.setModel(boostModel as never);
				if (!switched) {
					lease.originalModel = undefined;
					ctx.ui.notify(
						`Boost denied: no auth configured for ${modelId(boostModel)}.`,
						"warning",
					);
					return;
				}

				lease.yieldsUsed++;
				const maxYields = await resolveMaxYields(ctx.cwd);
				const remaining = Math.max(0, maxYields - lease.yieldsUsed);
				ctx.ui.notify(
					`Boost: switched to ${modelId(boostModel)} · yield ${lease.yieldsUsed}/${maxYields} · ${remaining} remaining after this turn. Original model restored on turn end.`,
					"info",
				);
				pi.sendUserMessage(ANTI_RUT_FRAME + rest);
			},
		});
	};
}

export default createBoostExtension();
