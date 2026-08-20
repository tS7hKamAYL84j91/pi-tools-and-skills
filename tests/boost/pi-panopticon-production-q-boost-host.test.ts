import { readFileSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type {
	DaemonBoostWal,
	DaemonBoostWalRecord,
} from "../../extensions/pi-boost/daemon-boost-control-store.js";
import type { LiveBoostAuditRecord } from "../../extensions/pi-boost/live-boost-bridge-contract.js";
import {
	createProductionQBoostHost,
	type ProductionQBoostHostInput,
} from "../../extensions/pi-boost/production-q-boost-host.js";
import type { QBoostControlRecordSource } from "../../extensions/pi-boost/q-boost-control-adapter.js";
import {
	Q_BOOST_BASELINE_KEY,
	Q_BOOST_LEASE_KEY,
	Q_BOOST_TEAM_ID,
	type QBoostControlRecord,
	type QBoostControlRevision,
} from "../../extensions/pi-boost/q-boost-control-contract.js";
import { getReviewedBoostContractIdentity } from "../../extensions/pi-boost/reviewed-boost-host.js";

interface CommandDefinition {
	handler(args: string, context: ExtensionCommandContext): Promise<void>;
}

interface FakeExtensionApi {
	registerTool(definition: { readonly name: string }): void;
	registerCommand(name: string, definition: CommandDefinition): void;
	registerShortcut(key: string, definition: unknown): void;
	registerFlag(name: string, definition: unknown): void;
	on(event: string, handler: unknown): void;
	getFlag(name: string): undefined;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
}

class MemoryWal implements DaemonBoostWal {
	readonly records: DaemonBoostWalRecord[] = [];

	async read(): Promise<readonly DaemonBoostWalRecord[]> {
		return this.records;
	}

	async appendIfSequence(
		expectedSequence: number,
		record: DaemonBoostWalRecord,
	): Promise<"appended" | "conflict"> {
		const actual = this.records.at(-1)?.sequence ?? 0;
		if (actual !== expectedSequence) {
			return "conflict";
		}
		this.records.push(structuredClone(record));
		return "appended";
	}
}

function record(
	overrides: Partial<QBoostControlRecord> = {},
): QBoostControlRecord {
	return {
		schemaVersion: 2,
		protocol: "boost",
		teamId: Q_BOOST_TEAM_ID,
		enablementId: "enablement-test",
		principalIssuerId: "principal-test",
		mappingVersion: 7,
		rollbackVersion: 3,
		baselineLogicalKey: Q_BOOST_BASELINE_KEY,
		leaseLogicalKey: Q_BOOST_LEASE_KEY,
		maximumYields: 1,
		expiresAt: 20_000,
		revision: 1,
		enabled: true,
		signatureStatus: "verified",
		ownershipStatus: "principal-owned",
		residencyEvidence: "external-eligible",
		...overrides,
	};
}

function createSource(value: QBoostControlRecord | undefined): {
	readonly source: QBoostControlRecordSource;
	readonly unsubscribes: { value: number };
	emit(revision: QBoostControlRevision): Promise<void>;
} {
	const listeners = new Set<
		(revision: QBoostControlRevision) => Promise<void>
	>();
	const unsubscribes = { value: 0 };
	return {
		source: {
			resolve: async () => value,
			subscribe: (listener) => {
				listeners.add(listener);
				return {
					unsubscribe: () => {
						unsubscribes.value += 1;
						listeners.delete(listener);
					},
				};
			},
		},
		unsubscribes,
		emit: async (revision) => {
			for (const listener of listeners) {
				await listener(revision);
			}
		},
	};
}

function createInput(control: QBoostControlRecord | undefined): {
	readonly audit: LiveBoostAuditRecord[];
	readonly baseline: ReturnType<typeof vi.fn>;
	readonly input: ProductionQBoostHostInput;
	readonly provider: ReturnType<typeof vi.fn>;
	readonly source: ReturnType<typeof createSource>;
	readonly wal: MemoryWal;
} {
	const audit: LiveBoostAuditRecord[] = [];
	const baseline = vi.fn(async () => undefined);
	const provider = vi.fn(async () => ({
		leaseId: "lease-test",
		activationGeneration: 1,
		outcome: "visible" as const,
		humanVisible: true,
	}));
	const source = createSource(control);
	const wal = new MemoryWal();
	return {
		audit,
		baseline,
		provider,
		source,
		wal,
		input: {
			contract: getReviewedBoostContractIdentity(),
			control: {
				reference: {
					teamId: Q_BOOST_TEAM_ID,
					enablementId: "enablement-test",
					mappingVersion: 7,
					rollbackVersion: 3,
					baselineLogicalKey: Q_BOOST_BASELINE_KEY,
					leaseLogicalKey: Q_BOOST_LEASE_KEY,
				},
				source: source.source,
				principalIssuerId: "principal-test",
			},
			wal,
			now: () => 10_000,
			nextLeaseId: () => "lease-test",
			governance: { classify: async () => "public" },
			provider: { dispatch: provider },
			baseline: { restore: baseline },
			audit: {
				append: async (entry) => {
					audit.push(entry);
				},
			},
			shutdownChoice: "synchronous-restore",
		},
	};
}

function createFakeApi(): {
	readonly api: ExtensionAPI;
	readonly commands: Map<string, CommandDefinition>;
	readonly notifications: string[];
} {
	const commands = new Map<string, CommandDefinition>();
	const notifications: string[] = [];
	const api: FakeExtensionApi = {
		registerTool() {},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerShortcut() {},
		registerFlag() {},
		on() {},
		getFlag() {
			return undefined;
		},
		sendMessage() {},
		sendUserMessage() {},
	};
	return { api: api as unknown as ExtensionAPI, commands, notifications };
}

function createContext(notifications: string[]): ExtensionCommandContext {
	return {
		cwd: "/workspace/test",
		sessionManager: { getSessionId: () => "principal-test" },
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionCommandContext;
}

describe("production Q boost host", () => {
	it("constructs cold from a valid Q control without provider or WAL mutation", async () => {
		const fixture = createInput(record());

		const host = await createProductionQBoostHost(fixture.input);
		host.extension(createFakeApi().api);

		expect(fixture.provider).not.toHaveBeenCalled();
		expect(fixture.wal.records).toEqual([]);
	});

	it("runs a controlled valid fixture with redacted audit only", async () => {
		const fixture = createInput(record());
		const host = await createProductionQBoostHost(fixture.input);
		const fake = createFakeApi();
		host.extension(fake.api);
		const command = fake.commands.get("boost");
		if (!command) {
			throw new Error("Missing boost command");
		}

		await command.handler(
			"review this public fixture",
			createContext(fake.notifications),
		);

		expect(fixture.provider).toHaveBeenCalledTimes(1);
		expect(fixture.wal.records.map((entry) => entry.action)).toEqual([
			"reserve",
			"activate",
			"consume",
			"release",
		]);
		expect(JSON.stringify(fixture.audit)).not.toContain(
			"review this public fixture",
		);
		expect(JSON.stringify(fixture.audit)).not.toMatch(
			/token|provider|credential/i,
		);
	});

	it.each([
		async () => "denied" as const,
		async () => {
			throw new Error("governance unavailable");
		},
	])("releases the reserved slot after governance denial %#", async (classify) => {
		const fixture = createInput(record());
		const input: ProductionQBoostHostInput = {
			...fixture.input,
			governance: { classify },
		};
		const host = await createProductionQBoostHost(input);
		const fake = createFakeApi();
		host.extension(fake.api);
		const command = fake.commands.get("boost");
		if (!command) {
			throw new Error("Missing boost command");
		}

		await command.handler(
			"review this public fixture",
			createContext(fake.notifications),
		);
		await command.handler(
			"review this second public fixture",
			createContext(fake.notifications),
		);

		expect(fixture.provider).not.toHaveBeenCalled();
		expect(fixture.wal.records.map((entry) => entry.action)).toEqual([
			"reserve",
			"release",
			"reserve",
			"release",
		]);
	});

	it("cancels and reverts an active lease after a Q revoke revision", async () => {
		const fixture = createInput(record());
		fixture.provider.mockImplementation(
			async (request, signal) =>
				new Promise((resolve) => {
					signal.addEventListener(
						"abort",
						() =>
							resolve({
								leaseId: request.leaseId,
								activationGeneration: request.activationGeneration,
								outcome: "cancelled",
								humanVisible: false,
							}),
						{ once: true },
					);
				}),
		);
		const host = await createProductionQBoostHost(fixture.input);
		const fake = createFakeApi();
		host.extension(fake.api);
		const command = fake.commands.get("boost");
		if (!command) {
			throw new Error("Missing boost command");
		}
		const pending = command.handler(
			"review this public fixture",
			createContext(fake.notifications),
		);
		await vi.waitFor(() => expect(fixture.provider).toHaveBeenCalledTimes(1));

		await fixture.source.emit({
			enablementId: "enablement-test",
			revision: 2,
			reason: "revoked",
		});
		await pending;

		expect(fixture.baseline).toHaveBeenCalledTimes(1);
		expect(fixture.source.unsubscribes.value).toBe(1);
		expect(fixture.wal.records.map((entry) => entry.action)).toEqual([
			"reserve",
			"activate",
			"revoking",
			"release",
		]);
		expect(fixture.audit.map((entry) => entry.phase)).toEqual(["revoked"]);
	});

	it("exposes no provider construction, configuration, or Q-write seam", () => {
		const source = readFileSync(
			"extensions/pi-boost/production-q-boost-host.ts",
			"utf8",
		);
		expect(source).not.toMatch(
			/process\.env|apiKey|credential|configPath|defaultModel|scheduler|\.write\(|\.update\(|\.mutate\(/i,
		);
	});

	it("denies disabled Q control before provider or WAL use", async () => {
		const fixture = createInput(record({ enabled: false }));
		const host = await createProductionQBoostHost(fixture.input);
		const fake = createFakeApi();
		host.extension(fake.api);
		const command = fake.commands.get("boost");
		if (!command) {
			throw new Error("Missing boost command");
		}

		await command.handler(
			"review this public diff",
			createContext(fake.notifications),
		);

		expect(fixture.provider).not.toHaveBeenCalled();
		expect(fixture.wal.records).toEqual([]);
		expect(fake.notifications.join(" ")).toContain("runtime unavailable");
	});
});
