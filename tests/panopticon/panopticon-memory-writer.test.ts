import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSyntheticPanopticonMemory } from "../../extensions/pi-panopticon/ui/memory-renderer.js";
import { validatePanopticonMemorySnapshot, writePanopticonMemorySnapshot } from "../../extensions/pi-panopticon/ui/memory-writer.js";

let root: string;

function syntheticMemory(agentId = "agent-a"): string {
	return renderSyntheticPanopticonMemory({
		agent: {
			agentId,
			registryName: "worker-a",
			nameSource: "programmatic",
			pid: 123,
			cwd: "/tmp/workspace",
			model: "synthetic/model",
			status: "waiting",
			visibility: "scoped",
			startedAt: "2026-06-13T00:00:00.000Z",
			heartbeatAt: "2026-06-13T00:01:00.000Z",
			snapshotAt: "2026-06-13T00:02:00.000Z",
		},
		activityWindow: { count: 1, hash: "sha256:abc", from: "2026-06-13T00:00:00.000Z", to: "2026-06-13T00:02:00.000Z" },
		redaction: { policy: "synthetic" },
		currentState: "Synthetic state only.",
		activity: ["Synthetic bounded activity."],
		blockers: [],
		assumptions: [],
		artifacts: [],
		recovery: [],
		warnings: [],
	});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "panopticon-memory-writer-"));
	await writeFile(join(root, "panopticon-memory-manifest.json"), JSON.stringify({ allowMemoryPoc: true, rootType: "temp-panopticon-memory-poc" }), "utf8");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Panopticon MEMORY.md temp manifest writer POC", () => {
	it("atomically writes latest MEMORY.md behind an explicit temp manifest root", async () => {
		const content = syntheticMemory();

		const result = await writePanopticonMemorySnapshot({ manifestRoot: root, agentId: "agent-a", content });

		expect(result.memoryPath).toBe(join(root, "agents", "agent-a", "MEMORY.md"));
		await expect(readFile(result.memoryPath, "utf8")).resolves.toBe(content);
		await expect(validatePanopticonMemorySnapshot(result.memoryPath)).resolves.toMatchObject({ status: "ok" });
	});

	it("requires the explicit manifest gate and safe local agent ids", async () => {
		const otherRoot = await mkdtemp(join(tmpdir(), "panopticon-memory-no-manifest-"));
		try {
			await expect(writePanopticonMemorySnapshot({ manifestRoot: otherRoot, agentId: "agent-a", content: syntheticMemory() })).rejects.toThrow(/manifest/);
			await expect(writePanopticonMemorySnapshot({ manifestRoot: root, agentId: "../agent-a", content: syntheticMemory() })).rejects.toThrow(/agentId/);
		} finally {
			await rm(otherRoot, { recursive: true, force: true });
		}
	});

	it("applies terminal archive retention cleanup", async () => {
		for (const agentId of ["agent-a", "agent-a", "agent-a"]) {
			await writePanopticonMemorySnapshot({ manifestRoot: root, agentId, content: syntheticMemory(agentId), terminal: true, terminalRetain: 2 });
		}
		const final = await writePanopticonMemorySnapshot({ manifestRoot: root, agentId: "agent-a", content: syntheticMemory(), terminal: true, terminalRetain: 2 });

		expect(final.removedArchives.length).toBeGreaterThanOrEqual(1);
		const archiveDir = join(root, "agents", "agent-a", "memory", "archive");
		const files = await readdir(archiveDir);
		expect(files.filter((file) => file.endsWith(".md"))).toHaveLength(2);
	});

	it("reports corrupt, missing, and oversized snapshots without repair", async () => {
		const missing = join(root, "agents", "missing", "MEMORY.md");
		await expect(validatePanopticonMemorySnapshot(missing)).resolves.toMatchObject({ status: "missing" });

		const corrupt = join(root, "agents", "agent-a", "MEMORY.md");
		await mkdir(join(root, "agents", "agent-a"), { recursive: true });
		await writeFile(corrupt, "not memory", "utf8");
		await expect(validatePanopticonMemorySnapshot(corrupt)).resolves.toMatchObject({ status: "malformed" });
		await expect(readFile(corrupt, "utf8")).resolves.toBe("not memory");

		const oversized = join(root, "agents", "agent-a", "large.md");
		await writeFile(oversized, `${"x".repeat(32)}\n`, "utf8");
		await expect(validatePanopticonMemorySnapshot(oversized, 16)).resolves.toMatchObject({ status: "oversized" });
	});
});
