/**
 * Adversarial acceptance: approval-inbox lifecycle semantics.
 *
 * Pins the decision the owner took after D7: a **deferred** approval means "not
 * now" and stays decidable, while `rejected` and `completed` are final and an
 * `approved` artifact cannot be withdrawn (resume is the only path that executes
 * a parked run). Deferred also stays pending and counted, and never expires, so a
 * future refactor cannot re-freeze it without turning something red here.
 *
 * These assertions are deliberately behavioural: they go through the same
 * exported API the Agent Hub overlay and Automations both call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	approveAgentApproval,
	deferAgentApproval,
	isPendingApproval,
	readApprovalArtifact,
	rejectAgentApproval,
	resumeAgentApproval,
	writeApprovalArtifact,
	type ApprovalArtifact,
	type ApprovalStatus,
} from "../../lib/automations-approval-inbox.js";
import { loadRunState, saveRunState } from "../../lib/automations-run-state.js";
import {
	countAwaitingApprovals,
	listApprovalArtifacts,
} from "../../extensions/pi-automations/approval-inbox.js";
import type { AutomationsConfig } from "../../lib/automations-types.js";

const home = mkdtempSync(join(tmpdir(), "adv-approvals-"));
const config = { automationsHome: home } as unknown as AutomationsConfig;
const previousPrincipal = process.env.PI_PRINCIPAL;

afterAll(() => {
	rmSync(home, { recursive: true, force: true });
	if (previousPrincipal === undefined) delete process.env.PI_PRINCIPAL;
	else process.env.PI_PRINCIPAL = previousPrincipal;
});

beforeEach(() => {
	process.env.PI_PRINCIPAL = "1";
});
afterEach(() => {
	vi.restoreAllMocks();
});

function artifact(requestId: string, overrides: Partial<ApprovalArtifact> = {}): ApprovalArtifact {
	const now = new Date().toISOString();
	return {
		version: 1,
		requestId,
		taskId: `task-${requestId}`,
		runId: `run-${requestId}`,
		claimToken: "0123456789abcdef0123",
		status: "awaiting-approval",
		prompt: `prompt for ${requestId}`,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

async function seed(status: ApprovalStatus = "awaiting-approval", requestId = "req-1"): Promise<string> {
	await writeApprovalArtifact(config, artifact(requestId, { status }));
	return requestId;
}

describe("approval lifecycle acceptance", () => {
	it("treats defer as 'not now': it stays pending, counted, and can still be approved", async () => {
		const requestId = await seed();

		const deferred = await deferAgentApproval(config, requestId);
		expect(deferred).toEqual({ requestId, status: "deferred", changed: true });
		expect(isPendingApproval(deferred.status)).toBe(true);
		expect(await countAwaitingApprovals(config)).toBe(1);

		const approved = await approveAgentApproval(config, requestId);
		expect(approved).toEqual({ requestId, status: "approved", changed: true });
		expect(isPendingApproval(approved.status)).toBe(false);
		expect(await countAwaitingApprovals(config)).toBe(0);
	});

	it("reports an honest no-op when deferring twice, without rewriting the artifact", async () => {
		const requestId = await seed();
		await deferAgentApproval(config, requestId);
		const first = await readApprovalArtifact(config, requestId);

		const again = await deferAgentApproval(config, requestId);
		const second = await readApprovalArtifact(config, requestId);

		expect(again).toEqual({ requestId, status: "deferred", changed: false });
		expect(second?.updatedAt).toBe(first?.updatedAt);
		expect(await countAwaitingApprovals(config)).toBe(1);
	});

	it("keeps rejected final", async () => {
		const requestId = await seed();
		expect((await rejectAgentApproval(config, requestId)).status).toBe("rejected");
		const rejectedAt = (await readApprovalArtifact(config, requestId))?.updatedAt;

		for (const decide of [approveAgentApproval, deferAgentApproval, rejectAgentApproval]) {
			const outcome = await decide(config, requestId);
			expect(outcome).toEqual({ requestId, status: "rejected", changed: false });
		}
		expect((await readApprovalArtifact(config, requestId))?.updatedAt).toBe(rejectedAt);
		expect(await countAwaitingApprovals(config)).toBe(0);
	});

	it("does not let an approval be withdrawn", async () => {
		const requestId = await seed();
		expect((await approveAgentApproval(config, requestId)).changed).toBe(true);

		for (const decide of [rejectAgentApproval, deferAgentApproval]) {
			expect(await decide(config, requestId)).toEqual({ requestId, status: "approved", changed: false });
		}
		expect((await readApprovalArtifact(config, requestId))?.status).toBe("approved");
	});

	it("keeps completed final once the run has finished", async () => {
		const requestId = await seed("completed");
		expect(await approveAgentApproval(config, requestId)).toEqual({
			requestId,
			status: "completed",
			changed: false,
		});
		expect((await readApprovalArtifact(config, requestId))?.status).toBe("completed");
	});

	it("refuses to resume a deferred approval, and resumes once after approval", async () => {
		const requestId = await seed("deferred", "req-resume");
		const now = new Date().toISOString();
		await saveRunState(config, "task-req-resume", {
			taskId: "task-req-resume",
			runId: "run-req-resume",
			requestId: "req-resume",
			status: "awaiting-approval",
			startedAt: now,
			lastUpdatedAt: now,
		});

		const pi = { sendUserMessage: vi.fn() } as unknown as ExtensionAPI;
		expect(await resumeAgentApproval(pi, config, requestId)).toBe(false);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect((await loadRunState(config, "task-req-resume"))?.status).toBe("awaiting-approval");

		await approveAgentApproval(config, requestId);
		expect(await resumeAgentApproval(pi, config, requestId)).toBe(true);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect((await loadRunState(config, "task-req-resume"))?.status).toBe("running");
	});

	it("never expires a deferred artifact, while stale terminal artifacts are pruned", async () => {
		const stale = new Date(Date.now() - 400 * 86_400_000).toISOString();
		await writeApprovalArtifact(config, artifact("req-old-deferred", { status: "deferred", updatedAt: stale }));
		await writeApprovalArtifact(config, artifact("req-old-rejected", { status: "rejected", updatedAt: stale }));

		const firstListing = (await listApprovalArtifacts(config)).map((item) => item.requestId);
		expect(firstListing).toContain("req-old-deferred");

		// The listing prunes as a side effect. A stale terminal artifact is deleted,
		// while a deferred one is never treated as terminal. The same call may still
		// return a row it just deleted (retention keeps the newest N regardless of
		// age before expiring by age); the durable property is checked after the call.
		expect(await readApprovalArtifact(config, "req-old-rejected")).toBeUndefined();
		expect((await listApprovalArtifacts(config)).map((item) => item.requestId)).not.toContain("req-old-rejected");

		// Retention must not have deleted the deferred artifact either: still decidable.
		expect((await readApprovalArtifact(config, "req-old-deferred"))?.status).toBe("deferred");
		expect((await approveAgentApproval(config, "req-old-deferred")).changed).toBe(true);
	});
});
