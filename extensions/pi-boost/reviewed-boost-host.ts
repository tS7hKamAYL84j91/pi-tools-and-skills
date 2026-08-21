/** Explicit production host construction boundary for the reviewed boost contract. */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { LiveBoostHostInjection } from "./boost/runtime-adapter.js";
import { createBoostExtension } from "./index.js";
import type { LiveBoostRuntimeBridge } from "./live-boost-bridge-contract.js";
import { EXTERNAL_BOOST_TEAM_ID } from "./external-boost-config-contract.js";

/** @public Source-relative contract identity validated before host construction. */
export interface ReviewedBoostContractIdentity {
	readonly path: typeof REVIEWED_BOOST_CONTRACT_PATH;
	readonly sha256: typeof REVIEWED_BOOST_CONTRACT_SHA256;
}

/** @public Reviewed evidence and capability required to construct the host extension. */
export interface ReviewedBoostHostInput {
	readonly contract: ReviewedBoostContractIdentity;
	readonly injection: LiveBoostHostInjection;
}

/** @public A construction result deliberately omits bridge/provider operational access. */
export interface ReviewedBoostHost {
	readonly contract: ReviewedBoostContractIdentity;
	readonly extension: ExtensionFactory;
	shutdown(): Promise<void>;
}

export const REVIEWED_BOOST_CONTRACT_PATH =
	"extensions/pi-boost/external-boost-config-contract.ts" as const;
export const REVIEWED_BOOST_CONTRACT_SHA256 =
	"b717e239d0e3e188c6764c5c016bbeb0d7c56d0df8bcbdb2a063ce61975bc089" as const;

/** Returns the immutable reviewed identity that a clean-cwd host must attest. */
export function getReviewedBoostContractIdentity(): ReviewedBoostContractIdentity {
	return {
		path: REVIEWED_BOOST_CONTRACT_PATH,
		sha256: REVIEWED_BOOST_CONTRACT_SHA256,
	};
}

/**
 * Constructs only the explicit injected extension after local identity and
 * logical-reference validation. It never invokes the bridge or a provider.
 */
export function createReviewedBoostHost(
	input: ReviewedBoostHostInput,
): ReviewedBoostHost {
	validateReviewedContract(input.contract);
	validateLogicalReference(input.injection);
	validateShutdownChoice(input.injection.shutdownChoice);
	const shutdown = createIdempotentShutdown(input.injection);
	const control = Object.freeze({ ...input.injection.control });
	const injection: LiveBoostHostInjection = {
		...input.injection,
		control,
		bridge: createShutdownWrappedBridge(input.injection.bridge, shutdown),
	};
	return {
		contract: getReviewedBoostContractIdentity(),
		extension: createBoostExtension(injection),
		shutdown,
	};
}

function validateReviewedContract(
	contract: ReviewedBoostContractIdentity,
): void {
	if (
		contract.path !== REVIEWED_BOOST_CONTRACT_PATH ||
		contract.sha256 !== REVIEWED_BOOST_CONTRACT_SHA256
	) {
		throw new Error("Reviewed boost contract identity mismatch");
	}
}

function validateLogicalReference(injection: LiveBoostHostInjection): void {
	const reference = injection.control;
	if (
		reference.teamId !== EXTERNAL_BOOST_TEAM_ID ||
		!isBoundedIdentifier(reference.enablementId)
	) {
		throw new Error("Invalid reviewed boost control reference");
	}
}

function validateShutdownChoice(
	choice: LiveBoostHostInjection["shutdownChoice"],
): void {
	if (choice !== "synchronous-restore" && choice !== "durable-block-marker") {
		throw new Error("Invalid reviewed boost shutdown choice");
	}
}

function createShutdownWrappedBridge(
	bridge: LiveBoostRuntimeBridge,
	shutdown: () => Promise<void>,
): LiveBoostRuntimeBridge {
	return {
		reserve: (input) => bridge.reserve(input),
		dispatch: (input) => bridge.dispatch(input),
		reset: (input) => bridge.reset(input),
		getStatus: (input) => bridge.getStatus(input),
		checkDispatch: (subjectId) => bridge.checkDispatch(subjectId),
		shutdown: async () => shutdown(),
	};
}

function createIdempotentShutdown(
	injection: LiveBoostHostInjection,
): () => Promise<void> {
	let shutdown: Promise<void> | undefined;
	return () => {
		if (shutdown === undefined) {
			shutdown = injection.bridge.shutdown({
				choice: injection.shutdownChoice,
			});
		}
		return shutdown;
	};
}

function isBoundedIdentifier(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
