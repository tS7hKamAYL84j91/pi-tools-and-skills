/** Command adapter for an explicitly host-injected Boost bridge and cognitive deliberation. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveBoostSettings } from "../boost-settings.js";
import type {
	LiveBoostLeaseStatus,
	LiveBoostResult,
	LiveBoostRuntimeBridge,
} from "../live-boost-bridge-contract.js";
import type { LiveBoostControlReference } from "../live-boost-control-contract.js";
import { executeCognitiveLease } from "./cognitive-lease.js";
import type {
	BoostFusionRequest,
	CognitiveAuditSink,
	CognitiveModelRunner,
} from "./cognitive-types.js";
import type { BoostIdentitySource } from "./identity-source.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
	type BoostHostCapabilities,
} from "./host-capabilities.js";
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
	readonly control: LiveBoostControlReference;
	readonly shutdownChoice: "synchronous-restore" | "durable-block-marker";
}

interface CognitiveBoostDependencies {
	readonly runner?: CognitiveModelRunner;
	readonly hostCapabilities?: BoostHostCapabilities;
	readonly audit?: CognitiveAuditSink;
}

function createCognitiveHandler(cognitiveRunner?: CognitiveModelRunner, audit?: CognitiveAuditSink) {
	return async (input: BoostFusionRequest, ctx: ExtensionCommandContext) => {
		const available = ctx.modelRegistry.getAvailable();
		const visibleModels = available
			.filter((model) => model.input.includes("text"))
			.map((model) => `${model.provider}/${model.id}`);
		return executeCognitiveLease({
			prompt: input.prompt,
			profile: input.profile,
			panelSize: input.panelSize,
			models: input.models,
			judge: input.judge,
			timeoutMs: input.timeoutMs,
			requireApprovalAboveCalls: input.requireApprovalAboveCalls,
			audit,
			auditActor: input.auditActor,
			auditSurface: input.auditSurface,
			visibleModels,
			cwd: ctx.cwd,
			runner: cognitiveRunner,
		});
	};
}

/** Default command dependencies: visible denial for environmental boost, cognitive deliberation enabled. */
export function createUnavailableBoostCommandDeps(
	identitySource: BoostIdentitySource,
	options: CognitiveBoostDependencies = {},
): BoostCommandDeps {
	const hostCapabilities = options.hostCapabilities ?? DEFAULT_BOOST_HOST_CAPABILITIES;
	const unavailable = <T>(): BoostResult<T> => ({
		ok: false,
		reason: "runtime-unavailable",
	});
	return {
		parse: parseBoostCommand,
		identity: (ctx) =>
			principalIdentity(ctx, identitySource, hostCapabilities),
		authority: {
			reserve: unavailable,
			getStatus: unavailable,
			reset: unavailable,
		},
		notify: (ctx, message, level) => ctx.ui.notify(message, level),
		dispatch: new InertBoostDispatch(),
		hostCapabilities,
		cognitive: createCognitiveHandler(options.runner, options.audit),
	};
}

/** Adapt injected bridge, immutable live-control reference, and cognitive deliberation. */
export function createHostBoostCommandDeps(
	identitySource: BoostIdentitySource,
	injection: LiveBoostHostInjection,
	options: CognitiveBoostDependencies = {},
): BoostCommandDeps {
	const hostCapabilities = options.hostCapabilities ?? DEFAULT_BOOST_HOST_CAPABILITIES;
	return {
		parse: parseBoostCommand,
		identity: (ctx) =>
			principalIdentity(ctx, identitySource, hostCapabilities),
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
						subjectId: identitySource.selfId,
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
		hostCapabilities,
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
		cognitive: createCognitiveHandler(options.runner, options.audit),
	};
}

function principalIdentity(
	ctx: ExtensionCommandContext,
	identitySource: BoostIdentitySource,
	hostCapabilities: BoostHostCapabilities,
): BoostCommandIdentity | undefined {
	const isPrincipal = identitySource.isPrincipalSession();
	const settings = resolveEffectiveBoostSettings(
		ctx.cwd,
		hostCapabilities.isProjectTrusted(ctx.cwd, ctx),
		hostCapabilities.globalSettingsPath,
	);
	const isAgentEnabled = settings.agentSelfBoost.enabled;
	if (!isPrincipal && !isAgentEnabled) {
		return undefined;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	return {
		actor: { kind: isPrincipal ? "principal" : "agent", issuerId: sessionId },
		subject: {
			subjectId: identitySource.selfId,
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
			expiresAt: result.value.expiresAt,
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
