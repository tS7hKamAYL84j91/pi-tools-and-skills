/** Fail-closed policy helpers for the inert boost lease authority. */

import type {
	ActivateBoostInput,
	BoostDenialReason,
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostModelIdentity,
	ReserveBoostInput,
} from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";
import { combineBoostInput, isValidBoostRequest } from "./parser.js";

interface ActivationValidation {
	readonly reason: BoostDenialReason;
	readonly category?: BoostFailureCategory;
}

interface ResolvedBoostModels {
	readonly baseline: BoostModelIdentity;
	readonly lease: BoostModelIdentity;
}

export function resolveBoostModels(
	dependencies: BoostLeaseDependencies,
): ResolvedBoostModels | undefined {
	try {
		const baseline = dependencies.models.resolve("principalBoostBaseline");
		const lease = dependencies.models.resolve("principalBoostLease");
		if (
			!isRequiredModel(baseline, "glm-5.2") ||
			!isRequiredModel(lease, "sol-ultra")
		) {
			return undefined;
		}
		return { baseline, lease };
	} catch {
		return undefined;
	}
}

export function validateActivationPrerequisites(
	dependencies: BoostLeaseDependencies,
	owner: symbol,
	input: ActivateBoostInput,
	lease: BoostLeaseRecord | undefined,
): ActivationValidation | undefined {
	if (!lease || lease.leaseId !== input.leaseId) {
		return { reason: "lease-not-found" };
	}
	if (lease.state === "RevertFailed") {
		return { reason: "revert-failed" };
	}
	if (lease.state !== "Reserved") {
		return { reason: "lease-not-active" };
	}
	if (input.actor.kind !== "principal") {
		return { reason: "unauthorized", category: "authorization-denied" };
	}
	if (lease.issuerId !== input.actor.issuerId) {
		return { reason: "issuer-mismatch", category: "issuer-mismatch" };
	}
	if (!dependencies.slot.isOwnedBy(owner)) {
		return { reason: "slot-occupied", category: "slot-occupied" };
	}
	if (lease.consumedYields >= lease.requestedYields) {
		return { reason: "budget-exhausted", category: "invalid-request" };
	}
	return undefined;
}

export function buildActivationInput(
	lease: BoostLeaseRecord,
	prompt: string | undefined,
): string | undefined {
	if (prompt === undefined) {
		return lease.pendingCombinedInput;
	}
	const candidate = {
		requestedYields: 1,
		isolation: lease.isolation,
		prompt,
		combinedInput: combineBoostInput(prompt),
	};
	return isValidBoostRequest(candidate) ? candidate.combinedInput : undefined;
}

export function classifyBoostInput(
	dependencies: BoostLeaseDependencies,
	combinedInput: string,
): "governance-private" | "governance-denied" | undefined {
	try {
		const decision = dependencies.governance.classify(combinedInput);
		return decision === "public"
			? undefined
			: decision === "private" || decision === "local-only"
				? "governance-private"
				: "governance-denied";
	} catch {
		return "governance-denied";
	}
}

export function revalidateBoostWorkspace(
	dependencies: BoostLeaseDependencies,
	lease: BoostLeaseRecord,
): boolean {
	try {
		return dependencies.workspace.revalidate(lease.subjectId, lease.workspace);
	} catch {
		return false;
	}
}

export function isValidReserveIdentity(input: ReserveBoostInput): boolean {
	return (
		input.subject.subjectId.length > 0 &&
		input.subject.workspace.workspaceId.length > 0 &&
		input.subject.workspace.root.length > 0
	);
}

function isRequiredModel(
	model: BoostModelIdentity | undefined,
	family: string,
): model is BoostModelIdentity {
	return (
		model?.registered === true &&
		model.family === family &&
		model.id.length > 0 &&
		model.provider.length > 0
	);
}
