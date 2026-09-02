/** KISS boost lease: switch model in-session, run framed prompt, restore on settle. */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { openBoostSettingsOverlay } from "./boost-settings-overlay.js";
import {
	queueSaveBoostSetting,
	resolveBoostModel,
	resolveMaxYields,
} from "./boost-settings.js";

/** Anti-rut framing prepended to every boost prompt (ADR-052). */
const ANTI_RUT_FRAME =
	"Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\n";

const SETTLE_POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * Wait until the agent has fully settled (no streaming, no queued messages).
 * agent_end fires before auto-retry/compaction/follow-ups; the 0.74 extension
 * API exposes no agent_settled event, so poll the idle/pending state instead.
 */
async function waitForSettled(ctx: ExtensionContext): Promise<void> {
	const deadline = Date.now() + SETTLE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (ctx.isIdle() && !ctx.hasPendingMessages()) return;
		await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
	}
}

/** Minimal model shape used for boost switching (avoids pi's internal Model type). */
interface BoostCandidateModel {
	readonly provider: string;
	readonly id: string;
	readonly input: readonly string[];
}

interface BoostLeaseState {
	yieldsUsed: number;
	/** Original model to restore when the boost run settles. */
	originalModel: BoostCandidateModel | undefined;
	/** Sticky failure: baseline restore failed; dispatch blocked until reset retries it. */
	revertFailed: boolean;
}

function createLeaseState(): BoostLeaseState {
	return { yieldsUsed: 0, originalModel: undefined, revertFailed: false };
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
	const current = ctx.model ? modelId(ctx.model) : "";
	const candidates = ctx.modelRegistry
		.getAvailable()
		.filter((m) => m.input.includes("text"))
		.filter((m) => `${m.provider}/${m.id}` !== current) as Array<BoostCandidateModel>;
	return candidates[0];
}

/** Powerline shows only lease state and remaining yields — never prompt or model text (ADR-057). */
async function updateStatus(
	ctx: ExtensionContext,
	lease: BoostLeaseState,
): Promise<void> {
	if (!ctx.hasUI) return;
	const maxYields = await resolveMaxYields(ctx.cwd);
	const remaining = Math.max(0, maxYields - lease.yieldsUsed);
	const state = lease.revertFailed
		? "blocked · restore failed"
		: lease.originalModel
			? "active"
			: "off";
	ctx.ui.setStatus("boost", `Boost ${state} · ${remaining} left`);
}

export function createBoostExtension(): (pi: ExtensionAPI) => void {
	const lease = createLeaseState();

	return (pi: ExtensionAPI) => {
		// Restore the baseline only when the run is fully settled (after retries,
		// compaction, and queued follow-ups have drained).
		pi.on("agent_end", async (_event, ctx) => {
			if (!lease.originalModel) return;
			await waitForSettled(ctx);
			if (!lease.originalModel) return;
			const restore = lease.originalModel;
			try {
				const switched = await pi.setModel(restore as never);
				if (!switched) throw new Error("model switch rejected");
				lease.originalModel = undefined;
				await updateStatus(ctx, lease);
			} catch (error) {
				lease.revertFailed = true;
				ctx.ui.notify(
					`Boost restore failed: session remains on the boost model. Run /boost reset to retry restoration. (${String(error)})`,
					"error",
				);
				await updateStatus(ctx, lease);
			}
		});

		pi.registerCommand("boost", {
			description: "Switch to a boost model, run prompt, switch back",
			handler: async (args, ctx) => {
				const rest = args.trim();

				if (rest === "status") {
					const maxYields = await resolveMaxYields(ctx.cwd);
					const configured = (await resolveBoostModel(ctx.cwd)) ?? "auto";
					const current = modelId(ctx.model);
					const state = lease.revertFailed
						? "blocked (restore failed)"
						: lease.originalModel
							? "active"
							: "off";
					ctx.ui.notify(
						`Boost: ${state} · yields ${lease.yieldsUsed}/${maxYields} used · configured=${configured} · current=${current}`,
						"info",
					);
					await updateStatus(ctx, lease);
					return;
				}

				if (rest === "reset") {
					lease.yieldsUsed = 0;
					if (lease.revertFailed && lease.originalModel) {
						try {
							const switched = await pi.setModel(
								lease.originalModel as never,
							);
							if (!switched) throw new Error("model switch rejected");
							lease.originalModel = undefined;
							lease.revertFailed = false;
							ctx.ui.notify(
								"Boost lease reset: yields cleared and baseline restored.",
								"info",
							);
						} catch (error) {
							ctx.ui.notify(
								`Boost reset: baseline restore still failing (${String(error)}).`,
								"error",
							);
						}
					} else {
						ctx.ui.notify("Boost lease reset: yields cleared.", "info");
					}
					await updateStatus(ctx, lease);
					return;
				}

				if (rest === "settings" || rest === "") {
					await openBoostSettingsOverlay(ctx);
					return;
				}

				if (rest === "clear") {
					await queueSaveBoostSetting("model", "");
					ctx.ui.notify(
						"Boost model cleared (auto). Use /boost settings to pick a model.",
						"info",
					);
					return;
				}

				// — Run boost: switch model, send framed prompt, restore on settle —
				if (lease.revertFailed) {
					ctx.ui.notify(
						"Boost blocked: baseline restore failed. Run /boost reset to retry restoration.",
						"warning",
					);
					return;
				}

				if (lease.originalModel) {
					ctx.ui.notify(
						"Boost already active: a boost turn is in flight.",
						"warning",
					);
					return;
				}

				const maxYields = await resolveMaxYields(ctx.cwd);
				if (lease.yieldsUsed >= maxYields) {
					ctx.ui.notify(
						`Boost denied: lease exhausted (${lease.yieldsUsed}/${maxYields} yields used). Run /boost reset to start a new lease.`,
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

				lease.originalModel =
					(ctx.model as BoostCandidateModel | undefined) ?? undefined;
				const switched = await pi.setModel(boostModel as never);
				if (!switched) {
					lease.originalModel = undefined;
					ctx.ui.notify(
						`Boost denied: no auth configured for ${modelId(boostModel)}.`,
						"warning",
					);
					await updateStatus(ctx, lease);
					return;
				}

				lease.yieldsUsed++;
				await updateStatus(ctx, lease);

				const message = ANTI_RUT_FRAME + rest;
				try {
					const idle =
						typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
					if (idle) {
						pi.sendUserMessage(message);
					} else {
						pi.sendUserMessage(message, { deliverAs: "followUp" });
					}
				} catch (error) {
					// Failed dispatch consumes no yield; restore immediately (ADR-057 §3).
					lease.yieldsUsed = Math.max(0, lease.yieldsUsed - 1);
					try {
						await pi.setModel(lease.originalModel as never);
						lease.originalModel = undefined;
					} catch {
						lease.revertFailed = true;
					}
					ctx.ui.notify(`Boost failed to dispatch: ${String(error)}`, "error");
					await updateStatus(ctx, lease);
				}
			},
		});
	};
}
export default createBoostExtension();
