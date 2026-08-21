import { describe, expect, it } from "vitest";
import { classifyCheckpointReadiness, type CheckpointReadinessInput } from "../../extensions/pi-teams/checkpoint-readiness.js";
import type { TeamRunRecord } from "../../extensions/pi-teams/types.js";

function runRecord(overrides: Partial<TeamRunRecord> = {}): TeamRunRecord {
	return {
		version: 1,
		id: "run-1",
		team: "navigator",
		protocol: "consult",
		prompt: "Summarize the synthetic fixture.",
		status: "running",
		startedAt: 1,
		orchestratorPid: 123,
		phases: ["review"],
		nodes: [],
		details: [],
		...overrides,
	};
}

function input(overrides: Partial<CheckpointReadinessInput["checkpoint"]> = {}, run = runRecord()): CheckpointReadinessInput {
	return {
		run,
		checkpoint: {
			schemaVersion: 1,
			checkpointId: "checkpoint-1",
			runId: run.id,
			teamId: run.team,
			protocol: run.protocol,
			boundary: "after_node",
			source: {
				artifactUri: "session://team-runs/run-1/checkpoints/checkpoint-1",
				lastEventSeq: 4,
				runEventHash: "sha256:abc123",
			},
			lineage: {
				parentSessionRef: "session://parent/session-1",
			},
			handoff: {
				summary: "bounded synthetic handoff",
				assumptions: ["synthetic only"],
				openQuestions: ["none"],
			},
			artifacts: [{ uri: "session://team-runs/run-1/checkpoints/checkpoint-1", hash: "sha256:def456", byteSize: 512, mediaType: "application/json", redaction: "redacted-local" }],
			approvals: [],
			...overrides,
		},
	};
}

describe("checkpoint readiness classifier", () => {
	it("classifies complete synthetic checkpoint metadata as resumable", () => {
		const result = classifyCheckpointReadiness(input());

		expect(result).toEqual({ status: "resumable", reasons: [], warnings: [] });
	});

	it("fails closed when claim-check metadata or lineage is incomplete", () => {
		const result = classifyCheckpointReadiness(input({
			source: { artifactUri: "file:///tmp/checkpoint.json", lastEventSeq: -1 },
			lineage: {},
			handoff: {},
		}));

		expect(result.status).toBe("requires_manual_review");
		expect(result.reasons).toEqual(expect.arrayContaining([
			"missing valid session checkpoint artifact URI",
			"missing valid source event cursor",
			"missing source run event hash",
			"missing parent session lineage claim-check",
			"missing bounded handoff assumptions or open questions",
		]));
	});

	it("requires approval when approval is pending or does not cover the checkpoint", () => {
		const result = classifyCheckpointReadiness(input({ approvals: [{ status: "approved", gateId: "gate-1", coversCheckpoint: false }] }));

		expect(result.status).toBe("requires_approval");
		expect(result.reasons).toEqual(["checkpoint approval is pending or does not cover checkpoint"]);
	});

	it("requires manual review for rejected or expired approvals", () => {
		const result = classifyCheckpointReadiness(input({ approvals: [{ status: "expired", gateId: "gate-1", coversCheckpoint: true }] }));

		expect(result.status).toBe("requires_manual_review");
		expect(result.reasons).toEqual(["checkpoint approval is missing, expired, or rejected"]);
	});

	it("does not resume completed terminal runs", () => {
		const run = runRecord({ status: "completed", completedAt: 2 });
		const result = classifyCheckpointReadiness(input({}, run));

		expect(result.status).toBe("not_resumable");
		expect(result.reasons).toEqual(["completed run is terminal"]);
		expect(result.warnings).toContain("terminal completed run should normally seed a new run, not resume automatically");
	});

	it("rejects unsafe mid-node checkpoints", () => {
		const result = classifyCheckpointReadiness(input({ boundary: "mid_node" }));

		expect(result.status).toBe("requires_manual_review");
		expect(result.reasons).toContain("checkpoint was not taken at a safe boundary");
	});
});
