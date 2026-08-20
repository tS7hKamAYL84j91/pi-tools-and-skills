import { describe, expect, it, vi } from "vitest";

import type { BoostAuditRecord } from "../../extensions/pi-boost/boost/contracts.js";
import {
	activate,
	createBoostHarness,
	PRINCIPAL,
	request,
	reserve,
} from "./boost-helpers.js";

describe("ADR-045 boost isolation and audit", () => {
	it.each([
		"clean",
		"fresh",
	] as const)("binds an empty %s context to the captured issuer and workspace without merge authority", (mode) => {
		const harness = createBoostHarness();
		const mutableSubject = {
			subjectId: "subject-isolated",
			workspace: { workspaceId: "workspace-captured", root: "/captured/root" },
		};
		const reservation = harness.authority.reserve({
			actor: PRINCIPAL,
			subject: mutableSubject,
			request: request({ isolation: mode }),
		});
		if (!reservation.ok || !reservation.value.leaseId) {
			throw new Error("Expected reservation with a lease id");
		}
		mutableSubject.workspace.root = "/changed/after-reservation";

		const activation = harness.authority.activate({
			actor: PRINCIPAL,
			leaseId: reservation.value.leaseId,
		});
		if (!activation.ok) {
			throw new Error("Expected activation");
		}
		expect(harness.isolationRequests[0]).toMatchObject({
			mode,
			issuerId: PRINCIPAL.issuerId,
			subjectId: mutableSubject.subjectId,
			workspace: { workspaceId: "workspace-captured", root: "/captured/root" },
			includeConversationHistory: false,
			includeHiddenSessionState: false,
			mergeBack: false,
			mayCreateLease: false,
			policyScope: "immutable-and-repository",
		});
		expect(activation.value.context).toMatchObject({
			mode,
			issuerId: PRINCIPAL.issuerId,
			workspace: { workspaceId: "workspace-captured", root: "/captured/root" },
			inheritsConversationHistory: false,
			inheritsHiddenSessionState: false,
			mergeBack: false,
		});
	});

	it("creates a distinct empty fresh session per activation without changing identity", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(
			harness,
			request({ isolation: "fresh", requestedYields: 2 }),
		);
		const first = activate(harness, leaseId);
		if (!first.ok) {
			throw new Error("Expected first activation");
		}
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);
		const second = activate(harness, leaseId, "second prompt");
		if (!second.ok) {
			throw new Error("Expected second activation");
		}

		expect(first.value.context.transientSessionId).not.toBe(
			second.value.context.transientSessionId,
		);
		expect(first.value.context.issuerId).toBe(second.value.context.issuerId);
		expect(first.value.context.workspace).toEqual(
			second.value.context.workspace,
		);
	});

	it("fails workspace revalidation closed and reverts without selecting the lease model", () => {
		const harness = createBoostHarness({ validateWorkspace: () => false });
		const leaseId = reserve(harness, request({ isolation: "fresh" }));

		expect(activate(harness, leaseId)).toMatchObject({
			ok: false,
			reason: "workspace-mismatch",
		});
		expect(harness.selectedModels).toEqual([]);
		expect(harness.restoredModels).toHaveLength(1);
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { state: "Reserved" },
		});
	});

	it("disposes every ephemeral context with no merge after a yield", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(
			harness,
			request({ isolation: "clean", requestedYields: 2 }),
		);
		expect(activate(harness, leaseId).ok).toBe(true);
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);

		expect(harness.dependencies.isolation.dispose).toHaveBeenCalledTimes(1);
		const disposed = vi.mocked(harness.dependencies.isolation.dispose).mock
			.calls[0]?.[0];
		expect(disposed).toMatchObject({ mergeBack: false });
	});

	it("emits bounded redacted audit records containing opaque identities only", () => {
		const harness = createBoostHarness();
		const secretPrompt = "PRIVATE token=credential-value workspace contents";
		const leaseId = reserve(
			harness,
			request({ prompt: secretPrompt, requestedYields: 2 }),
		);
		expect(activate(harness, leaseId).ok).toBe(true);
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);

		const serialized = JSON.stringify(harness.auditRecords);
		expect(serialized).not.toContain(secretPrompt);
		expect(serialized).not.toContain("credential-value");
		expect(serialized).not.toContain("subject-a");
		expect(serialized).not.toContain("principal-a");
		expect(serialized).not.toMatch(
			/prompt|response|providerError|workspaceContent|tokenCount/i,
		);
		expect(
			harness.auditRecords.every((record) => record.policyKeys.length === 2),
		).toBe(true);
	});

	it("denies activation before selection when the pre-activation audit write fails", () => {
		const harness = createBoostHarness({
			auditAppend: (record: BoostAuditRecord) => {
				if (record.phase === "before-activation") {
					throw new Error("audit filesystem details");
				}
			},
		});
		const leaseId = reserve(harness);

		expect(activate(harness, leaseId)).toMatchObject({
			ok: false,
			reason: "audit-write-failed",
		});
		expect(harness.selectedModels).toEqual([]);
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { state: "Reserved" },
		});
	});

	it("forces reversion when the post-selection transition audit fails", () => {
		const harness = createBoostHarness({
			auditAppend: (record: BoostAuditRecord) => {
				if (record.phase === "transition" && record.toState === "Active") {
					throw new Error("audit filesystem details");
				}
			},
		});
		const leaseId = reserve(harness, request({ requestedYields: 2 }));

		expect(activate(harness, leaseId)).toMatchObject({
			ok: false,
			reason: "revert-failed",
		});
		expect(harness.selectedModels).toHaveLength(1);
		expect(harness.restoredModels).toHaveLength(1);
		expect(harness.dependencies.isolation.dispose).toHaveBeenCalledTimes(1);
		expect(harness.authority.checkDispatch("subject-a")).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
	});

	it("enters RevertFailed when audit finalization fails after a human yield", () => {
		const harness = createBoostHarness({
			auditAppend: (record: BoostAuditRecord) => {
				if (
					record.phase === "transition" &&
					record.fromState === "Reverting" &&
					record.toState === "Reserved"
				) {
					throw new Error("audit finalization details");
				}
			},
		});
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(
			harness.authority.settle({
				leaseId,
				activationId: 1,
				outcome: "visible",
			}),
		).toMatchObject({
			ok: false,
			reason: "revert-failed",
		});
		expect(harness.authority.checkDispatch("subject-a")).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
	});
});
