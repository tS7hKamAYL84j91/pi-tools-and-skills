import { describe, expect, it, vi } from "vitest";
import type {
	BoostActor,
	BoostSubject,
} from "../../extensions/pi-panopticon/boost/contracts.js";
import { combineBoostInput } from "../../extensions/pi-panopticon/boost/parser.js";
import type { QBoostControlRecord } from "../../extensions/pi-panopticon/runtime/q-boost-control-contract.js";
import {
	createLiveBoostTestHost,
	TEST_CONTROL_REFERENCE,
	TestDaemonWal,
} from "./boost-live-test-host.js";

const PRINCIPAL: BoostActor = {
	kind: "principal",
	issuerId: "principal-test",
};
const SUBJECT: BoostSubject = {
	subjectId: "subject-test",
	workspace: { workspaceId: "workspace-test", root: "/workspace/test" },
};
const PROMPT = "review this synthetic public diff";
const REQUEST = {
	requestedYields: 1,
	isolation: "current" as const,
	prompt: PROMPT,
	combinedInput: combineBoostInput(PROMPT),
};

async function reserve(
	host: Awaited<ReturnType<typeof createLiveBoostTestHost>>,
) {
	return host.bridge.reserve({
		caller: PRINCIPAL,
		subject: SUBJECT,
		request: REQUEST,
		control: TEST_CONTROL_REFERENCE,
	});
}

async function dispatch(
	host: Awaited<ReturnType<typeof createLiveBoostTestHost>>,
) {
	return host.bridge.dispatch({
		caller: PRINCIPAL,
		subjectId: SUBJECT.subjectId,
		leaseId: "lease-test",
		control: TEST_CONTROL_REFERENCE,
		combinedInput: REQUEST.combinedInput,
		isolation: REQUEST.isolation,
	});
}

