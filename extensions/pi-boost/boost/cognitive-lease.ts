/** Bounded CognitiveLease execution: single-model (ADR-052 default) or fusion panel+judge dispatch, with audit. */

import { executeFusionLease } from "./cognitive-lease-fusion.js";
import { executeSingleModelLease } from "./cognitive-lease-single.js";
import type {
	CognitiveLeaseExecutionOptions,
	CognitiveLeaseResult,
} from "./cognitive-types.js";

/** Execute the configured lease path: single-model default, fusion panel+judge on explicit opt-in. */
async function executeCognitiveLeaseInternal(
	options: CognitiveLeaseExecutionOptions,
): Promise<CognitiveLeaseResult> {
	return options.single
		? executeSingleModelLease(options)
		: executeFusionLease(options);
}

/** Execute and audit one bounded cognitive lease without retaining prompt or model identities. */
export async function executeCognitiveLease(
	options: CognitiveLeaseExecutionOptions,
): Promise<CognitiveLeaseResult> {
	let result: CognitiveLeaseResult;
	try {
		result = await executeCognitiveLeaseInternal(options);
	} catch (error) {
		await options.audit?.append(auditRecord(options, "failed", 0, 0));
		throw error;
	}
	const panelSize = result.nodes.filter((node) =>
		node.role.startsWith("panel_"),
	).length;
	const outcome = result.ok
		? "completed"
		: result.degraded
			? "degraded"
			: "failed";
	await options.audit?.append(
		auditRecord(options, outcome, panelSize, result.durationMs),
	);
	return result;
}

function auditRecord(
	options: CognitiveLeaseExecutionOptions,
	outcome: "completed" | "degraded" | "failed",
	panelSize: number,
	durationMs: number,
) {
	return {
		timestamp: new Date().toISOString(),
		actor: options.auditActor ?? "principal",
		surface: options.auditSurface ?? "command",
		profile: options.profile ?? "balanced",
		panelSize,
		outcome,
		durationMs,
	} as const;
}