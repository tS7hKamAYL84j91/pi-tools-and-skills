import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { LiveBoostHostInjection } from "../../extensions/pi-boost/boost/runtime-adapter.js";
import defaultPanopticonExtension from "../../extensions/pi-panopticon/index.js";
import type { LiveBoostRuntimeBridge } from "../../extensions/pi-boost/live-boost-bridge-contract.js";
import {
	Q_BOOST_BASELINE_KEY,
	Q_BOOST_LEASE_KEY,
	Q_BOOST_TEAM_ID,
} from "../../extensions/pi-boost/q-boost-control-contract.js";
import {
	createReviewedBoostHost,
	getReviewedBoostContractIdentity,
	REVIEWED_BOOST_CONTRACT_PATH,
	REVIEWED_BOOST_CONTRACT_SHA256,
} from "../../extensions/pi-boost/reviewed-boost-host.js";

interface CommandDefinition {
	handler(args: string, context: ExtensionCommandContext): Promise<void>;
}

interface FakeExtensionApi {
	registerTool(definition: { readonly name: string }): void;
	registerCommand(name: string, definition: CommandDefinition): void;
	registerShortcut(key: string, definition: unknown): void;
	registerFlag(name: string, definition: unknown): void;
	on(event: string, handler: () => Promise<void>): void;
	getFlag(name: string): undefined;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
}

function createDisabledBridge(): LiveBoostRuntimeBridge {
	const unavailable = async () => ({
		ok: false as const,
		reason: "control-unavailable" as const,
	});
	return {
		reserve: vi.fn(unavailable),
		dispatch: vi.fn(unavailable),
		reset: vi.fn(unavailable),
		getStatus: vi.fn(unavailable),
		checkDispatch: vi.fn(() => ({ allowed: true as const })),
		shutdown: vi.fn(async () => undefined),
	};
}

function createInjection(): LiveBoostHostInjection {
	return {
		bridge: createDisabledBridge(),
		control: {
			teamId: Q_BOOST_TEAM_ID,
			enablementId: "enablement-test",
			mappingVersion: 7,
			rollbackVersion: 3,
			baselineLogicalKey: Q_BOOST_BASELINE_KEY,
			leaseLogicalKey: Q_BOOST_LEASE_KEY,
		},
		shutdownChoice: "synchronous-restore",
	};
}

function createFakeApi(): {
	readonly api: ExtensionAPI;
	readonly commands: Map<string, CommandDefinition>;
	readonly events: Map<string, () => Promise<void>>;
	readonly notifications: string[];
} {
	const commands = new Map<string, CommandDefinition>();
	const events = new Map<string, () => Promise<void>>();
	const notifications: string[] = [];
	const api: FakeExtensionApi = {
		registerTool() {},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerShortcut() {},
		registerFlag() {},
		on(event, handler) {
			events.set(event, handler);
		},
		getFlag() {
			return undefined;
		},
		sendMessage() {},
		sendUserMessage() {},
	};
	return {
		api: api as unknown as ExtensionAPI,
		commands,
		events,
		notifications,
	};
}

