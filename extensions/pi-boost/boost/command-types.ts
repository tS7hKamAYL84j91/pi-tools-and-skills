/** `/boost` command dependency contract types and the inert dispatch boundary. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BoostHostCapabilities } from "./host-capabilities.js";
import type {
	BoostFusionRequest,
	CognitiveLeaseResult,
} from "./cognitive-types.js";
import type { BoostParseResult } from "./boost-parse-types.js";
import type {
	BoostActor,
	BoostLeaseStatus,
	BoostResult,
	BoostSubject,
	ReserveBoostInput,
	ResetBoostInput,
} from "./contracts.js";

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
	readonly environmentalBridgeAvailable?: boolean;
	readonly hostCapabilities?: BoostHostCapabilities;
	readonly cognitive?: (
		input: BoostFusionRequest,
		ctx: ExtensionCommandContext,
	) => Promise<CognitiveLeaseResult>;
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
