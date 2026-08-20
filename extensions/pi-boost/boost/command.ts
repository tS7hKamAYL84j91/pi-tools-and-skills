/** Inert `/boost` command registration and bounded feedback. */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type {
	BoostActor,
	BoostDenialReason,
	BoostLeaseStatus,
	BoostResult,
	BoostSubject,
	ReserveBoostInput,
	ResetBoostInput,
} from "./contracts.js";
import type { BoostParseErrorCode, BoostParseResult } from "./parser.js";

type BoostNotificationLevel = "info" | "warning" | "error";

export interface BoostCommandIdentity {
	readonly actor: BoostActor;
	readonly subject: BoostSubject;
}

type MaybePromise<T> = T | Promise<T>;

interface BoostCommandAuthority {
	reserve(
		input: ReserveBoostInput,
	): MaybePromise<BoostResult<BoostLeaseStatus>>;
	getStatus(actor: BoostActor): MaybePromise<BoostResult<BoostLeaseStatus>>;
	reset(input: ResetBoostInput): MaybePromise<BoostResult<BoostLeaseStatus>>;
}

export type BoostCommandDispatchDecision =
	| { readonly dispatched: false; readonly kind: "reserved" }
	| {
			readonly dispatched: false;
			readonly kind: "denied";
			readonly reason: string;
	  }
	| {
			readonly dispatched: true;
			readonly kind: "terminal";
			readonly outcome: string;
	  };

interface BoostCommandDispatch {
	recordReservation(
		status: BoostLeaseStatus,
		input: ReserveBoostInput,
	): MaybePromise<BoostCommandDispatchDecision>;
}

/** @public Explicit dependencies isolate the command from runtime capabilities. */
export interface BoostCommandDeps {
	readonly parse: (input: string) => BoostParseResult;
	readonly identity: (
		ctx: ExtensionCommandContext,
	) => BoostCommandIdentity | undefined;
	readonly authority: BoostCommandAuthority;
	readonly notify: (
		ctx: ExtensionCommandContext,
		message: string,
		level: BoostNotificationLevel,
	) => void;
	readonly dispatch: BoostCommandDispatch;
}

/** Stateless phase-2 boundary: records the reservation decision without dispatch. */
export class InertBoostDispatch implements BoostCommandDispatch {
	recordReservation(
		_status: BoostLeaseStatus,
		_input?: ReserveBoostInput,
	): BoostCommandDispatchDecision {
		return { dispatched: false, kind: "reserved" };
	}
}

/** Register the Principal-only, reservation-only `/boost` command. */
export function registerBoostCommand(
	pi: ExtensionAPI,
	deps: BoostCommandDeps,
): void {
	pi.registerCommand("boost", {
		description: "Request, inspect, or reset a host-controlled boost lease",
		handler: async (args, ctx) => {
			const parsed = deps.parse(commandInput(args));
			if (!parsed.ok) {
				deps.notify(ctx, parseFeedback(parsed.error.code), "warning");
				return;
			}
			const identity = deps.identity(ctx);
			if (!identity || identity.actor.kind !== "principal") {
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
				case "request": {
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
							`Boost denied: ${boundedReason(dispatch.reason)}`,
							"warning",
						);
						return;
					}
					if (dispatch.kind === "terminal") {
						deps.notify(
							ctx,
							`Boost completed: outcome=${boundedReason(dispatch.outcome)}`,
							"info",
						);
						return;
					}
					deps.notify(
						ctx,
						formatStatus("Boost reserved (inert)", result.value),
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
	deps.notify(ctx, formatStatus(label, result.value), "info");
}

function notifyDenial(
	ctx: ExtensionCommandContext,
	deps: BoostCommandDeps,
	reason: BoostDenialReason,
): void {
	deps.notify(ctx, `Boost denied: ${denialLabel(reason)}`, "warning");
}

function formatStatus(label: string, status: BoostLeaseStatus): string {
	const fields = [`state=${status.state}`];
	if (status.leaseId !== undefined) {
		fields.push(`id=${opaqueId(status.leaseId)}`);
	}
	if (
		status.remainingYields !== undefined &&
		Number.isSafeInteger(status.remainingYields) &&
		status.remainingYields >= 0
	) {
		fields.push(`remaining=${status.remainingYields}`);
	}
	if (status.expiresAt !== undefined && Number.isFinite(status.expiresAt)) {
		fields.push(`expiresAt=${status.expiresAt}`);
	}
	return `${label}: ${fields.join(" ")}`;
}

function opaqueId(value: string): string {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "redacted";
}

function denialLabel(reason: BoostDenialReason): string {
	return reason.replaceAll("-", " ");
}

function boundedReason(reason: string): string {
	return /^[a-z-]{1,32}$/.test(reason)
		? reason.replaceAll("-", " ")
		: "unavailable";
}

function parseFeedback(code: BoostParseErrorCode): string {
	switch (code) {
		case "invalid-yield-count":
			return "Boost option error: -n must be 1, 2, or 3";
		case "repeated-option":
			return "Boost option error: options may be specified only once";
		case "conflicting-isolation":
			return "Boost option error: --clean and --fresh are mutually exclusive";
		case "unknown-option":
			return "Boost option error: unknown option";
		case "trailing-subcommand":
			return "Boost syntax error: status/reset accept no trailing text; use -- for a prompt";
		case "input-too-large":
			return "Boost request rejected: input exceeds 2,048 UTF-8 bytes";
		case "not-boost-command":
		case "missing-prompt":
			return "Usage: /boost status | reset | [-n 1..3] [--clean|--fresh] [--] <prompt>";
	}
}
