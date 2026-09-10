/** KISS boost lease: switch model in-session, run framed prompt, restore on settle. */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CHALLENGE_FRAME, PLAN_FRAME, parseBoostMode, recentUserProblem } from "./boost-modes.js";
import { openBoostSettingsOverlay } from "./boost-settings-overlay.js";
import {
	queueSaveBoostSetting,
	resolveBoostModel,
	resolveLeaseMinutes,
	resolveMaxYields,
} from "./boost-settings.js";
import {
	STATUS_LABELS,
	createLeaseState,
	leaseState,
	renewExpiredLease,
	updateStatus,
	waitForSettled,
} from "./lease-state.js";
import type { BoostCandidateModel } from "./lease-state.js";

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
		.filter(
			(m) => `${m.provider}/${m.id}` !== current,
		) as Array<BoostCandidateModel>;
	return candidates[0];
}

export function createBoostExtension(): (pi: ExtensionAPI) => void {
	const lease = createLeaseState();

	return (pi: ExtensionAPI) => {
		async function restoreBaseline(): Promise<void> {
			const switched = await pi.setModel(lease.originalModel as never);
			if (!switched) throw new Error("model switch rejected");
			lease.originalModel = undefined;
			lease.revertFailed = false;
		}

		// Restore the baseline only when the run is fully settled (after retries,
		// compaction, and queued follow-ups have drained).
		pi.on("agent_end", async (_event, ctx) => {
			if (!lease.originalModel) return;
			await waitForSettled(ctx);
			if (!lease.originalModel) return;
			try {
				await restoreBaseline();
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
			description:
				"Boost a prompt with the boost model (default: challenge assumptions; /boost plan for a TODO plan)",
			handler: async (args, ctx) => {
				const rest = args.trim();
				const leaseMinutes = await resolveLeaseMinutes(ctx.cwd);

				if (rest === "status") {
					const maxYields = await resolveMaxYields(ctx.cwd);
					const configured = (await resolveBoostModel(ctx.cwd)) ?? "auto";
					const current = modelId(ctx.model);
					const state =
						STATUS_LABELS[leaseState(lease, Date.now(), leaseMinutes * 60_000)] ?? "unknown";
					ctx.ui.notify(
						`Boost: ${state} · yields ${lease.yieldsUsed}/${maxYields} used · lease=${leaseMinutes}m · configured=${configured} · current=${current}`,
						"info",
					);
					await updateStatus(ctx, lease);
					return;
				}

				if (rest === "reset") {
					lease.yieldsUsed = 0;
					lease.startedAtMs = undefined;
					if (lease.revertFailed && lease.originalModel) {
						try {
							await restoreBaseline();
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

				if (renewExpiredLease(lease, Date.now(), leaseMinutes * 60_000)) {
					await updateStatus(ctx, lease);
				}

				if (rest === "settings" || rest === "") {
					await openBoostSettingsOverlay(ctx);
					await updateStatus(ctx, lease);
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

			// — Boost modes: challenge (default) or plan; first word selects the mode —
			const { mode, prompt } = parseBoostMode(rest);
			const resolvedPrompt = prompt || (await recentUserProblem(ctx)) || "";
			if (!resolvedPrompt) {
				ctx.ui.notify(
					"Boost denied: no prompt given and no recent user problem to work from.",
					"warning",
				);
				await updateStatus(ctx, lease);
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

				if (lease.yieldsUsed === 0) lease.startedAtMs = Date.now();
				lease.yieldsUsed++;
				await updateStatus(ctx, lease);

				const message = (mode === "plan" ? PLAN_FRAME : CHALLENGE_FRAME) + resolvedPrompt;
				try {
					const idle = typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
					if (idle) {
						pi.sendUserMessage(message);
					} else {
						pi.sendUserMessage(message, { deliverAs: "followUp" });
					}
				} catch (error) {
					// Failed dispatch consumes no yield; restore immediately (ADR-057 §3).
					lease.yieldsUsed = Math.max(0, lease.yieldsUsed - 1);
					try {
						await restoreBaseline();
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