describe("T-843 host-injected live boost runtime", () => {
	it.each([
		["schemaVersion", 1],
		["protocol", "team"],
		["teamId", "other-team"],
		["enablementId", "other-enablement"],
		["principalIssuerId", "other-principal"],
		["mappingVersion", 8],
		["rollbackVersion", 4],
		["baselineLogicalKey", "otherBaseline"],
		["leaseLogicalKey", "otherLease"],
		["enabled", false],
		["signatureStatus", "unverified"],
		["ownershipStatus", "unknown"],
		["residencyEvidence", "local-only"],
	] as const)("fails closed on Q control mismatch %s", async (field, value) => {
		const host = await createLiveBoostTestHost({
			control: { [field]: value } as Partial<QBoostControlRecord>,
		});

		expect(await reserve(host)).toEqual({
			ok: false,
			reason: "control-invalid",
		});
		expect(host.store.snapshot().leases).toEqual([]);
		expect(host.dispatchRequests).toEqual([]);
	});

	it("rejects non-Principal callers before Q resolution or budget mutation", async () => {
		const host = await createLiveBoostTestHost();

		expect(
			await host.bridge.reserve({
				caller: { kind: "child", issuerId: "child-test" },
				subject: SUBJECT,
				request: REQUEST,
				control: TEST_CONTROL_REFERENCE,
			}),
		).toEqual({ ok: false, reason: "unauthorized" });
		expect(host.control.resolveCount).toBe(0);
		expect(host.wal.records).toEqual([]);
	});

	it("fails closed when the Q revision stream is unavailable", async () => {
		const host = await createLiveBoostTestHost();
		host.control.streamAvailable = false;

		expect(await reserve(host)).toEqual({
			ok: false,
			reason: "control-unavailable",
		});
		expect(host.wal.records).toEqual([]);
	});

	it("revalidates control, restores baseline, consumes one visible yield, and releases", async () => {
		const host = await createLiveBoostTestHost();
		expect(await reserve(host)).toMatchObject({ ok: true });
		const pending = dispatch(host);
		await vi.waitFor(() => expect(host.dispatchRequests).toHaveLength(1));
		host.resolveTerminal();

		expect(await pending).toMatchObject({
			ok: true,
			value: { activationGeneration: 1, outcome: "visible" },
		});
		expect(host.control.resolveCount).toBe(2);
		expect(host.store.snapshot().leases).toEqual([]);
		expect(host.events.indexOf("baseline-restore")).toBeLessThan(
			host.events.indexOf("redacted-audit"),
		);
		expect(JSON.stringify(host.audit)).not.toContain(PROMPT);
		expect(JSON.stringify(host.audit)).not.toContain(SUBJECT.subjectId);
		expect(JSON.stringify(host.audit)).not.toMatch(
			/provider|credential|response/i,
		);
	});

	it("accepts only one terminal outcome for an activation", async () => {
		const host = await createLiveBoostTestHost();
		await reserve(host);
		const pending = dispatch(host);
		await vi.waitFor(() => expect(host.dispatchRequests).toHaveLength(1));
		host.resolveTerminal({ outcome: "visible", humanVisible: true });
		host.resolveTerminal({ outcome: "failed", humanVisible: false });

		expect(await pending).toMatchObject({
			ok: true,
			value: { outcome: "visible", humanVisible: true },
		});
		expect(
			host.audit.filter((record) => record.phase === "terminal"),
		).toHaveLength(1);
	});

	it("rejects a stale activation generation and does not consume its yield", async () => {
		const host = await createLiveBoostTestHost();
		await reserve(host);
		const pending = dispatch(host);
		await vi.waitFor(() => expect(host.dispatchRequests).toHaveLength(1));
		host.resolveTerminal({ activationGeneration: 0 });

		expect(await pending).toEqual({
			ok: false,
			reason: "stale-activation",
		});
		expect(
			host.wal.records.filter((record) => record.action === "consume"),
		).toEqual([]);
		expect(host.store.snapshot().leases).toEqual([]);
	});

	it.each([
		"revoked",
		"expired",
	] as const)("orders active Q %s as revoking, abort, acknowledgement, restore, audit, release", async (reason) => {
		const events: string[] = [];
		const host = await createLiveBoostTestHost({
			wal: new TestDaemonWal(events),
		});
		await reserve(host);
		const pending = dispatch(host);
		await vi.waitFor(() => expect(host.dispatchRequests).toHaveLength(1));

		await host.control.emit(reason);
		expect(await pending).toEqual({ ok: false, reason });

		const ordered = [
			"revoking",
			"abort",
			"terminal-acknowledgement",
			"baseline-restore",
			"redacted-audit",
			"release",
		];
		expect(ordered.every((event) => events.includes(event))).toBe(true);
		for (let index = 1; index < ordered.length; index += 1) {
			expect(events.indexOf(ordered[index] ?? "")).toBeGreaterThan(
				events.indexOf(ordered[index - 1] ?? ""),
			);
		}
		expect(host.signals[0]?.aborted).toBe(true);
		expect(host.store.snapshot().leases).toEqual([]);
	});

	it("persists RevertFailed per subject and resets only after Principal Q revalidation", async () => {
		const wal = new TestDaemonWal();
		const failing = await createLiveBoostTestHost({
			wal,
			restoreFailsFor: SUBJECT.subjectId,
		});
		await reserve(failing);
		const pending = dispatch(failing);
		await vi.waitFor(() => expect(failing.dispatchRequests).toHaveLength(1));
		failing.resolveTerminal();

		expect(await pending).toEqual({ ok: false, reason: "revert-failed" });
		expect(failing.bridge.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
		expect(failing.bridge.checkDispatch("other-subject")).toEqual({
			allowed: true,
		});

		const restarted = await createLiveBoostTestHost({ wal });
		expect(restarted.bridge.checkDispatch(SUBJECT.subjectId).allowed).toBe(
			false,
		);
		expect(
			await restarted.bridge.reset({
				caller: { kind: "tool", issuerId: PRINCIPAL.issuerId },
				subjectId: SUBJECT.subjectId,
				control: TEST_CONTROL_REFERENCE,
			}),
		).toEqual({ ok: false, reason: "unauthorized" });
		expect(restarted.control.resolveCount).toBe(0);
		expect(
			await restarted.bridge.reset({
				caller: PRINCIPAL,
				subjectId: SUBJECT.subjectId,
				control: TEST_CONTROL_REFERENCE,
			}),
		).toMatchObject({ ok: true });
		expect(restarted.bridge.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: true,
		});
	});

	it("fails closed in memory if persisting a recovery marker fails", async () => {
		const wal = new TestDaemonWal();
		const host = await createLiveBoostTestHost({ wal });
		await reserve(host);
		wal.failNextAppend = true;

		await host.bridge.shutdown({ choice: "durable-block-marker" });

		expect(host.bridge.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
	});

	it("requires an explicit shutdown choice: awaited restore or durable recovery block", async () => {
		const restoreHost = await createLiveBoostTestHost();
		await reserve(restoreHost);
		const pending = dispatch(restoreHost);
		await vi.waitFor(() =>
			expect(restoreHost.dispatchRequests).toHaveLength(1),
		);
		await restoreHost.bridge.shutdown({ choice: "synchronous-restore" });
		expect(await pending).toEqual({ ok: false, reason: "shutdown" });
		expect(restoreHost.events).toContain("baseline-restore");

		const wal = new TestDaemonWal();
		const markerHost = await createLiveBoostTestHost({ wal });
		await reserve(markerHost);
		await markerHost.bridge.shutdown({ choice: "durable-block-marker" });
		const restarted = await createLiveBoostTestHost({ wal });
		expect(restarted.bridge.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
	});
});
