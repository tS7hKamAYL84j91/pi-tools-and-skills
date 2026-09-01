/** Inert and cognitive `/boost` command registration, settings overlay, and bounded feedback. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveBoostSettings } from "../boost-settings.js";
import { openBoostSettingsOverlay } from "./boost-settings-overlay.js";
import {
	boundedBoostReason,
	boostDenialLabel,
	boostParseFeedback,
	formatBoostStatus,
} from "./boost-command-feedback.js";
import type {
	BoostFusionRequest,
} from "./cognitive-types.js";
import { handleCognitiveFusionCommand } from "./cognitive-command.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
} from "./host-capabilities.js";
import type {
	BoostDenialReason,
	BoostLeaseStatus,
	BoostResult,
	ReserveBoostInput,
} from "./contracts.js";

// Contract types and the inert dispatch boundary live in command-types.ts;
// re-exported here to preserve the existing import surface.
export {
	InertBoostDispatch,
	type BoostCommandDeps,
	type BoostCommandDispatchDecision,
	type BoostCommandIdentity,
} from "./command-types.js";
import type { BoostCommandDeps } from "./command-types.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Register the `/boost` command for environmental, cognitive, and settings operations. */
export function registerBoostCommand(
	pi: ExtensionAPI,
	deps: BoostCommandDeps,
): void {
	pi.registerCommand("boost", {
		description:
			"Request, inspect, or reset a host-controlled boost lease, run cognitive fusion, or configure settings",
		handler: async (args, ctx) => {
			const parsed = deps.parse(commandInput(args));
			if (!parsed.ok) {
				deps.notify(ctx, boostParseFeedback(parsed.error.code), "warning");
				return;
			}
			const hostCapabilities =
				deps.hostCapabilities ?? DEFAULT_BOOST_HOST_CAPABILITIES;
			const effectiveSettings = resolveEffectiveBoostSettings(
				ctx.cwd,
				hostCapabilities.isProjectTrusted(ctx.cwd, ctx),
				hostCapabilities.globalSettingsPath,
			);

			if (parsed.command.kind === "settings") {
				await openBoostSettingsOverlay(ctx, hostCapabilities);
				return;
			}

			const identity = deps.identity(ctx);
			const isPrincipal = identity?.actor.kind === "principal";
			const isAgentEnabled = identity?.actor.kind === "agent";
			const agentCapabilityAllowed =
				isPrincipal ||
				(isAgentEnabled &&
					effectiveSettings.agentSelfBoost.enabled &&
					(effectiveSettings.agentSelfBoost.allowEnvironmental ||
						effectiveSettings.agentSelfBoost.allowCognitive));

			if (!identity || !agentCapabilityAllowed) {
				deps.notify(
					ctx,
					"Boost denied: Principal identity required",
					"warning",
				);
				return;
			}

			switch (parsed.command.kind) {
				case "status":
					notifyResult(
						ctx,
						deps,
						"Boost status",
						await deps.authority.getStatus(identity.actor),
					);
					return;
				case "reset":
					notifyResult(
						ctx,
						deps,
						"Boost reset",
						await deps.authority.reset({
							actor: identity.actor,
							subjectId: identity.subject.subjectId,
						}),
					);
					return;
				case "fusion": {
					if (
						!isPrincipal &&
						!effectiveSettings.agentSelfBoost.allowCognitive
					) {
						deps.notify(
							ctx,
							"Boost fusion denied: cognitive self-boost is disabled",
							"warning",
						);
						return;
					}
					if (!deps.cognitive) {
						deps.notify(ctx, "Boost fusion unavailable", "error");
						return;
					}
					if (
						!isPrincipal &&
						(parsed.command.fusion.profile !== undefined ||
							parsed.command.fusion.panelSize !== undefined)
					) {
						deps.notify(
							ctx,
							"Boost fusion denied: agent profile and panel caps are fixed by operator settings",
							"warning",
						);
						return;
					}
					// Default single-model rut-breaker; explicit panel size opts into judge fusion for the call.
					const singleMode =
						effectiveSettings.mode !== "fusion" &&
						parsed.command.fusion.panelSize === undefined;
					const fusionInput: BoostFusionRequest = isPrincipal
						? {
								...parsed.command.fusion,
								single: singleMode,
								requireApprovalAboveCalls: 5,
								auditActor: "principal",
								auditSurface: "command",
							}
						: {
								prompt: parsed.command.fusion.prompt,
								single: singleMode,
								profile: effectiveSettings.profile,
								panelSize: Math.min(
									effectiveSettings.panelSize,
									effectiveSettings.agentSelfBoost.maxPanelModels,
								),
								models: effectiveSettings.models,
								...(effectiveSettings.judge
									? { judge: effectiveSettings.judge }
									: {}),
								timeoutMs: effectiveSettings.timeoutMs,
								requireApprovalAboveCalls:
									Math.min(
										effectiveSettings.panelSize,
										effectiveSettings.agentSelfBoost.maxPanelModels,
									) + 1,
								auditActor: "agent",
								auditSurface: "command",
							};
					await handleCognitiveFusionCommand(
						ctx,
						fusionInput,
						deps.cognitive,
						deps.notify,
					);
					return;
				}
				case "request": {
					if (
						!isPrincipal &&
						!effectiveSettings.agentSelfBoost.allowEnvironmental
					) {
						deps.notify(
							ctx,
							"Boost denied: environmental self-boost is disabled",
							"warning",
						);
						return;
					}
					if (
						!isPrincipal &&
						parsed.command.request.requestedYields >
							effectiveSettings.agentSelfBoost.maxYields
					) {
						deps.notify(
							ctx,
							"Boost denied: requested yields exceed the operator capability cap",
							"warning",
						);
						return;
					}
					const reservationInput: ReserveBoostInput = {
						actor: identity.actor,
						subject: identity.subject,
						request: parsed.command.request,
					};
					const result = await deps.authority.reserve(reservationInput);
					if (!result.ok) {
						notifyDenial(ctx, deps, result.reason);
						return;
					}
					if (result.value.state !== "Reserved") {
						deps.notify(ctx, "Boost denied: reservation unavailable", "error");
						return;
					}
					const dispatch = await deps.dispatch.recordReservation(
						result.value,
						reservationInput,
					);
					if (dispatch.kind === "denied") {
						deps.notify(
							ctx,
							`Boost denied: ${boundedBoostReason(dispatch.reason)}`,
							"warning",
						);
						return;
					}
					if (dispatch.kind === "terminal") {
						deps.notify(
							ctx,
							`Boost completed: outcome=${boundedBoostReason(dispatch.outcome)}`,
							"info",
						);
						return;
					}
					deps.notify(
						ctx,
						formatBoostStatus("Boost reserved (inert)", result.value),
						"info",
					);
				}
			}
		},
	});
}

function commandInput(args: string | undefined): string {
	return args && args.length > 0 ? `/boost ${args}` : "/boost";
}

function notifyResult(
	ctx: ExtensionCommandContext,
	deps: BoostCommandDeps,
	label: string,
	result: BoostResult<BoostLeaseStatus>,
): void {
	if (!result.ok) {
		notifyDenial(ctx, deps, result.reason);
		return;
	}
	deps.notify(ctx, formatBoostStatus(label, result.value), "info");
}

function notifyDenial(
	ctx: ExtensionCommandContext,
	deps: BoostCommandDeps,
	reason: BoostDenialReason,
): void {
	deps.notify(ctx, `Boost denied: ${boostDenialLabel(reason)}`, "warning");
}