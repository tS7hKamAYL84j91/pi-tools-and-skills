/**
 * Legacy selector compatibility after namespace activation.
 *
 * A restarted Fusion sidekick now registers with BOTH a parent namespace and a
 * trusted spawn name (CoAS injects PI_PANOPTICON_NAMESPACE and
 * PI_PANOPTICON_SPAWN_NAME). Existing pairs/helpers address each other by the
 * bare sidekick/helper name, so that must keep working, while a namespaced
 * record must never capture the lead's bare label. These tests pin the actual
 * registered shape, not just the resolver in isolation.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { findAgentByDisplayName } from "../../lib/agent-names.js";
import Registry from "../../extensions/pi-agent-hub/registry/registry.js";
import { parentNamespaceAnchor } from "../../extensions/pi-agent-hub/spawner/spawner-launch.js";
import { loadNamespaceOwners } from "../../extensions/pi-agent-hub/registry/namespace-ownership.js";
import { resolvePeer } from "../../extensions/pi-agent-hub/registry/peers.js";
import { makeAgentRecord, makeRegistry } from "./helpers.js";

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../../lib/agent-registry.js", async (original) => ({
	...await original<typeof import("../../lib/agent-registry.js")>(),
	get REGISTRY_DIR() { return paths.registry; },
	ensureRegistryDir: () => mkdirSync(paths.registry, { recursive: true, mode: 0o700 }),
	reapOrphanedMailboxes: () => ({ removed: 0 }),
}));

const ENV_KEYS = [
	"PI_PANOPTICON_NAMESPACE",
	"PI_PANOPTICON_PARENT_ID",
	"PI_PANOPTICON_SPAWN_NAME",
	"PI_PANOPTICON_VISIBILITY",
] as const;

let savedEnv: Record<string, string | undefined>;
const tempDirs: string[] = [];
const registries: Registry[] = [];

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

function makeProject(panopticonName: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-legacy-project-"));
	tempDirs.push(dir);
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(
		join(dir, ".pi", "settings.json"),
		JSON.stringify({ automationsProfile: { panopticonName } }),
	);
	return dir;
}

function writePeerRecord(record: Partial<AgentRecord> & { id: string; name: string }): void {
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

beforeEach(() => {
	paths.registry = mkdtempSync(join(tmpdir(), "pi-legacy-registry-"));
	tempDirs.push(paths.registry);
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const registry of registries.splice(0)) registry.unregister();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	process.chdir("/tmp");
});

describe("legacy selectors after namespace activation", () => {
	it("a restarted sidekick keeps its bare name reachable and is namespaced", () => {
		const project = makeProject("lead-agent");
		process.env.PI_PANOPTICON_SPAWN_NAME = "lead-agent-sidekick";
		process.env.PI_PANOPTICON_NAMESPACE = "lead-agent";
		process.chdir(project);

		const registry = new Registry("9001-side", () => undefined);
		registries.push(registry);
		registry.register(makeContext(project));

		const self = registry.getRecord();
		expect(self?.name).toBe("lead-agent-sidekick");
		expect(self?.spawn_name).toBe("lead-agent-sidekick");
		expect(self?.namespace).toBe("lead-agent");
		expect(self?.name_source).toBe("spawn");

		const peers = [...registry.readAllPeers().filter((p) => p.id !== self?.id), ...(self ? [self] : [])];
		// Existing pairs still address the sidekick by its bare name.
		expect(findAgentByDisplayName(peers, "lead-agent-sidekick")?.id).toBe(self?.id);
		// New code can address it per-lead.
		expect(findAgentByDisplayName(peers, "lead-agent/lead-agent-sidekick")?.id).toBe(self?.id);
		// The lead's own label is not captured by the sidekick.
		expect(findAgentByDisplayName(peers, "lead-agent")).toBeUndefined();
	});

	it("a lead resuming a stale session alias still reserves its declared canonical label", async () => {
		const project = makeProject("canonical-lead");
		process.chdir(project);
		// The resumed session carries an older display alias.
		const registry = new Registry("9000-lead", () => "stale-alias");
		registries.push(registry);
		registry.register(makeContext(project));
		const record = registry.getRecord();

		expect(record?.name).toBe("stale-alias");
		expect(record?.declared_name).toBe("canonical-lead");
		await registry.awaitOwnershipWrite();
		const owners = loadNamespaceOwners();
		expect(owners.some((entry) => entry.name === "canonical-lead" && entry.ownerId === "9000-lead")).toBe(true);

		// Children keep the canonical anchor, not the display alias.
		expect(parentNamespaceAnchor(record ?? undefined)).toBe("canonical-lead");
		// A helper can still address the lead by its canonical label while the
		// lead displays the resumed session alias.
		const helperSelf = makeAgentRecord({ id: "9000-helper", name: "helper-x", namespace: "canonical-lead" });
		const leadRecord = makeAgentRecord({ id: "9000-lead", name: "stale-alias", declared_name: "canonical-lead" });
		const reg = makeRegistry(helperSelf, [helperSelf, leadRecord]);
		expect(resolvePeer(reg, "canonical-lead")?.id).toBe("9000-lead");
	});

	it("refuses to store a spawn alias that names another owner's reserved lead", () => {
		const project = makeProject("lead-agent");
		const journal = join(paths.registry, "namespace-owners.json");
		writeFileSync(
			journal,
			JSON.stringify({
				version: 1,
				owners: [{ name: "coas", ownerId: "coas-root", cwd: "/home/jim/git/coas", createdAt: 1, lastSeenAt: 1 }],
			}),
			{ mode: 0o600 },
		);
		// A helper asks to be called "coas" (a reserved lead label) while that
		// lead is down, and carries its own namespace.
		process.env.PI_PANOPTICON_SPAWN_NAME = "coas";
		process.env.PI_PANOPTICON_NAMESPACE = "other-lead";
		process.env.PI_PANOPTICON_PARENT_ID = "999-parent";
		process.chdir(project);

		const registry = new Registry("9003-h", () => undefined);
		registries.push(registry);
		registry.register(makeContext(project));
		const record = registry.getRecord();

		// Active name is suffixed away from the reserved label; the raw alias is
		// not stored, so "coas" can never route to the helper.
		expect(record).toMatchObject({ name: "coas-2", namespace: "other-lead", name_source: "spawn" });
		expect(record?.spawn_name).toBeUndefined();
		const peers = [...registry.readAllPeers().filter((p) => p.id !== record?.id), ...(record ? [record] : [])];
		expect(findAgentByDisplayName(peers, "coas")).toBeUndefined();
		expect(findAgentByDisplayName(peers, "other-lead/coas-2")?.id).toBe(record?.id);
	});

	it("drops a spawn alias that collided with a live peer", () => {
		writePeerRecord({ id: "9004-live", name: "researcher" });
		process.env.PI_PANOPTICON_SPAWN_NAME = "researcher";
		process.chdir(paths.registry);

		const registry = new Registry("9005-h", () => undefined);
		registries.push(registry);
		registry.register(makeContext(paths.registry));
		expect(registry.getRecord()).toMatchObject({ name: "researcher-2", name_source: "spawn" });
		expect(registry.getRecord()?.spawn_name).toBeUndefined();
	});

	it("keeps a claimable spawn name as a bare legacy alias even when namespaced", () => {
		// The restarted Fusion sidekick is namespaced but is still addressed by its
		// bare name by the running pair — that must keep working.
		const helper = makeAgentRecord({
			id: "9006-h",
			name: "api-builder",
			spawn_name: "api-builder",
			namespace: "lead-a",
			name_source: "spawn",
		});
		expect(findAgentByDisplayName([helper], "api-builder")).toBe(helper);
		expect(findAgentByDisplayName([helper], "lead-a/api-builder")).toBe(helper);

		// After a rename the qualified spawn alias still finds it.
		const renamed = makeAgentRecord({
			id: "9006-h",
			name: "renamed",
			spawn_name: "api-builder",
			namespace: "lead-a",
			name_source: "spawn",
		});
		expect(findAgentByDisplayName([renamed], "lead-a/api-builder")).toBe(renamed);
	});

	it("never exposes a bare alias equal to another record's lead label", () => {
		const leadA = makeAgentRecord({ id: "9007-a", name: "lead-a" });
		const leadB = makeAgentRecord({ id: "9008-b", name: "lead-b" });
		// Hand-written/legacy shape: a namespaced helper whose alias is lead-b's label.
		const squatter = makeAgentRecord({
			id: "9009-s",
			name: "helper",
			spawn_name: "lead-b",
			namespace: "lead-a",
		});

		const records = [leadA, leadB, squatter];
		expect(findAgentByDisplayName(records, "lead-b")).toBe(leadB);
		// With the lead absent, only the routing boundary (which also consults the
		// durable ownership journal) can prove "lead-b" is a lead label; the pure
		// resolver test above covers the record-visible anchor case.
	});

	it("a reserved lead label is not answered by a helper alias while the lead is down", () => {
		writeFileSync(
			join(paths.registry, "namespace-owners.json"),
			JSON.stringify({
				version: 1,
				owners: [{ name: "coas", ownerId: "coas-root", cwd: "/home/jim/git/coas", createdAt: 1, lastSeenAt: 1 }],
			}),
			{ mode: 0o600 },
		);
		const squatter = makeAgentRecord({
			id: "9010-s",
			name: "helper",
			spawn_name: "coas",
			namespace: "lead-a",
		});
		const self = makeAgentRecord({ id: "9012-self", name: "some-peer" });
		const registry = makeRegistry(self, [self, squatter]);

		expect(resolvePeer(registry, "coas")).toBeUndefined();
		expect(resolvePeer(registry, "lead-a/helper")?.id).toBe(squatter.id);

		// The real lead (namespace-less, canonical name) still resolves when it runs.
		const lead = makeAgentRecord({ id: "9011-lead", name: "coas" });
		const withLead = makeRegistry(self, [self, squatter, lead]);
		expect(resolvePeer(withLead, "coas")?.id).toBe(lead.id);
	});

	it("a pre-upgrade fusion peer without namespace still resolves by bare name", () => {
		// Shape written by the old launcher: no namespace, no spawn_name.
		writePeerRecord({ id: "9002-old", name: "old-sidekick", name_source: "generated" });
		const records = [makeAgentRecord({ id: "9002-old", name: "old-sidekick", name_source: "generated" })];

		expect(findAgentByDisplayName(records, "old-sidekick")?.id).toBe("9002-old");
	});

	it("same-named helpers across leads need the qualified selector", () => {
		const a = makeAgentRecord({
			id: "9101-a",
			name: "researcher",
			spawn_name: "researcher",
			namespace: "lead-a",
		});
		const b = makeAgentRecord({
			id: "9102-b",
			name: "researcher",
			spawn_name: "researcher",
			namespace: "lead-b",
		});

		// Ambiguous bare spawn name: no guessing.
		expect(findAgentByDisplayName([a, b], "researcher")).toBeUndefined();
		expect(findAgentByDisplayName([a, b], "lead-a/researcher")).toBe(a);
		expect(findAgentByDisplayName([a, b], "lead-b/researcher")).toBe(b);
	});

	it("a legacy plain helper keeps winning its own bare label", () => {
		const legacy = makeAgentRecord({ id: "9201-l", name: "researcher", name_source: "generated" });
		const namespaced = makeAgentRecord({
			id: "9202-n",
			name: "researcher",
			spawn_name: "researcher",
			namespace: "lead-a",
		});

		expect(findAgentByDisplayName([legacy, namespaced], "researcher")).toBe(legacy);
		expect(findAgentByDisplayName([legacy, namespaced], "lead-a/researcher")).toBe(namespaced);
	});
});
