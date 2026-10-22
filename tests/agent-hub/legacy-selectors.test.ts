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
import { makeAgentRecord } from "./helpers.js";

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
