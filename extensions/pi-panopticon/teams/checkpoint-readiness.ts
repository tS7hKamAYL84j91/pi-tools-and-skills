/** Pure readiness classifier for future pi-teams checkpoint claim-checks. */

import type { TeamRunRecord } from "./types.js";

type CheckpointReadinessStatus = "resumable" | "requires_approval" | "requires_manual_review" | "not_resumable";

export interface CheckpointArtifactRef {
	uri: string;
	hash?: string;
	byteSize?: number;
	mediaType?: string;
	redaction?: string;
}

export interface CheckpointApprovalState {
	status: "approved" | "pending" | "rejected" | "expired" | "missing";
	gateId?: string;
	coversCheckpoint?: boolean;
}

export interface CheckpointReadinessInput {
	run: TeamRunRecord;
	checkpoint: {
		schemaVersion: number;
		checkpointId: string;
		runId: string;
		teamId: string;
		protocol?: string;
		boundary: "before_phase" | "after_node" | "awaiting_approval" | "stopped" | "failed" | "completed" | "mid_node";
		source?: {
			artifactUri?: string;
			lastEventSeq?: number;
			runEventHash?: string;
		};
		lineage?: {
			parentSessionRef?: string;
			parentRunId?: string;
			parentCheckpointId?: string;
		};
		handoff?: {
			summary?: string;
			assumptions?: string[];
			openQuestions?: string[];
		};
		artifacts?: CheckpointArtifactRef[];
		approvals?: CheckpointApprovalState[];
	};
}

interface CheckpointReadinessResult {
	status: CheckpointReadinessStatus;
	reasons: string[];
	warnings: string[];
}

const CHECKPOINT_SCHEMA_VERSION = 1;
const ALLOWED_BOUNDARIES = new Set<CheckpointReadinessInput["checkpoint"]["boundary"]>(["before_phase", "after_node", "awaiting_approval", "stopped", "failed", "completed"]);

function isSessionCheckpointUri(value: string | undefined): boolean {
	return /^session:\/\/team-runs\/[^/]+\/checkpoints\/[^/]+$/.test(value ?? "");
}

function hasValidArtifactRef(ref: CheckpointArtifactRef): boolean {
	return isSessionCheckpointUri(ref.uri) && !!ref.hash && typeof ref.byteSize === "number" && ref.byteSize >= 0 && !!ref.redaction;
}

function hasHandoffContext(input: CheckpointReadinessInput): boolean {
	const handoff = input.checkpoint.handoff;
	return !!handoff?.summary || (handoff?.assumptions?.length ?? 0) > 0 || (handoff?.openQuestions?.length ?? 0) > 0;
}

function approvalStatus(approvals: readonly CheckpointApprovalState[] | undefined): CheckpointReadinessStatus | undefined {
	if (!approvals || approvals.length === 0) {
		return undefined;
	}
	if (approvals.some((approval) => approval.status === "rejected" || approval.status === "expired" || approval.status === "missing")) {
		return "requires_manual_review";
	}
	if (approvals.some((approval) => approval.status === "pending" || !approval.coversCheckpoint)) {
		return "requires_approval";
	}
	return undefined;
}

/** Classify synthetic checkpoint metadata without reading or mutating artifacts. */
export function classifyCheckpointReadiness(input: CheckpointReadinessInput): CheckpointReadinessResult {
	const reasons: string[] = [];
	const warnings: string[] = [];
	const { checkpoint, run } = input;

	if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
		reasons.push("unsupported checkpoint schemaVersion");
	}
	if (checkpoint.runId !== run.id) {
		reasons.push("checkpoint runId does not match run record");
	}
	if (checkpoint.teamId !== run.team) {
		reasons.push("checkpoint teamId does not match run record");
	}
	if (!isSessionCheckpointUri(checkpoint.source?.artifactUri)) {
		reasons.push("missing valid session checkpoint artifact URI");
	}
	if (typeof checkpoint.source?.lastEventSeq !== "number" || checkpoint.source.lastEventSeq < 0) {
		reasons.push("missing valid source event cursor");
	}
	if (!checkpoint.source?.runEventHash) {
		reasons.push("missing source run event hash");
	}
	if (!checkpoint.lineage?.parentSessionRef) {
		reasons.push("missing parent session lineage claim-check");
	}
	if (!ALLOWED_BOUNDARIES.has(checkpoint.boundary)) {
		reasons.push("checkpoint was not taken at a safe boundary");
	}
	if (!hasHandoffContext(input)) {
		reasons.push("missing bounded handoff assumptions or open questions");
	}
	for (const ref of checkpoint.artifacts ?? []) {
		if (!hasValidArtifactRef(ref)) {
			reasons.push(`invalid artifact reference: ${ref.uri}`);
		}
	}

	if (run.status === "completed") {
		warnings.push("terminal completed run should normally seed a new run, not resume automatically");
	}
	if (run.status === "failed" || run.status === "stopped") {
		warnings.push("terminal non-success run requires explicit operator intent before future resume");
	}

	if (reasons.length > 0) {
		return { status: "requires_manual_review", reasons, warnings };
	}

	const approval = approvalStatus(checkpoint.approvals);
	if (approval) {
		return { status: approval, reasons: approval === "requires_approval" ? ["checkpoint approval is pending or does not cover checkpoint"] : ["checkpoint approval is missing, expired, or rejected"], warnings };
	}

	if (run.status === "completed") {
		return { status: "not_resumable", reasons: ["completed run is terminal"], warnings };
	}

	return { status: "resumable", reasons: [], warnings };
}
