import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoostModelPolicyKey } from "../../extensions/pi-boost/boost/contracts.js";
import { BoostGlobalLeaseSlot } from "../../extensions/pi-boost/boost/global-slot.js";
import {
	AGENT,
	activate,
	BASELINE_MODEL,
	createBoostHarness,
	LEASE_MODEL,
	OTHER_PRINCIPAL,
	PRINCIPAL,
	request,
	reserve,
	SUBJECT,
} from "./boost-helpers.js";

describe("ADR-045 boost authority", () => {
	it.each([
		AGENT,
		{ kind: "schedule", issuerId: "schedule-a" },
		{ kind: "matrix", issuerId: "matrix-a" },
	] as const)("allows only a Principal to reserve, not $kind", (actor) => {
		const harness = createBoostHarness();
		const result = harness.authority.reserve({
			actor,
			subject: SUBJECT,
			request: request(),
		});

		expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
		expect(harness.dependencies.models.resolve).not.toHaveBeenCalled();
		expect(harness.selectedModels).toEqual([]);
		expect(harness.slot.isOccupied()).toBe(false);
	});

	it("atomically permits only one lease across authorities sharing the global slot", () => {
		const slot = new BoostGlobalLeaseSlot();
		const first = createBoostHarness({ slot });
		const second = createBoostHarness({ slot });

		expect(
			first.authority.reserve({
				actor: PRINCIPAL,
				subject: SUBJECT,
				request: request(),
			}).ok,
		).toBe(true);
		expect(
			second.authority.reserve({
				actor: PRINCIPAL,
				subject: {
					subjectId: "subject-b",
					workspace: { workspaceId: "workspace-b", root: "/repo/b" },
				},
				request: request(),
			}),
		).toMatchObject({ ok: false, reason: "slot-occupied" });
		expect(second.selectedModels).toEqual([]);
	});

	it.each([
		["principalBoostBaseline", undefined],
		["principalBoostLease", { ...LEASE_MODEL, registered: false }],
		["principalBoostLease", { ...LEASE_MODEL, family: "other-family" }],
	] as const)("denies an absent, unregistered, or wrong-family %s policy", (invalidKey, invalidModel) => {
		const harness = createBoostHarness({
			resolveModel: (key: BoostModelPolicyKey) => {
				if (key === invalidKey) {
					return invalidModel;
				}
				return key === "principalBoostLease"
					? LEASE_MODEL
					: {
							provider: "mock-local",
							id: "glm",
							family: "glm-5.2",
							registered: true,
						};
			},
		});

		expect(
			harness.authority.reserve({
				actor: PRINCIPAL,
				subject: SUBJECT,
				request: request(),
			}),
		).toMatchObject({
			ok: false,
			reason: "model-policy-invalid",
		});
		expect(harness.slot.isOccupied()).toBe(false);
		expect(harness.selectedModels).toEqual([]);
	});

	it("classifies the fixed frame and explicit input together and fails closed for private input", () => {
		let classifiedInput = "";
		const harness = createBoostHarness({
			classify: (input) => {
				classifiedInput = input;
				return input.includes("PRIVATE material") ? "private" : "public";
			},
		});
		const leaseId = reserve(harness, request({ prompt: "PRIVATE material" }));

		expect(activate(harness, leaseId)).toMatchObject({
			ok: false,
			reason: "governance-private",
		});
		expect(classifiedInput).toContain("[BOOST REVIEW FRAME — EPHEMERAL]");
		expect(classifiedInput.endsWith("PRIVATE material")).toBe(true);
		expect(harness.selectedModels).toEqual([]);
		expect(harness.restoredModels).toEqual([BASELINE_MODEL]);
		expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
			ok: true,
			value: { state: "Reserved", consumedYields: 0 },
		});
	});

	it("fails closed without selection when governance throws or denies eligibility", () => {
		const throwing = createBoostHarness({
			classify: () => {
				throw new Error("raw provider-shaped policy failure");
			},
		});
		const denied = createBoostHarness({ classify: () => "denied" });

		expect(activate(throwing, reserve(throwing))).toMatchObject({
			ok: false,
			reason: "governance-denied",
		});
		expect(activate(denied, reserve(denied))).toMatchObject({
			ok: false,
			reason: "governance-denied",
		});
		expect(throwing.selectedModels).toEqual([]);
		expect(denied.selectedModels).toEqual([]);
	});

	it("rechecks the same Principal issuer before each later activation", () => {
		const harness = createBoostHarness();
		const leaseId = reserve(harness, request({ requestedYields: 2 }));
		expect(activate(harness, leaseId).ok).toBe(true);
		expect(
			harness.authority.settle({ leaseId, activationId: 1, outcome: "visible" })
				.ok,
		).toBe(true);

		expect(
			harness.authority.activate({
				actor: OTHER_PRINCIPAL,
				leaseId,
				prompt: "next public turn",
			}),
		).toMatchObject({
			ok: false,
			reason: "issuer-mismatch",
		});
		expect(harness.selectedModels).toHaveLength(1);
	});

	it("does not expose lease status or reset authority to non-Principals", () => {
		const harness = createBoostHarness();
		reserve(harness);

		expect(harness.authority.getStatus(AGENT)).toMatchObject({
			ok: false,
			reason: "unauthorized",
		});
		expect(
			harness.authority.reset({ actor: AGENT, subjectId: SUBJECT.subjectId }),
		).toMatchObject({
			ok: false,
			reason: "unauthorized",
		});
	});

	it("fails closed by default and accepts only the explicit host injection", () => {
		const runtimeSource = readFileSync(
			"extensions/pi-boost/index.ts",
			"utf8",
		);
		const boostWiring = readFileSync(
			"extensions/pi-boost/boost-extension-wiring.ts",
			"utf8",
		);
		expect(runtimeSource).toContain("createBoostExtension()");
		expect(boostWiring).toContain(
			"createUnavailableBoostCommandDeps(identitySource, cognitiveOptions)",
		);
		expect(boostWiring).toContain(
			"createHostBoostCommandDeps(identitySource, injection, cognitiveOptions)",
		);
		expect(`${runtimeSource}\n${boostWiring}`).not.toMatch(
			/process\.env.*boost|globalThis.*boost|as unknown as.*ExtensionAPI/i,
		);
	});
});
