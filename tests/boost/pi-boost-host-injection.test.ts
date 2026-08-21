import { readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	createHostBoostCommandDeps,
	createUnavailableBoostCommandDeps,
} from "../../extensions/pi-boost/boost/runtime-adapter.js";
import type { LiveBoostRuntimeBridge } from "../../extensions/pi-boost/live-boost-bridge-contract.js";
import { PRINCIPAL, request, SUBJECT } from "./boost-helpers.js";
import { TEST_CONTROL_REFERENCE } from "./boost-live-test-host.js";

function bridgeFake(): LiveBoostRuntimeBridge {
	return {
		reserve: vi.fn(async () => ({
			ok: true as const,
			value: {
				state: "Reserved" as const,
				leaseId: "lease-host",
				requestedYields: 1,
				consumedYields: 0,
				remainingYields: 1,
				expiresAt: 7_200_000,
			},
		})),
		dispatch: vi.fn(async (input) => ({
			ok: true as const,
			value: {
				leaseId: input.leaseId,
				activationGeneration: 1,
				outcome: "visible" as const,
				humanVisible: true,
			},
		})),
		reset: vi.fn(async () => ({
			ok: true as const,
			value: { reset: true as const },
		})),
		getStatus: vi.fn(async () => ({
			ok: true as const,
			value: { state: "Idle" as const },
		})),
		checkDispatch: vi.fn(() => ({ allowed: true as const })),
		shutdown: vi.fn(async () => undefined),
	};
}

const registry = {
	isPrincipalSession: () => true,
	selfId: SUBJECT.subjectId,
};
const context = {
	cwd: SUBJECT.workspace.root,
	sessionManager: { getSessionId: () => PRINCIPAL.issuerId },
	ui: { notify: vi.fn() },
} as unknown as ExtensionCommandContext;

describe("T-843 host injection boundary", () => {
	it("normal ExtensionAPI loading denies without probing for a workaround", async () => {
		const deps = createUnavailableBoostCommandDeps(registry);
		const parsed = deps.parse("/boost review this public diff");
		const identity = deps.identity(context);
		if (!parsed.ok || parsed.command.kind !== "request" || !identity) {
			throw new Error("Expected a parsed Principal request");
		}

		expect(
			await deps.authority.reserve({
				actor: identity.actor,
				subject: identity.subject,
				request: parsed.command.request,
			}),
		).toEqual({ ok: false, reason: "runtime-unavailable" });

		const source = readFileSync("extensions/pi-boost/index.ts", "utf8");
		expect(source).toContain("createBoostExtension");
		expect(source).not.toMatch(
			/as unknown as.*ExtensionAPI|process\.env.*boost|globalThis.*boost/i,
		);
	});

	it("keeps external config read-only and exposes no default/scheduler or credential seam", () => {
		const controlSource = readFileSync(
			"extensions/pi-boost/live-boost-control-contract.ts",
			"utf8",
		);
		const runtimeSource = readFileSync(
			"extensions/pi-boost/live-boost-bridge-contract.ts",
			"utf8",
		);
		expect(controlSource).toMatch(/resolve\([\s\S]*subscribe\(/);
		expect(controlSource).not.toMatch(
			/\b(write|update|mutate|enable|rollback)\s*\(/,
		);
		expect(runtimeSource).not.toMatch(
			/credential|apiKey|token|configPath|setModel|defaultModel|scheduler/i,
		);
	});

	it("passes only logical external Boost config and authenticated command inputs to the injected bridge", async () => {
		const bridge = bridgeFake();
		const deps = createHostBoostCommandDeps(registry, {
			bridge,
			control: TEST_CONTROL_REFERENCE,
			shutdownChoice: "synchronous-restore",
		});
		const boostRequest = request();

		const reserved = await deps.authority.reserve({
			actor: PRINCIPAL,
			subject: SUBJECT,
			request: boostRequest,
		});
		expect(bridge.reserve).toHaveBeenCalledWith({
			caller: PRINCIPAL,
			subject: SUBJECT,
			request: boostRequest,
			control: TEST_CONTROL_REFERENCE,
		});
		if (!reserved.ok) {
			throw new Error("Expected host reservation");
		}
		await deps.dispatch.recordReservation(reserved.value, {
			actor: PRINCIPAL,
			subject: SUBJECT,
			request: boostRequest,
		});
		expect(bridge.dispatch).toHaveBeenCalledWith({
			caller: PRINCIPAL,
			subjectId: SUBJECT.subjectId,
			leaseId: "lease-host",
			control: TEST_CONTROL_REFERENCE,
			combinedInput: boostRequest.combinedInput,
			isolation: boostRequest.isolation,
		});
		expect(Object.keys(TEST_CONTROL_REFERENCE)).not.toEqual(
			expect.arrayContaining(["credential", "token", "configPath"]),
		);
	});
});
