/** Panopticon command adapter for an explicitly host-injected boost bridge. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
	LiveBoostLeaseStatus,
	LiveBoostResult,
	LiveBoostRuntimeBridge,
} from "../runtime/live-boost-bridge-contract.js";
import type { QBoostControlReference } from "../runtime/q-boost-control-contract.js";
import type { Registry } from "../types.js";
import type {
	BoostCommandDeps,
	BoostCommandDispatchDecision,
	BoostCommandIdentity,
} from "./command.js";
import { InertBoostDispatch } from "./command.js";
import type {
	BoostDenialReason,
	BoostLeaseStatus,
	BoostResult,
} from "./contracts.js";
import { parseBoostCommand } from "./parser.js";

export interface LiveBoostHostInjection {
	readonly bridge: LiveBoostRuntimeBridge;
	readonly control: QBoostControlReference;
	readonly shutdownChoice: "synchronous-restore" | "durable-block-marker";
}

/** Default command dependencies: visible denial and no reservation mutation. */
export function createUnavailableBoostCommandDeps(
	registry: Pick<Registry, "isRootSession" | "selfId">,
): BoostCommandDeps {
	const unavailable = <T>(): BoostResult<T> => ({
		ok: false,
		reason: "runtime-unavailable",
	});
	return {
		parse: parseBoostCommand,
		identity: (ctx) => principalIdentity(ctx, registry),
		authority: {
			reserve: unavailable,
			getStatus: unavailable,
			reset: unavailable,
		},
		notify: (ctx, message, level) => ctx.ui.notify(message, level),
		dispatch: new InertBoostDispatch(),
	};
}

/** Adapt only the injected bridge and immutable logical Q reference. */
export function createHostBoostCommandDeps(
	registry: Pick<Registry, "isRootSession" | "selfId">,
	injection: LiveBoostHostInjection,
): BoostCommandDeps {
	return {
		parse: parseBoostCommand,
		identity: (ctx) => principalIdentity(ctx, registry),
		authority: {
			reserve: async (input) =>
				mapStatus(
					await injection.bridge.reserve({
						caller: input.actor,
						subject: input.subject,
						request: input.request,
						control: injection.control,
					}),
				),
			getStatus: async (actor) =>
				mapStatus(
					await injection.bridge.getStatus({
						caller: actor,
						subjectId: registry.selfId,
					}),
				),
			reset: async (input) => {
				const result = await injection.bridge.reset({
					caller: input.actor,
					subjectId: input.subjectId,
					control: injection.control,
				});
				return result.ok
					? { ok: true, value: { state: "Idle" } }
					: bridgeDenial(result.reason);
			},
		},
		notify: (ctx, message, level) => ctx.ui.notify(message, level),
		dispatch: {
			recordReservation: async (status, input) => {
				if (!status.leaseId) {
					return deniedDispatch("lease-not-found");
				}
				const result = await injection.bridge.dispatch({
					caller: input.actor,
					subjectId: input.subject.subjectId,
					leaseId: status.leaseId,
					control: injection.control,
					combinedInput: input.request.combinedInput,
					isolation: input.request.isolation,
				});
				return result.ok
					? {
							dispatched: true,
							kind: "terminal",
							outcome: result.value.outcome,
						}
					: deniedDispatch(result.reason);
			},
		},
	};
}

function principalIdentity(
	ctx: ExtensionCommandContext,
	registry: Pick<Registry, "isRootSession" | "selfId">,
): BoostCommandIdentity | undefined {
	if (!registry.isRootSession()) {
		return undefined;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	return {
		actor: { kind: "principal", issuerId: sessionId },
		subject: {
			subjectId: registry.selfId,
			workspace: { workspaceId: sessionId, root: ctx.cwd },
		},
	};
}

function mapStatus(
	result: LiveBoostResult<
		LiveBoostLeaseStatus | { readonly state: "Idle" | "RevertFailed" }
	>,
): BoostResult<BoostLeaseStatus> {
	if (!result.ok) {
		return bridgeDenial(result.reason);
	}
	if (result.value.state !== "Reserved") {
		return { ok: true, value: { state: result.value.state } };
	}
	return {
		ok: true,
		value: {
			state: "Reserved",
			leaseId: result.value.leaseId,
			requestedYields: result.value.requestedYields,
			consumedYields: result.value.consumedYields,
			remainingYields: result.value.remainingYields,
		},
	};
}

function bridgeDenial(reason: string): BoostResult<never> {
	const mapped: BoostDenialReason =
		reason === "revert-failed" ? "revert-failed" : "runtime-unavailable";
	return { ok: false, reason: mapped };
}

function deniedDispatch(reason: string): BoostCommandDispatchDecision {
	return { dispatched: false, kind: "denied", reason };
}
