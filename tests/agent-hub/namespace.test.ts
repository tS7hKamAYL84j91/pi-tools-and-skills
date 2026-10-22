/**
 * Namespace + canonical-ownership tests for pi-agent-hub.
 *
 * Covers the registry/namespace contract: declared canonical names, parent
 * namespace inheritance, durable lead ownership, rename-impersonation
 * rejection, legacy migration, and negative routing invariants.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { normalizeNamespace } from "../../lib/agent-registry.js";
import { assertSafeAgentId, ensurePiInbox } from "../../lib/transports/maildir.js";
import { readDeclaredName } from "../../extensions/pi-agent-hub/registry/declared-name.js";
import {
	loadNamespaceOwners,
	ownershipJournalPath,
	recordDeclaredOwnership,
	reservedNamesFor,
} from "../../extensions/pi-agent-hub/registry/namespace-ownership.js";
import {
	pickActiveName,
} from "../../extensions/pi-agent-hub/registry/record-utils.js";
import Registry from "../../extensions/pi-agent-hub/registry/registry.js";
import {
	parentNamespaceAnchor,
} from "../../extensions/pi-agent-hub/spawner/spawner-launch.js";
import {
	agentDisplayName,
	findAgentByDisplayName,
} from "../../lib/agent-names.js";
import { canSee } from "../../extensions/pi-agent-hub/registry/visibility.js";
import { getSelfName } from "../../extensions/pi-agent-hub/registry/peers.js";
import { makeAgentRecord, makeRegistry } from "./helpers.js";

// ── Registry-dir isolation (same pattern as registry-persistence.test.ts) ──

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../../lib/agent-registry.js", async (original) => ({
	...await original<typeof import("../../lib/agent-registry.js")>(),
	get REGISTRY_DIR() { return paths.registry; },
	ensureRegistryDir: () => mkdirSync(paths.registry, { recursive: true, mode: 0o700 }),
	reapOrphanedMailboxes: () => ({ removed: 0 }),
}));

const ENV_KEYS = {
	namespace: "PI_PANOPTICON_NAMESPACE",
	parent: "PI_PANOPTICON_PARENT_ID",
	spawn: "PI_PANOPTICON_SPAWN_NAME",
	visibility: "PI_PANOPTICON_VISIBILITY",
} as const;

let savedEnv: Record<string, string | undefined>;
const tempDirs: string[] = [];

function makeContext(cwd = "/tmp"): ExtensionContext {
	return {
		cwd,
		hasUI: false,
		isIdle: () => true,
		sessionManager: {
			getSessionDir: () => join(cwd, "sessions"),
			getSessionFile: () => join(cwd, "sessions", "s.jsonl"),
			getEntries: () => [],
		},
	} as unknown as ExtensionContext;
}

function writePeerRecord(record: Partial<AgentRecord> & { id: string; name: string }): void {
	// 0o600 — private-local-mode rejects world-readable registry files.
	writeFileSync(
		join(paths.registry, `${record.id}.json`),
		JSON.stringify({
			pid: process.pid,
			cwd: "/tmp",
			model: "test/model",
			startedAt: Date.now() - 1000,
			heartbeat: Date.now(),
			status: "running",
			...record,
		}),
		{ mode: 0o600 },
	);
}

/**
 * Build a project dir. `profile` writes a .pi/settings.json with that
 * automationsProfile.panopticonName (invalid values exercise validation).
 */
function makeProject(profile?: { panopticonName?: unknown }): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-ns-project-"));
	tempDirs.push(dir);
	if (profile) {
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "settings.json"),
			JSON.stringify({ automationsProfile: profile }),
		);
	}
	return dir;
}

/** chdir into `dir`, returning a restore function. */
function chdirInto(dir: string): () => void {
	const previous = process.cwd();
	process.chdir(dir);
	return () => process.chdir(previous);
}

