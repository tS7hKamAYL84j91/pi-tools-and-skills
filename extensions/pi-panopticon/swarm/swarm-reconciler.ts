/** Completion-signal reconciliation with bounded, provenance-aware repair. */

import { parseCompletionSignal } from "../../../lib/completion-signal.js";
import { runSwarmGates } from "./swarm-gates.js";
import type {
	SwarmArtifact,
	SwarmGateResult,
	SwarmPlan,
	SwarmReviewAdapter,
	SwarmTask,
} from "./swarm-types.js";

const MAX_REPAIR_CYCLES = 3;

interface SwarmReconcileResult {
	accepted: boolean;
	task?: SwarmTask;
	gate?: SwarmGateResult;
	reason: string;
}

function evidenceKey(artifacts: SwarmArtifact[]): string {
	return JSON.stringify(
		artifacts.map((artifact) => ({
			path: artifact.path,
			command: artifact.command,
			evidence: artifact.evidence,
		})),
	);
}

function block(task: SwarmTask, reason: string): SwarmReconcileResult {
	task.state = "blocked";
	return { accepted: true, task, reason };
}

/** Applies DONE/BLOCKED once; retries require review and fresh artifact provenance. */
export async function reconcileCompletion(
	plan: SwarmPlan,
	message: string,
	artifacts: SwarmArtifact[],
	reviewer: SwarmReviewAdapter,
): Promise<SwarmReconcileResult> {
	const signal = parseCompletionSignal(message);
	if (!signal) return { accepted: false, reason: "No valid completion signal." };
	const task = plan.tasks.find((candidate) => candidate.id === signal.taskId);
	if (!task) return { accepted: false, reason: `Unknown task '${signal.taskId}'.` };
	if (task.state !== "in_progress") {
		return { accepted: false, task, reason: `Task '${task.id}' is not in progress.` };
	}
	if (signal.status !== "done") {
		return block(task, signal.reason ?? signal.summary);
	}
	const provenance = evidenceKey(artifacts);
	if (task.lastEvidence === provenance) {
		return block(task, "Repair reused stale artifact provenance.");
	}
	task.artifacts = artifacts;
	task.lastEvidence = provenance;
	const gate = await runSwarmGates(task, reviewer);
	if (gate.verdict === "pass") {
		task.state = "done";
		return { accepted: true, task, gate, reason: gate.reason };
	}
	if (gate.verdict === "blocked") {
		task.state = "blocked";
		return { accepted: true, task, gate, reason: gate.reason };
	}
	task.repairCycles += 1;
	if (task.repairCycles > MAX_REPAIR_CYCLES) {
		task.state = "blocked";
		return { accepted: true, task, gate, reason: "Maximum repair cycles exceeded." };
	}
	task.state = "pending";
	return { accepted: true, task, gate, reason: gate.reason };
}