function createCommandContext(
	notifications: string[],
): ExtensionCommandContext {
	return {
		cwd: "/workspace/test",
		sessionManager: { getSessionId: () => "principal-test" },
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionCommandContext;
}

describe("reviewed boost production host", () => {
	it("attests the reviewed source identity", () => {
		const source = readFileSync(REVIEWED_BOOST_CONTRACT_PATH, "utf8");
		expect(createHash("sha256").update(source).digest("hex")).toBe(
			REVIEWED_BOOST_CONTRACT_SHA256,
		);
		expect(getReviewedBoostContractIdentity()).toEqual({
			path: REVIEWED_BOOST_CONTRACT_PATH,
			sha256: REVIEWED_BOOST_CONTRACT_SHA256,
		});
	});

	it("constructs the explicit injected factory without invoking a disabled bridge", () => {
		const injection = createInjection();
		const host = createReviewedBoostHost({
			contract: getReviewedBoostContractIdentity(),
			injection,
		});
		const fake = createFakeApi();

		host.extension(fake.api);

		expect(fake.commands.has("boost")).toBe(true);
		expect(injection.bridge.reserve).not.toHaveBeenCalled();
		expect(injection.bridge.dispatch).not.toHaveBeenCalled();
		expect(injection.bridge.reset).not.toHaveBeenCalled();
		expect(injection.bridge.getStatus).not.toHaveBeenCalled();
	});

	it("routes a boost request through the injected bridge, unlike the inert default", async () => {
		const injection = createInjection();
		const host = createReviewedBoostHost({
			contract: getReviewedBoostContractIdentity(),
			injection,
		});
		const injected = createFakeApi();
		host.extension(injected.api);
		const injectedBoost = injected.commands.get("boost");
		if (!injectedBoost) {
			throw new Error("Missing injected boost command");
		}

		await injectedBoost.handler(
			"review this public diff",
			createCommandContext(injected.notifications),
		);

		expect(injection.bridge.reserve).toHaveBeenCalledTimes(1);
		expect(injected.notifications.join(" ")).toContain("runtime unavailable");

		const inert = createFakeApi();
		defaultPanopticonExtension(inert.api);
		const inertBoost = inert.commands.get("boost");
		if (!inertBoost) {
			throw new Error("Missing inert boost command");
		}
		await inertBoost.handler(
			"review this public diff",
			createCommandContext(inert.notifications),
		);
		expect(inert.notifications.join(" ")).toContain("runtime unavailable");
	});

	it("shares idempotent shutdown across extension and host paths", async () => {
		const injection = createInjection();
		const host = createReviewedBoostHost({
			contract: getReviewedBoostContractIdentity(),
			injection,
		});
		const fake = createFakeApi();
		host.extension(fake.api);
		const shutdown = fake.events.get("session_shutdown");
		if (!shutdown) {
			throw new Error("Missing session shutdown handler");
		}

		await shutdown();
		await host.shutdown();

		expect(injection.bridge.shutdown).toHaveBeenCalledTimes(1);
		expect(injection.bridge.shutdown).toHaveBeenCalledWith({
			choice: "synchronous-restore",
		});
	});

	it("rejects a mismatched contract identity before extension construction", () => {
		expect(() =>
			createReviewedBoostHost({
				contract: {
					path: REVIEWED_BOOST_CONTRACT_PATH,
					sha256: "0".repeat(64) as typeof REVIEWED_BOOST_CONTRACT_SHA256,
				},
				injection: createInjection(),
			}),
		).toThrow("Reviewed boost contract identity mismatch");
	});

	it("rejects an invalid shutdown choice before extension construction", () => {
		const injection = createInjection();
		const invalid = {
			...injection,
			shutdownChoice: "unexpected",
			// Intentional runtime-boundary test for an erased TypeScript union.
		} as unknown as LiveBoostHostInjection;

		expect(() =>
			createReviewedBoostHost({
				contract: getReviewedBoostContractIdentity(),
				injection: invalid,
			}),
		).toThrow("Invalid reviewed boost shutdown choice");
	});

	it("rejects an invalid logical Q reference before extension construction", () => {
		const injection = createInjection();
		const invalid = {
			...injection,
			control: { ...injection.control, mappingVersion: -1 },
		} as LiveBoostHostInjection;

		expect(() =>
			createReviewedBoostHost({
				contract: getReviewedBoostContractIdentity(),
				injection: invalid,
			}),
		).toThrow("Invalid reviewed boost control reference");
	});

	it("keeps the reviewed host free of operational mutation seams", () => {
		const source = readFileSync(
			"extensions/pi-boost/reviewed-boost-host.ts",
			"utf8",
		);
		expect(source).toContain("createPanopticonExtension(injection)");
		expect(source).not.toMatch(
			/from\s+["'][^"']*(provider|config|scheduler)[^"']*["']|process\.env|apiKey|configPath|defaultModel/i,
		);
	});
});
