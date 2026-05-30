import { describe, expect, it } from "vitest";
import { observabilityEventsFromRunEvents, serializeObservabilityEvents, TEAM_OBSERVABILITY_SCHEMA_VERSION } from "../extensions/pi-panopticon/teams/observability.js";
import type { TeamRunEvent } from "../extensions/pi-panopticon/teams/state.js";

function event(overrides: Partial<TeamRunEvent> & { kind: TeamRunEvent["kind"] }): TeamRunEvent {
	return {
		schemaVersion: 1,
		runId: "run-1",
		seq: 1,
		timestamp: 1_700_000_000_000,
		orchestratorPid: 123,
		...overrides,
	} as TeamRunEvent;
}

describe("team observability primitives", () => {
	it("maps run lifecycle events with required fields and timing", () => {
		const events = observabilityEventsFromRunEvents([
			event({ kind: "run_started", teamId: "navigator", protocol: "consult", input: { prompt: "review" } }),
			event({ kind: "run_completed", ok: true, durationMs: 42, summary: "done" }),
		]);

		expect(events).toEqual([
			expect.objectContaining({ schemaVersion: TEAM_OBSERVABILITY_SCHEMA_VERSION, kind: "run_started", runId: "run-1", teamId: "navigator", protocol: "consult", status: "running", timestamp: 1_700_000_000_000 }),
			expect.objectContaining({ kind: "run_completed", ok: true, status: "completed", durationMs: 42, message: "done" }),
		]);
	});

	it("keeps fallback, handoff, and artifact detail compatibility", () => {
		const events = observabilityEventsFromRunEvents([
			event({ kind: "run_detail", detailKind: "fallback", phaseId: "debate", nodeId: "synthesis", message: "fallback", data: { model: "m1" } }),
			event({ kind: "run_detail", detailKind: "handoff", phaseId: "debate", nodeId: "synthesis", message: "handoff" }),
			event({ kind: "run_detail", detailKind: "artifact", message: "artifact", artifactUri: "session://team/run/artifact" }),
		]);

		expect(events).toEqual([
			expect.objectContaining({ kind: "fallback", phaseId: "debate", nodeId: "synthesis", data: { model: "m1" } }),
			expect.objectContaining({ kind: "handoff", phaseId: "debate", nodeId: "synthesis" }),
			expect.objectContaining({ kind: "artifact", artifactUri: "session://team/run/artifact" }),
		]);
	});

	it("pins additive observability detail field projection", () => {
		const [projected] = observabilityEventsFromRunEvents([
			event({
				kind: "run_detail",
				detailKind: "trace",
				phaseId: "phase",
				nodeId: "node",
				message: "trace message",
				artifactUri: "session://team/run/artifact",
				error: "warning",
				data: { extra: true },
			}),
		]);

		expect(projected ? Object.keys(projected).sort() : []).toEqual([
			"artifactUri",
			"data",
			"error",
			"kind",
			"message",
			"nodeId",
			"phaseId",
			"runId",
			"schemaVersion",
			"timestamp",
		]);
		expect(projected).toMatchObject({
			schemaVersion: TEAM_OBSERVABILITY_SCHEMA_VERSION,
			kind: "trace",
			runId: "run-1",
			phaseId: "phase",
			nodeId: "node",
			artifactUri: "session://team/run/artifact",
			error: "warning",
			data: { extra: true },
		});
	});

	it("represents approval-required and approval-result gates", () => {
		const events = observabilityEventsFromRunEvents([
			event({ kind: "run_detail", detailKind: "trace", message: "human approval required", data: { approval: "required", gate: "deploy" } }),
			event({ kind: "run_detail", detailKind: "trace", message: "approved", data: { approval: "approved", gate: "deploy" } }),
			event({ kind: "run_stopped", reason: "approval required", durationMs: 7 }),
		]);

		expect(events).toEqual([
			expect.objectContaining({ kind: "approval_required", status: "requires_approval", ok: false, data: { approval: "required", gate: "deploy" } }),
			expect.objectContaining({ kind: "approval_result", ok: true }),
			expect.objectContaining({ kind: "run_stopped", status: "requires_approval", durationMs: 7 }),
		]);
	});

	it("captures node errors and failed final outcomes", () => {
		const events = observabilityEventsFromRunEvents([
			event({ kind: "node_completed", phaseId: "consult", nodeId: "navigator", role: "navigator", model: "m", ok: false, durationMs: 5, outputChars: 0, outputSha256: "abc", outputTruncated: false, error: "timeout" }),
			event({ kind: "run_failed", ok: false, error: "timeout" }),
		]);

		expect(events).toEqual([
			expect.objectContaining({ kind: "error", phaseId: "consult", nodeId: "navigator", ok: false, error: "timeout" }),
			expect.objectContaining({ kind: "run_failed", status: "failed", ok: false, error: "timeout" }),
		]);
	});

	it("rejects invalid serialized observability events", () => {
		expect(() => serializeObservabilityEvents([{ schemaVersion: 999, kind: "trace", runId: "r", timestamp: 1, message: "bad" } as never])).toThrow(/schemaVersion/);
		expect(() => serializeObservabilityEvents([{ schemaVersion: 1, kind: "trace", runId: "", timestamp: Number.NaN, message: "" } as never])).toThrow(/invalid/);
	});
});
