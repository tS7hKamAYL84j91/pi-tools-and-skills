/**
 * External-agent registration vs declared lead labels.
 *
 * External agents are namespace-less records on a designed operator-writable
 * manifest. These tests pin that a declared lead's reserved label (durable
 * namespace-ownership journal) cannot be claimed by an external registration
 * while the lead process is down and invisible in the peer snapshot, and that
 * the routing boundary never answers a reserved lead label with an external
 * record even if such a manifest entry exists (older registrar, hand repair).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadExternalAgents,
	registerExternalAgent,
} from "../../extensions/pi-agent-hub/registry/external-registrar.js";
import { resolvePeer } from "../../extensions/pi-agent-hub/registry/peers.js";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { makeAgentRecord, makeRegistry } from "./helpers.js";

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../../lib/agent-registry.js", async (original) => ({
	...await original<typeof import("../../lib/agent-registry.js")>(),
	get REGISTRY_DIR() {
		return paths.registry;
	},
	ensureRegistryDir: () => mkdirSync(paths.registry, { recursive: true, mode: 0o700 }),
	reapOrphanedMailboxes: () => ({ removed: 0 }),
}));

interface TestConfig {
	workspaceRoot: string;
	mailboxRoot: string;
}

function makeConfig(): TestConfig {
	const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-ext-lead-"));
	return { workspaceRoot, mailboxRoot: join(workspaceRoot, "mailboxes") };
}

function writeJournal(
	entries: Array<{ name: string; ownerId: string; ageHours?: number }>,
): void {
	mkdirSync(paths.registry, { recursive: true, mode: 0o700 });
	const now = Date.now();
	writeFileSync(
		join(paths.registry, "namespace-owners.json"),
		JSON.stringify({
			version: 1,
			owners: entries.map((entry) => {
				// Reserved entries do not expire: a claim's age is deliberately
				// irrelevant to the guard. Stale fixtures pin that invariant.
				const claimedAt = now - (entry.ageHours ?? 0) * 3_600_000;
				return {
					name: entry.name,
					ownerId: entry.ownerId,
					cwd: "/tmp/lead-project",
					createdAt: claimedAt,
					lastSeenAt: claimedAt,
				};
			}),
		}),
	);
}

function leadRecord(name: string): AgentRecord {
	return makeAgentRecord({ id: "430855-lead", name, kind: "pi", name_source: "declared" });
}

function externalRecord(name: string): AgentRecord {
	return makeAgentRecord({
		id: "ext-071b2c5a",
		name,
		kind: "external",
		pid: 0,
		model: "external",
		status: "waiting",
	});
}

function helperSelf(): AgentRecord {
	return makeAgentRecord({ id: "430999-helper", name: "sidekick" });
}

describe("external agents cannot claim declared lead labels", () => {
	let config: TestConfig;

	beforeEach(() => {
		config = makeConfig();
		paths.registry = join(config.workspaceRoot, "registry");
	});

	afterEach(() => {
		rmSync(config.workspaceRoot, { recursive: true, force: true });
	});

	it("refuses a journal-reserved lead label while the lead is down and invisible", async () => {
		writeJournal([{ name: "kaggle-enveda-casmi26-gm", ownerId: "431234-lost" }]);
		await expect(
			registerExternalAgent(config, { name: "Kaggle Enveda Casmi26 GM" }, []),
		).rejects.toThrow(/reserved for a declared lead/);
		// Fail closed: no partial registration is written.
		expect(await loadExternalAgents(config)).toEqual([]);
	});

	it("refuses a journal-reserved lead label whose claim is days stale (dormant lead)", async () => {
		// Reserved entries do not expire; the down-lead window must never depend
		// on claim freshness. Live shape 2026-10-26: bisecur-ios-gm down since
		// 10-24, its journal claim unrefreshable while the pane is dead — the
		// exact label an external registration must still not take.
		writeJournal([{ name: "bisecur-ios-gm", ownerId: "479035-mvmw", ageHours: 72 }]);
		await expect(
			registerExternalAgent(config, { name: "Bisecur iOS GM" }, []),
		).rejects.toThrow(/reserved for a declared lead/);
		expect(await loadExternalAgents(config)).toEqual([]);
	});

	it("refuses a case-variant display name that normalizes to the reserved label", async () => {
		writeJournal([{ name: "bisecur-ios-gm", ownerId: "479035-mvmw" }]);
		await expect(
			registerExternalAgent(config, { name: "BISECUR iOS GM" }, []),
		).rejects.toThrow(/reserved for a declared lead/);
	});

	it("still registers a fresh external name beside a reserved lead label", async () => {
		writeJournal([{ name: "bisecur-ios-gm", ownerId: "479035-mvmw" }]);
		const record = await registerExternalAgent(config, { name: "codex-client" }, []);
		expect(record.name).toBe("codex-client");
		expect(record.kind).toBe("external");
		expect(record.mailboxPath?.startsWith(config.mailboxRoot)).toBe(true);
		const loaded = await loadExternalAgents(config);
		expect(loaded.map((entry) => entry.name)).toEqual(["codex-client"]);
	});

	it("resolvePeer never answers a reserved lead label with an external record", () => {
		// Lead is down (its record is absent); a manifest entry carries its label.
		writeJournal([{ name: "kaggle-enveda-casmi26-gm", ownerId: "431234-lost" }]);
		const registry = makeRegistry(helperSelf(), [externalRecord("kaggle-enveda-casmi26-gm")]);
		expect(resolvePeer(registry, "kaggle-enveda-casmi26-gm")).toBeUndefined();
		expect(resolvePeer(registry, "@kaggle-enveda-casmi26-gm")).toBeUndefined();
	});

	it("resolvePeer never answers a stale-claimed lead label with an external record", () => {
		// Two-week-old claim, lead down, external manifest entry carries the
		// label: freshness filtering here would reopen the impersonation hole.
		writeJournal([
			{ name: "kaggle-enveda-casmi26-gm", ownerId: "431234-lost", ageHours: 24 * 14 },
		]);
		const registry = makeRegistry(helperSelf(), [externalRecord("kaggle-enveda-casmi26-gm")]);
		expect(resolvePeer(registry, "kaggle-enveda-casmi26-gm")).toBeUndefined();
	});

	it("a live lead still resolves its reserved label while an external record carries the same name", () => {
		writeJournal([{ name: "kaggle-enveda-casmi26-gm", ownerId: "430855-lead" }]);
		const registry = makeRegistry(helperSelf(), [
			leadRecord("kaggle-enveda-casmi26-gm"),
			externalRecord("kaggle-enveda-casmi26-gm"),
		]);
		const resolved = resolvePeer(registry, "kaggle-enveda-casmi26-gm");
		expect(resolved?.id).toBe("430855-lead");
		expect(resolved?.kind).toBe("pi");
	});

	it("a non-reserved external agent keeps resolving by its bare label", () => {
		const registry = makeRegistry(helperSelf(), [externalRecord("codex-client")]);
		const resolved = resolvePeer(registry, "codex-client");
		expect(resolved?.id).toBe("ext-071b2c5a");
		expect(resolved?.kind).toBe("external");
	});

	it("leaves no journal behind when the registry directory is unset", async () => {
		// The journal read must never create or mutate registry state on its own.
		paths.registry = join(config.workspaceRoot, "registry");
		await expect(registerExternalAgent(config, { name: "fresh-agent" }, [])).resolves.toBeTruthy();
		expect(existsSync(join(paths.registry, "namespace-owners.json"))).toBe(false);
	});
});