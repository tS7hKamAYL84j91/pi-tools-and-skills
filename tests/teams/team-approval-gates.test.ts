import { describe, expect, it, vi } from "vitest";
import { executeAfterApproval, requestTeamApproval, resolveTeamApproval, type TeamApprovalRequest } from "../../extensions/pi-panopticon/teams/approval-gates.js";
import { observabilityEventsFromRunEvents } from "../../extensions/pi-panopticon/teams/observability.js";
import { TEAM_RUN_CUSTOM_TYPE, TeamStateManager, type TeamRunEvent } from "../../extensions/pi-panopticon/teams/state.js";

interface CustomEntry {
	type: "custom";
	customType: string;
	data?: unknown;
}

function setup() {
	const entries: CustomEntry[] = [];
	const state = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
	const runId = state.startRun({ teamId: "oracle", protocol: "consult", prompt: "delete production?" });
	state.rehydrateFromSession({ getBranch: () => entries });
	const request: TeamApprovalRequest = {
		schemaVersion: 1,
		gateId: "gate-1",
		runId,
		teamId: "oracle",
		phaseId: "oracle_review",
		nodeId: "mutating_tool",
		action: "run mutating deployment command",
		risk: "critical",
		owner: "principal",
		source: "human",
		reason: "mutates production state",
	};
	return { entries, state, runId, request };
}

function events(entries: CustomEntry[]): TeamRunEvent[] {
	return entries.filter((entry) => entry.customType === TEAM_RUN_CUSTOM_TYPE).map((entry) => entry.data as TeamRunEvent);
}

describe("team approval gates", () => {
	it("missing approval stops continuation and is observable", async () => {
		const { entries, state, request } = setup();
		const gate = requestTeamApproval(state, request);
		const action = vi.fn(async () => "executed");

		const result = await executeAfterApproval(state, gate, action);

		expect(result).toBeUndefined();
		expect(action).not.toHaveBeenCalled();
		expect(state.get(request.runId)?.status).toBe("stopped");
		expect(observabilityEventsFromRunEvents(events(entries))).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: "approval_required", status: "requires_approval", phaseId: "oracle_review", nodeId: "mutating_tool" }),
			expect.objectContaining({ kind: "run_stopped", status: "requires_approval" }),
		]));
	});

	it("approved continuation can proceed", async () => {
		const { state, request } = setup();
		const gate = requestTeamApproval(state, request);
		const approved = resolveTeamApproval(state, gate, { schemaVersion: 1, gateId: "gate-1", runId: request.runId, status: "approved", decidedBy: "principal", decidedAt: 1 });
		const action = vi.fn(async () => "executed");

		await expect(executeAfterApproval(state, approved, action)).resolves.toBe("executed");
		expect(action).toHaveBeenCalledOnce();
	});

	it("rejection produces no downstream action and emits approval result", async () => {
		const { entries, state, request } = setup();
		const gate = requestTeamApproval(state, request);
		const rejected = resolveTeamApproval(state, gate, { schemaVersion: 1, gateId: "gate-1", runId: request.runId, status: "rejected", decidedBy: "principal", decidedAt: 1, reason: "too risky" });
		const action = vi.fn(async () => "executed");

		const result = await executeAfterApproval(state, rejected, action);

		expect(result).toBeUndefined();
		expect(action).not.toHaveBeenCalled();
		expect(observabilityEventsFromRunEvents(events(entries))).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: "approval_result", ok: false, data: expect.objectContaining({ approval: "rejected", reason: "too risky" }) }),
		]));
	});

	it("expired approval cannot proceed", async () => {
		const { state, request } = setup();
		const gate = requestTeamApproval(state, { ...request, expiresAt: 10 });
		const approved = resolveTeamApproval(state, gate, { schemaVersion: 1, gateId: "gate-1", runId: request.runId, status: "approved", decidedBy: "principal", decidedAt: 1 });
		const action = vi.fn(async () => "executed");

		const result = await executeAfterApproval(state, approved, action, 11);

		expect(result).toBeUndefined();
		expect(action).not.toHaveBeenCalled();
	});

	it("rejects invalid or ambiguous approval records", () => {
		const { state, request } = setup();
		expect(() => requestTeamApproval(state, { ...request, gateId: "" })).toThrow(/required/);
		const gate = requestTeamApproval(state, request);
		expect(() => resolveTeamApproval(state, gate, { schemaVersion: 1, gateId: "other", runId: request.runId, status: "approved", decidedBy: "principal", decidedAt: 1 })).toThrow(/does not match/);
	});
});
