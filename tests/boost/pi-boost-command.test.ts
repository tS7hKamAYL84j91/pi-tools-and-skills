import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { InertBoostDispatch } from "../../extensions/pi-boost/boost/command.js";
import type {
	BoostLeaseStatus,
	BoostResult,
	ReserveBoostInput,
} from "../../extensions/pi-boost/boost/contracts.js";
import { createInertBoostCommandDeps } from "../../extensions/pi-boost/boost/inert-runtime.js";
import {
	AGENT,
	createBoostCommandHarness,
	PRINCIPAL,
	SUBJECT,
} from "./boost-helpers.js";

describe("phase-2 inert /boost command", () => {
	it("constructs only the inert runtime command capabilities", () => {
		const deps = createInertBoostCommandDeps({
			isPrincipalSession: () => true,
			selfId: "subject-runtime",
		});
		const context = {
			cwd: "/workspace/runtime",
			sessionManager: { getSessionId: () => "principal-runtime" },
		} as ExtensionCommandContext;
		const identity = deps.identity(context);
		const parsed = deps.parse("/boost inspect the diff");
		if (!identity || !parsed.ok || parsed.command.kind !== "request") {
			throw new Error("Expected an inert runtime request identity");
		}

		const reservation = deps.authority.reserve({
			actor: identity.actor,
			subject: identity.subject,
			request: parsed.command.request,
		});

		expect(Object.keys(deps).sort()).toEqual([
			"authority",
			"dispatch",
			"identity",
			"notify",
			"parse",
		]);
		expect(Object.keys(deps.authority).sort()).toEqual([
			"getStatus",
			"reserve",
			"reset",
		]);
		expect("activate" in deps.authority).toBe(false);
		expect(reservation).toMatchObject({
			ok: true,
			value: { state: "Reserved", remainingYields: 1 },
		});
	});

	it("registers through the boost hook and routes request parsing to reservation", async () => {
		const harness = createBoostCommandHarness();

		await harness.execute("--clean -n 3 -- review the public diff");

		expect(harness.parse).toHaveBeenCalledWith(
			"/boost --clean -n 3 -- review the public diff",
		);
		expect(harness.authority.reserve).toHaveBeenCalledWith({
			actor: PRINCIPAL,
			subject: SUBJECT,
			request: expect.objectContaining({
				isolation: "clean",
				requestedYields: 3,
				prompt: "review the public diff",
			}),
		});
		expect(harness.dispatch).toHaveBeenCalledOnce();
		expect(harness.notifications).toEqual([
			expect.objectContaining({
				level: "info",
				message: expect.stringContaining("Boost reserved (inert)"),
			}),
		]);
	});

	it.each([
		["status", "getStatus"],
		["reset", "reset"],
	] as const)("routes %s through the parser and only its authority method", async (args, method) => {
		const harness = createBoostCommandHarness();

		await harness.execute(args);

		expect(harness.parse).toHaveBeenCalledWith(`/boost ${args}`);
		expect(harness.authority[method]).toHaveBeenCalledOnce();
		expect(harness.authority.reserve).not.toHaveBeenCalled();
		expect(harness.dispatch).not.toHaveBeenCalled();
	});

	it.each([
		["--clean inspect", "clean", 1, "inspect"],
		["--fresh -n 2 -- inspect", "fresh", 2, "inspect"],
		["-n 3 inspect this", "current", 3, "inspect this"],
		["-- status of the diff", "current", 1, "status of the diff"],
	] as const)("preserves parser options for %s", async (args, isolation, yields, prompt) => {
		const harness = createBoostCommandHarness();

		await harness.execute(args);

		const input = harness.authority.reserve.mock.calls[0]?.[0];
		expect(input?.request).toMatchObject({
			isolation,
			requestedYields: yields,
			prompt,
		});
	});

	it.each([
		["-n 4 inspect", "-n must be 1, 2, or 3"],
		["--clean --fresh inspect", "mutually exclusive"],
		["--unknown inspect", "unknown option"],
		["status trailing", "accept no trailing text"],
	] as const)("returns bounded option feedback for %s", async (args, feedback) => {
		const harness = createBoostCommandHarness();

		await harness.execute(args);

		expect(harness.identity).not.toHaveBeenCalled();
		expect(harness.authority.reserve).not.toHaveBeenCalled();
		expect(harness.dispatch).not.toHaveBeenCalled();
		expect(harness.notifications).toEqual([
			expect.objectContaining({ level: "warning" }),
		]);
		expect(harness.notifications[0]?.message).toContain(feedback);
		expect(harness.notifications[0]?.message.length).toBeLessThan(160);
	});

	it.each([
		{ identity: undefined, label: "missing identity" },
		{
			identity: { actor: AGENT, subject: SUBJECT },
			label: "non-Principal identity",
		},
	] as const)("denies $label before authority or dispatch", async ({
		identity,
	}) => {
		const harness = createBoostCommandHarness({ identity });

		await harness.execute("inspect private=value");

		expect(harness.authority.reserve).not.toHaveBeenCalled();
		expect(harness.authority.getStatus).not.toHaveBeenCalled();
		expect(harness.authority.reset).not.toHaveBeenCalled();
		expect(harness.dispatch).not.toHaveBeenCalled();
		expect(harness.notifications).toEqual([
			{
				message: "Boost denied: Principal identity required",
				level: "warning",
			},
		]);
	});

	it.each([
		"status",
		"reset",
	] as const)("redacts %s feedback to approved status fields", async (command) => {
		const sensitiveStatus = {
			state: command === "status" ? "Reserved" : "Idle",
			leaseId: "lease-opaque",
			remainingYields: 2,
			expiresAt: 9_000,
			requestedYields: 3,
			consumedYields: 1,
			failureCategory: "model-selection-failed",
			prompt: "secret prompt",
			provider: "secret provider",
			model: "secret model",
			workspace: "/secret/workspace",
		} as const;
		const result: BoostResult<BoostLeaseStatus> = {
			ok: true,
			value: sensitiveStatus,
		};
		const harness = createBoostCommandHarness(
			command === "status" ? { status: () => result } : { reset: () => result },
		);

		await harness.execute(command);

		const feedback = harness.notifications[0]?.message ?? "";
		expect(feedback).toContain("state=");
		expect(feedback).toContain("id=lease-opaque");
		expect(feedback).toContain("remaining=2");
		expect(feedback).toContain("expiresAt=9000");
		expect(feedback).not.toMatch(
			/secret|prompt|provider|model|workspace|requested|consumed|failure/i,
		);
	});

	it("keeps request reservation-only with no activation or external mutation capability", async () => {
		const activate = vi.fn();
		const provider = vi.fn();
		const modelSelector = vi.fn();
		const scheduler = vi.fn();
		const network = vi.fn();
		const mutableDefaults = { model: "baseline", schedule: "unchanged" };
		const before = structuredClone(mutableDefaults);
		const reserve = vi.fn(
			(_input: ReserveBoostInput): BoostResult<BoostLeaseStatus> => ({
				ok: true,
				value: {
					state: "Reserved",
					leaseId: "lease-only",
					remainingYields: 1,
				},
			}),
		);
		const harness = createBoostCommandHarness({ reserve });
		Object.assign(harness.authority, { activate });

		await harness.execute("--fresh inspect");

		expect(reserve).toHaveBeenCalledOnce();
		expect(harness.dispatch).toHaveBeenCalledOnce();
		expect(activate).not.toHaveBeenCalled();
		expect(provider).not.toHaveBeenCalled();
		expect(modelSelector).not.toHaveBeenCalled();
		expect(scheduler).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
		expect(mutableDefaults).toEqual(before);
	});

	it("uses a stateless inert dispatch decision without changing its reservation", () => {
		const reservation = Object.freeze<BoostLeaseStatus>({
			state: "Reserved",
			leaseId: "lease-frozen",
			remainingYields: 1,
		});
		const dispatch = new InertBoostDispatch();

		expect(dispatch.recordReservation(reservation)).toEqual({
			dispatched: false,
			kind: "reserved",
		});
		expect(reservation).toEqual({
			state: "Reserved",
			leaseId: "lease-frozen",
			remainingYields: 1,
		});
	});
});
