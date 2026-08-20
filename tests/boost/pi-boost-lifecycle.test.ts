import { describe, expect, it } from "vitest";

import {
	activate,
	BASELINE_MODEL,
	createBoostHarness,
	PRINCIPAL,
	request,
	reserve,
	SUBJECT,
} from "./boost-helpers.js";

describe("ADR-045 boost lifecycle", () => {
	it.each([
		"visible",
		"collapsed-visible",
	] as const)("consumes exactly one %s human yield and restores the captured baseline", (outcome) => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome }),
		).toMatchObject({
			ok: true,
			value: { state: "Reserved", consumedYields: 1, remainingYields: 1 },
		});
		expect(harness.restoredModels).toHaveLength(1);
		expect(harness.restoredModels[0]).toBe(BASELINE_MODEL);
	});

	it.each([
		"cancelled",
		"failed",
		"tool-only",
		"suppressed",
	] as const)("reverts but does not consume a %s non-yield", (outcome) => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome }),
		).toMatchObject({
			ok: true,
			value: { state: "Reserved", consumedYields: 0, remainingYields: 2 },
		});
		expect(harness.restoredModels).toHaveLength(1);
	});

	it("reverts between every yield and requires a new governance check before reselection", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);
		expect(harness.restoredModels).toHaveLength(1);

		expect(activate(harness, leaseId, "second public prompt").ok).toBe(true);
		expect(harness.dependencies.governance.classify).toHaveBeenCalledTimes(2);
		expect(harness.selectedModels).toHaveLength(2);
		expect(
			harness.authority.settle({
				leaseId,
				activationId: 2,
				outcome: "visible",
			}),
		).toMatchObject({
			ok: true,
			value: { state: "Idle", consumedYields: 2, remainingYields: 0 },
		});
		expect(harness.restoredModels).toHaveLength(2);
		expect(harness.slot.isOccupied()).toBe(false);
	});

	it("restores the captured baseline before a non-boost dispatch", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(
			harness.authority.prepareNonBoostDispatch(SUBJECT.subjectId),
		).toEqual({ allowed: true });
		expect(harness.restoredModels).toEqual([BASELINE_MODEL]);
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { state: "Reserved", consumedYields: 0 },
		});
	});

	it("does not double-decrement a repeated terminal callback", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);
		expect(
			harness.authority.settle({
				leaseId,
				activationId: 1,
				outcome: "visible",
			}),
		).toMatchObject({
			ok: false,
			reason: "lease-not-active",
		});
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { consumedYields: 1 },
		});
	});

	it("rejects a stale callback after reactivation without consuming the current activation", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);
		expect(activate(harness, leaseId, "second public prompt")).toMatchObject({
			ok: true,
			value: { activationId: 2 },
		});
		expect(
			harness.authority.settle({
				leaseId,
				activationId: 1,
				outcome: "visible",
			}),
		).toMatchObject({ ok: false, reason: "lease-not-active" });
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { state: "Active", consumedYields: 1 },
		});
	});

	it("cleans up an expired active lease before accepting a terminal callback", () => {
		const harness = createBoostHarness({ leaseDurationMs: 50 });
		const leaseId = reserve(harness);
		expect(activate(harness, leaseId).ok).toBe(true);
		harness.clock.now += 51;
		expect(
			harness.authority.settle({
				leaseId,
				activationId: 1,
				outcome: "visible",
			}),
		).toMatchObject({ ok: true, value: { state: "Idle" } });
		expect(harness.slot.isOccupied()).toBe(false);
	});

	it("cleans up an expired reserved or active lease without preserving it", () => {
		for (const activateBeforeExpiry of [false, true]) {
			const harness = createBoostHarness({ leaseDurationMs: 50 });
			const leaseId = reserve(harness, request({ requestedYields: 3 }));
			if (activateBeforeExpiry) {
				expect(activate(harness, leaseId).ok).toBe(true);
			}
			harness.clock.now += 51;

			expect(harness.authority.cleanupExpired()).toMatchObject({
				ok: true,
				value: { state: "Idle" },
			});
			expect(harness.restoredModels).toHaveLength(1);
			expect(harness.slot.isOccupied()).toBe(false);
		}
	});

	it.each([
		"restart",
		"session-transfer",
	] as const)("terminates and cleans up on %s", (reason) => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 3 }));
		expect(activate(harness, leaseId).ok).toBe(true);

		expect(harness.authority.terminate({ leaseId, reason })).toMatchObject({
			ok: true,
			value: { state: "Idle" },
		});
		expect(harness.restoredModels).toHaveLength(1);
		expect(harness.slot.isOccupied()).toBe(false);
	});

	it("blocks every model dispatch for only the RevertFailed subject until Principal reset", () => {
		let restorationFails = true;
		const harness = createBoostHarness({
			restoreModel: () => {
				if (restorationFails) {
					throw new Error("raw restoration details");
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
		expect(harness.authority.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
		expect(
			harness.authority.terminate({ leaseId, reason: "restart" }),
		).toMatchObject({
			ok: false,
			reason: "revert-failed",
		});
		expect(harness.authority.checkDispatch("other-subject")).toEqual({
			allowed: true,
		});
		expect(harness.slot.isOccupied()).toBe(true);

		restorationFails = false;
		expect(
			harness.authority.reset({
				actor: PRINCIPAL,
				subjectId: SUBJECT.subjectId,
			}),
		).toMatchObject({
			ok: true,
			value: { state: "Idle" },
		});
		expect(harness.selectedModels).toHaveLength(1);
		expect(harness.authority.checkDispatch(SUBJECT.subjectId)).toEqual({
			allowed: true,
		});
		expect(harness.slot.isOccupied()).toBe(false);
	});

	it("rejects a direct malformed request before reserving the slot", () => {
		const harness = createBoostHarness();
		const malformed = request({ requestedYields: 4 });

		expect(
			harness.authority.reserve({
				actor: PRINCIPAL,
				subject: SUBJECT,
				request: malformed,
			}),
		).toMatchObject({
			ok: false,
			reason: "invalid-request",
		});
		expect(harness.slot.isOccupied()).toBe(false);
	});
});
