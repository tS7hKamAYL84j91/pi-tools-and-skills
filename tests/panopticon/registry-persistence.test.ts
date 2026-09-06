/** File-backed registry lifecycle with disposable storage and no live reaping. */
import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Registry from "../../extensions/pi-panopticon/registry/registry.js";
import { makeAgentRecord, makeMockContext } from "./helpers.js";

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../../lib/agent-registry.js", async (original) => ({
	...await original<typeof import("../../lib/agent-registry.js")>(),
	get REGISTRY_DIR() { return paths.registry; },
	ensureRegistryDir: () => mkdirSync(paths.registry, { recursive: true, mode: 0o700 }),
	reapOrphanedMailboxes: () => ({ removed: 0 }),
}));
let registry: Registry;
beforeEach(async () => {
	paths.registry = await mkdtemp(join(tmpdir(), "pi-file-registry-"));
	vi.useFakeTimers();
	registry = new Registry(`${process.pid}-fixture`, () => "native-fixture");
});
afterEach(async () => {
	registry.unregister();
	vi.useRealTimers();
	await rm(paths.registry, { recursive: true, force: true });
});

describe("file-backed registry", () => {
	it("persists registration, status and heartbeat and removes its own record on shutdown", async () => {
		registry.register(makeMockContext() as unknown as ExtensionContext);
		const path = join(paths.registry, `${registry.selfId}.json`);
		const first = JSON.parse(await readFile(path, "utf8"));
		expect(first).toMatchObject({ id: registry.selfId, name: "native-fixture", pid: process.pid, status: "waiting" });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		registry.setStatus("running");
		vi.advanceTimersByTime(5000);
		const current = JSON.parse(await readFile(path, "utf8"));
		expect(current.status).toBe("running");
		expect(current.heartbeat).toBeGreaterThan(first.heartbeat);
		registry.unregister();
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("merges validated external peers with native disk records", () => {
		registry.register(makeMockContext() as unknown as ExtensionContext);
		const external = makeAgentRecord({ id: "ext-fixture", name: "outside", kind: "external", pid: 0 });
		registry.setExternalPeers([external]);
		expect(registry.readAllPeers().map((record) => record.id)).toEqual([external.id, registry.selfId]);
		registry.setExternalPeers([]);
		expect(registry.readAllPeers().map((record) => record.id)).toEqual([registry.selfId]);
	});
});