beforeEach(() => {
	paths.registry = mkdtempSync(join(tmpdir(), "pi-ns-registry-"));
	tempDirs.push(paths.registry);
	savedEnv = {};
	for (const key of Object.values(ENV_KEYS)) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	vi.useRealTimers();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── Namespace validation ─────────────────────────────────────────

describe("normalizeNamespace", () => {
	it("accepts canonical lead-style anchors", () => {
		expect(normalizeNamespace("eo-agent-comms-gm")).toBe("eo-agent-comms-gm");
		expect(normalizeNamespace("  Lead.One  ")).toBe("lead.one");
	});

	it("rejects traversal-shaped and malformed claims", () => {
		for (const bad of [
			"",
			"   ",
			"..",
			"../evil",
			"a/b",
			"a\\b",
			"sub/dir/../../x",
			"-lead",
			"lead-",
			".lead",
			"lead.",
			"a..b",
			"x".repeat(65),
			"ünïcode",
		]) {
			expect(normalizeNamespace(bad), `expected rejection: ${JSON.stringify(bad)}`).toBeUndefined();
		}
	});

	it("rejects undefined/empty input", () => {
		expect(normalizeNamespace(undefined)).toBeUndefined();
	});
});

// ── Declared canonical name ───────────────────────────────────────

describe("readDeclaredName", () => {
	it("reads the declared panopticon name from project settings", () => {
		const project = makeProject({ panopticonName: "eo-agent-comms-gm" });
		expect(readDeclaredName(project)).toBe("eo-agent-comms-gm");
	});

	it("returns undefined without settings, profile, or valid name", () => {
		const bare = mkdtempSync(join(tmpdir(), "pi-ns-bare-"));
		tempDirs.push(bare);
		expect(readDeclaredName(bare)).toBeUndefined();
		expect(readDeclaredName(makeProject({ panopticonName: "../invalid name!" }))).toBeUndefined();
		expect(readDeclaredName(makeProject({ panopticonName: 123 }))).toBeUndefined();
		expect(readDeclaredName(makeProject({}))).toBeUndefined();
		const arrayProfile = mkdtempSync(join(tmpdir(), "pi-ns-arr-"));
		tempDirs.push(arrayProfile);
		mkdirSync(join(arrayProfile, ".pi"), { recursive: true });
		writeFileSync(
			join(arrayProfile, ".pi", "settings.json"),
			JSON.stringify({ automationsProfile: ["not", "an", "object"] }),
		);
		expect(readDeclaredName(arrayProfile)).toBeUndefined();
	});
});

// ── pickActiveName precedence and claim guards ────────────────────

describe("pickActiveName with declared and reserved names", () => {
	const base = { cwd: "/x/proj", records: [] as AgentRecord[], selfId: "self" };

	it("prefers a claimable session name", () => {
		expect(
			pickActiveName({ ...base, sessionName: "user-name", spawnName: "spawned", declaredName: "declared" }),
		).toEqual({ name: "user-name", source: "user" });
	});

	it("falls past a taken session name to the spawn name", () => {
		const records = [makeAgentRecord({ id: "other", name: "user-name" })];
		expect(
			pickActiveName({ ...base, records, sessionName: "user-name", spawnName: "spawned" }),
		).toEqual({ name: "spawned", source: "spawn" });
	});

	it("spawned agents never fall through to the project's declared lead label", () => {
		const records = [makeAgentRecord({ id: "other", name: "spawned" })];
		expect(
			pickActiveName({ ...base, records, spawnName: "spawned", declaredName: "the-lead" }),
		).toEqual({ name: "spawned-2", source: "spawn" });
	});

	it("root agents adopt the declared name", () => {
		expect(pickActiveName({ ...base, declaredName: "the-lead" })).toEqual({
			name: "the-lead",
			source: "declared",
		});
	});

	it("suffixes the declared name when another agent holds it", () => {
		const records = [makeAgentRecord({ id: "other", name: "the-lead" })];
		expect(pickActiveName({ ...base, records, declaredName: "the-lead" })).toEqual({
			name: "the-lead-2",
			source: "generated",
		});
	});

	it("never picks a reserved lead label, even when no live agent holds it", () => {
		expect(
			pickActiveName({ ...base, sessionName: "eo-lead", reservedNames: ["eo-lead"] }),
		).toEqual({ name: "proj", source: "generated" });
		expect(
			pickActiveName({ ...base, declaredName: "eo-lead", reservedNames: ["eo-lead"] }),
		).toEqual({ name: "eo-lead-2", source: "generated" });
		expect(
			pickActiveName({ ...base, spawnName: "eo-lead", reservedNames: ["eo-lead"] }),
		).toEqual({ name: "eo-lead-2", source: "spawn" });
	});

	it("keeps legacy behaviour without declared/reserved inputs", () => {
		expect(pickActiveName({ ...base, spawnName: "spawned" })).toEqual({
			name: "spawned",
			source: "spawn",
		});
		expect(pickActiveName({ ...base })).toEqual({ name: "proj", source: "generated" });
	});
});

// ── Registry: namespace capture and name claiming ─────────────────

describe("Registry namespace + declared-name capture", () => {
	it("captures a valid inherited namespace with source env", () => {
		process.env[ENV_KEYS.namespace] = "eo-agent-comms-gm";
		process.env[ENV_KEYS.parent] = "999-parent";
		process.env[ENV_KEYS.spawn] = "researcher";
		process.env[ENV_KEYS.visibility] = "scoped";
		vi.useFakeTimers();
		const registry = new Registry("1001-child", () => undefined);
		registry.register(makeContext());
		expect(registry.getRecord()).toMatchObject({
			namespace: "eo-agent-comms-gm",
			namespace_source: "env",
			parentId: "999-parent",
			name: "researcher",
			name_source: "spawn",
			visibility: "scoped",
		});
		registry.unregister();
	});

	it("drops invalid namespace claims instead of trusting them", () => {
		process.env[ENV_KEYS.namespace] = "../evil/x";
		vi.useFakeTimers();
		const registry = new Registry("1002-child", () => undefined);
		registry.register(makeContext());
		const record = registry.getRecord();
		expect(record?.namespace).toBeUndefined();
		expect(record?.namespace_source).toBeUndefined();
		registry.unregister();
	});

	it("adopts the declared panopticon name for root agents", () => {
		const project = makeProject({ panopticonName: "eo-agent-comms-gm" });
		const restoreCwd = chdirInto(project);
		try {
			vi.useFakeTimers();
			const registry = new Registry("2001-lead", () => undefined);
			registry.register(makeContext(project));
			expect(registry.getRecord()).toMatchObject({
				name: "eo-agent-comms-gm",
				name_source: "declared",
			});
			expect(registry.getRecord()?.namespace).toBeUndefined();
			registry.unregister();
		} finally {
			restoreCwd();
		}
	});

	it("registers a supporting agent without the lead's declared label even in the lead's project", () => {
		const project = makeProject({ panopticonName: "eo-agent-comms-gm" });
		const restoreCwd = chdirInto(project);
		try {
			// Fusion-sidekick launch shape: spawn name + inherited namespace env
			// from the trusted launcher, inside the lead's own workspace.
			process.env[ENV_KEYS.spawn] = "eo-agent-comms-gm-sidekick";
			process.env[ENV_KEYS.namespace] = "eo-agent-comms-gm";
			vi.useFakeTimers();
			const registry = new Registry("2002-child", () => undefined);
			registry.register(makeContext(project));
			expect(registry.getRecord()).toMatchObject({
				name: "eo-agent-comms-gm-sidekick",
				name_source: "spawn",
				namespace: "eo-agent-comms-gm",
				namespace_source: "env",
			});
			registry.unregister();
		} finally {
			restoreCwd();
		}
	});

	it("refuses renames onto live peers' names and reserved lead labels", () => {
		vi.useFakeTimers();
		const registry = new Registry("2003-self", () => undefined);
		registry.register(makeContext());
		registry.setName("own-name", "programmatic");

		writePeerRecord({ id: "3001-peer", name: "live-peer" });
		expect(registry.canClaimName("live-peer")).toBe(false);
		expect(registry.setName("live-peer", "programmatic")).toBe(false);
		expect(registry.getRecord()?.name).toBe("own-name");

		writeFileSync(
			ownershipJournalPath(),
			JSON.stringify({
				version: 1,
				owners: [{ name: "eo-lead", ownerId: "someone-else", cwd: "/other", createdAt: 1, lastSeenAt: 1 }],
			}),
		);
		expect(registry.canClaimName("eo-lead")).toBe(false);
		expect(registry.canClaimName("eo-LEAD")).toBe(false);
		expect(registry.setName("eo-lead", "programmatic")).toBe(false);
		expect(registry.getRecord()?.name).toBe("own-name");

		expect(registry.canClaimName("free-name")).toBe(true);
		expect(registry.setName("free-name", "programmatic")).toBe(true);
		expect(registry.getRecord()?.name).toBe("free-name");
		registry.unregister();
	});

	it("lets an agent re-claim its own reserved label and the project's declared label", () => {
		vi.useFakeTimers();
		const registry = new Registry("2004-lead", () => undefined);
		registry.register(makeContext());
		writeFileSync(
			ownershipJournalPath(),
			JSON.stringify({
				version: 1,
				owners: [{ name: "eo-lead", ownerId: "2004-lead", cwd: "/x", createdAt: 1, lastSeenAt: 1 }],
			}),
		);
		expect(registry.canClaimName("eo-lead")).toBe(true);
		registry.unregister();
	});

	it("self-heals a session-name claim after the blocking peer dies", () => {
		vi.useFakeTimers();
		writePeerRecord({ id: "3002-peer", name: "wanted-name" });
		let sessionName: string | undefined;
		const registry = new Registry("2005-self", () => sessionName);
		sessionName = "wanted-name";
		registry.register(makeContext());
		const fallback = registry.getRecord()?.name;
		expect(fallback).not.toBe("wanted-name");

		rmSync(join(paths.registry, "3002-peer.json"));
		vi.advanceTimersByTime(5000);
		expect(registry.getRecord()?.name).toBe("wanted-name");
		expect(registry.getRecord()?.name_source).toBe("user");
		registry.unregister();
	});

	it("keeps the namespace field stable across heartbeats (legacy spread preserves it)", () => {
		process.env[ENV_KEYS.namespace] = "eo-lead";
		vi.useFakeTimers();
		const registry = new Registry("2006-child", () => undefined);
		registry.register(makeContext());
		vi.advanceTimersByTime(15_000);
		expect(registry.getRecord()?.namespace).toBe("eo-lead");
		registry.unregister();
	});
});

// ── set_name tool ─────────────────────────────────────────────────

describe("set_name tool impersonation guards", () => {
	interface RegisteredTool {
		name: string;
		execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
	}

	function makeNameApi() {
		const api = {
			setSessionName: vi.fn(),
			getSessionName: vi.fn(() => undefined),
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
		};
		const tools = new Map<string, RegisteredTool>();
		api.registerTool.mockImplementation((def: RegisteredTool) => {
			tools.set(def.name, def);
		});
		return { api, tools };
	}

	function toolResult(result: unknown): { text: string; details: Record<string, unknown> } {
		const value = result as { content: Array<{ text: string }>; details: Record<string, unknown> };
		return { text: value.content[0]?.text ?? "", details: value.details ?? {} };
	}

	async function setupNameTool() {
		const { registerNameControls } = await import("../../extensions/pi-agent-hub/ui/name-controls.js");
		const { api, tools } = makeNameApi();
		vi.useFakeTimers();
		const registry = new Registry("4001-helper", () => undefined);
		registry.register(makeContext());
		registerNameControls(api as never, registry);
		const tool = tools.get("set_name");
		if (!tool) throw new Error("set_name tool was not registered");
		return { registry, api, tool };
	}

	it("rejects taking a live lead's name and does not touch the session name", async () => {
		const { registry, api, tool } = await setupNameTool();
		writePeerRecord({ id: "4002-lead", name: "eo-lead" });

		const result = toolResult(await tool.execute("t1", { name: "eo-lead" }));
		expect(result.details).toMatchObject({ reason: "name_taken" });
		expect(api.setSessionName).not.toHaveBeenCalled();
		expect(registry.getRecord()?.name).not.toBe("eo-lead");
		registry.unregister();
	});

	it("rejects reserved lead labels even with no live holder", async () => {
		const { registry, api, tool } = await setupNameTool();
		writeFileSync(
			ownershipJournalPath(),
			JSON.stringify({
				version: 1,
				owners: [{ name: "eo-lead", ownerId: "gone-lead", cwd: "/x", createdAt: 1, lastSeenAt: 1 }],
			}),
			{ mode: 0o600 },
		);
		const result = toolResult(await tool.execute("t1", { name: "eo-lead" }));
		expect(result.details).toMatchObject({ reason: "name_taken" });
		expect(api.setSessionName).not.toHaveBeenCalled();
		registry.unregister();
	});

	it("rejects unsafe names and accepts a free name", async () => {
		const { registry, api, tool } = await setupNameTool();

		const unsafe = toolResult(await tool.execute("t1", { name: "eo-lead/researcher" }));
		expect(unsafe.details).toMatchObject({ reason: "invalid_name" });
		expect(api.setSessionName).not.toHaveBeenCalled();

		const okResult = toolResult(await tool.execute("t2", { name: "fresh-name" }));
		expect(okResult.text).toContain("fresh-name");
		expect(api.setSessionName).toHaveBeenCalledWith("fresh-name");
		expect(registry.getRecord()?.name).toBe("fresh-name");
		registry.unregister();
	});
});

// ── Durable ownership journal ─────────────────────────────────────

describe("namespace ownership journal", () => {
	it("reservedNamesFor excludes self-owned and own-declared labels", () => {
		writeFileSync(
			ownershipJournalPath(),
			JSON.stringify({
				version: 1,
				owners: [
					{ name: "lead-a", ownerId: "me", cwd: "/a", createdAt: 1, lastSeenAt: 1 },
					{ name: "lead-b", ownerId: "other", cwd: "/b", createdAt: 1, lastSeenAt: 1 },
					{ name: "lead-c", ownerId: "other", cwd: "/c", createdAt: 1, lastSeenAt: 1 },
				],
			}),
		);
		expect(reservedNamesFor({ selfId: "me", takeoverName: "lead-c" })).toEqual(["lead-b"]);
		expect(reservedNamesFor({ selfId: "someone-else" })).toEqual(["lead-a", "lead-b", "lead-c"]);
	});

	it("merges ownership writes per label and survives malformed journals", async () => {
		writeFileSync(ownershipJournalPath(), "not json at all {");
		expect(loadNamespaceOwners()).toEqual([]);

		await recordDeclaredOwnership({
			name: "eo-lead",
			ownerId: "5001-lead",
			cwd: "/x",
			createdAt: 10,
			lastSeenAt: 10,
		});
		await recordDeclaredOwnership({
			name: "other-lead",
			ownerId: "5002-lead",
			cwd: "/y",
			createdAt: 20,
			lastSeenAt: 20,
		});
		await recordDeclaredOwnership({
			name: "EO-LEAD",
			ownerId: "5003-lead",
			cwd: "/x",
			createdAt: 30,
			lastSeenAt: 30,
		});

		const owners = loadNamespaceOwners();
		expect(owners.map((entry) => [entry.name, entry.ownerId])).toEqual([
			["EO-LEAD", "5003-lead"],
			["other-lead", "5002-lead"],
		]);

		const invalid = [
			{ name: "../evil", ownerId: "x", cwd: "/x", createdAt: 1, lastSeenAt: 1 },
			{ name: "ok-name", ownerId: 5, cwd: "/x", createdAt: 1, lastSeenAt: 1 },
			"not-an-entry",
		];
		writeFileSync(
			ownershipJournalPath(),
			JSON.stringify({ version: 1, owners: [...owners, ...invalid] }),
		);
		expect(loadNamespaceOwners().map((entry) => entry.name)).toEqual(["EO-LEAD", "other-lead"]);
	});

	it("declared registration journals the claim and blocks squatting after lead death", async () => {
		const project = makeProject({ panopticonName: "eo-lead" });
		const restoreCwd = chdirInto(project);
		try {
			vi.useFakeTimers();
			// Lead registers (declared) and journals its ownership.
			const lead = new Registry("6001-lead", () => undefined);
			lead.register(makeContext(project));
			expect(lead.getRecord()?.name).toBe("eo-lead");
			await lead.awaitOwnershipWrite();
			expect(loadNamespaceOwners()).toHaveLength(1);
			expect(loadNamespaceOwners()[0]).toMatchObject({ name: "eo-lead", ownerId: "6001-lead" });

			// Lead dies: record file gone, durable claim remains.
			lead.unregister();
			expect(readdirSync(paths.registry).some((f) => f.startsWith("6001-lead"))).toBe(false);
			expect(reservedNamesFor({ selfId: "6002-helper" })).toContain("eo-lead");

			// A spawned helper cannot take the dead lead's label (impersonation).
			process.env[ENV_KEYS.spawn] = "researcher";
			const helper = new Registry("6002-helper", () => "eo-lead");
			helper.register(makeContext(project));
			expect(helper.getRecord()?.name).toBe("researcher");
			expect(helper.canClaimName("eo-lead")).toBe(false);
			expect(helper.setName("eo-lead", "programmatic")).toBe(false);
			helper.unregister();
			delete process.env[ENV_KEYS.spawn];

			// The restarted lead re-claims its own label via the takeover right.
			const lead2 = new Registry("6003-lead", () => undefined);
			lead2.register(makeContext(project));
			expect(lead2.getRecord()).toMatchObject({ name: "eo-lead", name_source: "declared" });
			await lead2.awaitOwnershipWrite();
			expect(loadNamespaceOwners()[0]).toMatchObject({ name: "eo-lead", ownerId: "6003-lead" });
			lead2.unregister();
		} finally {
			restoreCwd();
		}
	});
});

// ── Qualified display names and routing ────────────────────────────

describe("namespaced display names and resolution", () => {
	const leadA = makeAgentRecord({ id: "lead0001", name: "eo-lead-a" });
	const leadB = makeAgentRecord({ id: "lead0002", name: "eo-lead-b" });
	const childA = makeAgentRecord({ id: "chld0001", name: "researcher", namespace: "eo-lead-a" });
	const childB = makeAgentRecord({ id: "chld0002", name: "researcher", namespace: "eo-lead-b" });
	const plain = makeAgentRecord({ id: "plain001", name: "researcher" });
	const records = [leadA, leadB, childA, childB, plain];

	it("qualifies namespaced records per lead", () => {
		expect(agentDisplayName(childA, records)).toBe("eo-lead-a/researcher");
		expect(agentDisplayName(leadA, records)).toBe("eo-lead-a");
	});

	it("resolves by qualified label and by bare name when unique", () => {
		expect(findAgentByDisplayName(records, "eo-lead-a/researcher")).toBe(childA);
		expect(findAgentByDisplayName(records, "@EO-LEAD-B/Researcher")).toBe(childB);
	});

	it("treats colliding bare names across leads as ambiguous without a plain holder", () => {
		expect(findAgentByDisplayName([leadA, leadB, childA, childB], "researcher")).toBeUndefined();
		// A plain record legitimately holding the exact bare name stays the
		// deterministic bare-name target; namespaced peers need qualified labels.
		expect(findAgentByDisplayName(records, "researcher")).toBe(plain);
	});

	it("keeps legacy resolution for records without namespaces", () => {
		const legacy = [leadA, plain];
		expect(findAgentByDisplayName(legacy, "researcher")).toBe(plain);
		expect(agentDisplayName(plain, legacy)).toBe("researcher");
	});

	it("normalises hand-crafted records with unsafe names instead of routing them", () => {
		// A raw record whose name equals a derived qualified label must never be
		// able to intercept that label: the volatile reader normalises it.
		writeFileSync(
			join(paths.registry, "evil0001.json"),
			JSON.stringify({
				id: "evil0001",
				name: "eo-lead-a/researcher",
				pid: process.pid,
				cwd: "/tmp/spoof",
				model: "test/model",
				startedAt: Date.now() - 1000,
				heartbeat: Date.now(),
				status: "running",
			}),
			{ mode: 0o600 },
		);
		const registry = new Registry("4009-self", () => undefined);
		registry.register(makeContext());
		const peers = registry.readAllPeers();
		const evil = peers.find((peer) => peer.id === "evil0001");
		expect(evil?.name).toBe("spoof");
		const childA = makeAgentRecord({ id: "chld0001", name: "researcher", namespace: "eo-lead-a" });
		expect(findAgentByDisplayName([...peers, childA], "eo-lead-a/researcher")).toBe(childA);
		registry.unregister();
	});

	it("a namespaced record never answers an unqualified selector equal to its lead's label", () => {
		// Squatting scenario: helper renamed itself to the (currently down)
		// lead's label and carries the lead's namespace. Neither its bare name
		// nor the lead's bare label may route to it; the qualified label does.
		const squatter = makeAgentRecord({ id: "sq000001", name: "gm", namespace: "gm" });
		expect(findAgentByDisplayName([squatter], "gm")).toBeUndefined();
		expect(findAgentByDisplayName([squatter], "gm/gm")).toBe(squatter);

		// With the real (namespace-less) lead present, its bare label is safe.
		const lead = makeAgentRecord({ id: "lead0001", name: "gm" });
		expect(findAgentByDisplayName([lead, squatter], "gm")).toBe(lead);
		expect(findAgentByDisplayName([lead, squatter], "gm/gm")).toBe(squatter);
	});

	it("reaches a renamed spawned agent via its immutable spawn_name", () => {
		const spawned = makeAgentRecord({ id: "sp000001", name: "renamed-2", spawn_name: "api-builder" });
		expect(findAgentByDisplayName([spawned], "api-builder")).toBe(spawned);
		const other = makeAgentRecord({ id: "sp000002", name: "api-builder" });
		expect(findAgentByDisplayName([spawned, other], "api-builder")).toBe(other);
	});

	it("prefers a trusted user/declared claim when a bare name collides", () => {
		const generated = makeAgentRecord({ id: "gen00001", name: "gm", name_source: "generated" });
		const userNamed = makeAgentRecord({ id: "usr00001", name: "gm", name_source: "user" });
		expect(findAgentByDisplayName([generated, userNamed], "gm")).toBe(userNamed);
		expect(findAgentByDisplayName([generated, makeAgentRecord({ id: "usr00002", name: "gm", name_source: "generated" })], "gm")).toBeUndefined();
	});

	it("suffixes duplicate qualified labels deterministically", () => {
		const twinA = makeAgentRecord({ id: "twin0001", name: "researcher", namespace: "eo-lead-a" });
		const all = [childA, twinA];
		expect(agentDisplayName(childA, all)).toBe("eo-lead-a/researcher#chld00");
		expect(agentDisplayName(twinA, all)).toBe("eo-lead-a/researcher#twin00");
	});
});

// ── Namespace is not permission ────────────────────────────────────

describe("namespace is not permission", () => {
	it("namespaced scoped children gain no visibility beyond existing rules", () => {
		const childA = makeAgentRecord({
			id: "8001-ca",
			name: "researcher",
			namespace: "eo-lead-a",
			parentId: "7001-a",
			visibility: "scoped",
		});
		const childB = makeAgentRecord({
			id: "8002-cb",
			name: "researcher",
			namespace: "eo-lead-b",
			parentId: "7002-b",
			visibility: "scoped",
		});
		const leadA = makeAgentRecord({ id: "7001-a", name: "eo-lead-a", visibility: "global" });
		const leadB = makeAgentRecord({ id: "7002-b", name: "eo-lead-b", visibility: "global" });

		expect(canSee(childA, leadA)).toBe(true);
		expect(canSee(childA, childB)).toBe(false);
		expect(canSee(childA, leadB)).toBe(false);
		expect(canSee(leadA, childA)).toBe(true);
		expect(canSee(leadB, childA)).toBe(true);
	});

	it("a namespaced helper cannot claim its own lead's name", () => {
		vi.useFakeTimers();
		process.env[ENV_KEYS.namespace] = "eo-lead";
		process.env[ENV_KEYS.parent] = "7001-a";
		process.env[ENV_KEYS.spawn] = "helper-x";
		process.env[ENV_KEYS.visibility] = "scoped";
		writePeerRecord({ id: "7001-a", name: "eo-lead" });
		const helper = new Registry("8003-h", () => undefined);
		helper.register(makeContext());
		expect(helper.getRecord()?.namespace).toBe("eo-lead");
		expect(helper.canClaimName("eo-lead")).toBe(false);
		expect(helper.setName("eo-lead", "programmatic")).toBe(false);
		expect(helper.getRecord()?.name).toBe("helper-x");
		helper.unregister();
	});
});

it("attributes sent messages with the namespace-qualified name", () => {
	const helper = makeRegistry(makeAgentRecord({ id: "9301-h", name: "helper-x", namespace: "eo-lead" }));
	expect(getSelfName(helper)).toBe("eo-lead/helper-x");
	const root = makeRegistry(makeAgentRecord({ id: "9302-r", name: "eo-lead" }));
	expect(getSelfName(root)).toBe("eo-lead");
});

// ── Spawn chain ────────────────────────────────────────────────────

describe("spawn namespace inheritance", () => {
	it("derives the child namespace anchor from the parent record, not the child name", () => {
		expect(parentNamespaceAnchor({ name: "eo-lead", namespace: undefined })).toBe("eo-lead");
		expect(parentNamespaceAnchor({ name: "mid", namespace: "eo-lead" })).toBe("eo-lead");
		expect(parentNamespaceAnchor(undefined)).toBeUndefined();
	});

	it("passes the namespace env to children alongside parent id and visibility", async () => {
		const { buildSpawnEnv } = await import("../../extensions/pi-agent-hub/spawner/spawner-launch.js");
		const env = buildSpawnEnv("9001-parent", "child-x", "task", "eo-lead");
		expect(env.PI_PANOPTICON_PARENT_ID).toBe("9001-parent");
		expect(env.PI_PANOPTICON_VISIBILITY).toBe("scoped");
		expect(env.PI_PANOPTICON_SPAWN_NAME).toBe("child-x");
		expect(env.PI_PANOPTICON_NAMESPACE).toBe("eo-lead");
		const envNoNs = buildSpawnEnv("9001-parent", "child-x", "task", undefined);
		expect("PI_PANOPTICON_NAMESPACE" in envNoNs).toBe(false);
	});
});

// ── Filesystem path safety + legacy migration ─────────────────────

describe("path safety and legacy migration", () => {
	it("never uses namespace labels in filesystem paths", () => {
		process.env[ENV_KEYS.namespace] = "eo-lead";
		vi.useFakeTimers();
		const registry = new Registry("9101-x", () => undefined);
		registry.register(makeContext());
		const inbox = ensurePiInbox("9101-x");
		expect(inbox.startsWith(paths.registry)).toBe(true);
		expect(inbox).not.toContain("eo-lead");
		expect(readdirSync(paths.registry)).toContain("9101-x.json");
		expect(ownershipJournalPath()).toBe(join(paths.registry, "namespace-owners.json"));
		expect(() => assertSafeAgentId("eo-lead/researcher")).toThrow();
		registry.unregister();
	});

	it("tolerates legacy records without namespace fields", () => {
		writePeerRecord({ id: "9201-legacy", name: "legacy-agent" });
		const registry = new Registry("9202-new", () => undefined);
		registry.register(makeContext());
		const peers = registry.readAllPeers();
		const legacy = peers.find((peer) => peer.id === "9201-legacy");
		expect(legacy).toMatchObject({ name: "legacy-agent" });
		expect(legacy?.namespace).toBeUndefined();
		registry.unregister();
	});

	it("resolves a legacy bare-name peer exactly as before", () => {
		writePeerRecord({ id: "9201-legacy", name: "legacy-agent" });
		const registry = new Registry("9203-new", () => undefined);
		registry.register(makeContext());
		const resolved = findAgentByDisplayName(registry.readAllPeers(), "legacy-agent");
		expect(resolved?.id).toBe("9201-legacy");
		registry.unregister();
	});
});