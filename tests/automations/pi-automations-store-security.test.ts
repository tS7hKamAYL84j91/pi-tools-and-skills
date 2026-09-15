import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendWorkspaceContext } from "../../extensions/pi-automations/workspace-context.js";
import { ConfinedStore } from "../../extensions/pi-automations/store.js";

const testRoots: string[] = [];

async function createRoot(): Promise<string> {
	const root = join(tmpdir(), `pi-automations-store-security-${process.pid}-${Date.now()}-${testRoots.length}`);
	testRoots.push(root);
	await mkdir(root, { recursive: true });
	return root;
}

afterEach(async () => {
	for (const root of testRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("ConfinedStore factories", () => {
	it("validates the complete Automations-home-to-subroot chain", async () => {
		const home = await createRoot();
		const outside = await createRoot();
		await symlink(outside, join(home, "schedules"));

		await expect(ConfinedStore.forScheduleRoot({ automationsHome: home })).rejects.toThrow(/symlinked Automations path component/);
	});

	it("rejects a symlinked Automations-home root", async () => {
		const parent = await createRoot();
		const home = join(parent, "home");
		const alias = join(parent, "alias");
		await mkdir(home);
		await symlink(home, alias);

		await expect(ConfinedStore.forAutomationsHome({ automationsHome: alias })).rejects.toThrow(/symlinked Automations root/);
	});

	it("requires authorized external workspace metadata without a symlinked metadata chain", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await expect(ConfinedStore.forExternalWorkspace(root)).rejects.toThrow(/not authorized/);
		await symlink(outside, join(root, ".pi"));
		await expect(ConfinedStore.forExternalWorkspace(root)).rejects.toThrow(/symlinked Automations path component/);
		await rm(join(root, ".pi"));
		await mkdir(join(root, ".pi", "automations"), { recursive: true });
		await writeFile(join(root, ".pi", "automations", "workspace.env"), "WORKSPACE_ID=external\n", "utf8");

		await expect(ConfinedStore.forExternalWorkspace(root)).resolves.toBeInstanceOf(ConfinedStore);
	});
});

describe("ConfinedStore operations", () => {
	it("rejects intermediate and final symlink components", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await mkdir(join(root, "safe"));
		await writeFile(join(outside, "secret.txt"), "secret", "utf8");
		await symlink(outside, join(root, "linked"));
		await symlink(join(outside, "secret.txt"), join(root, "final-link"));
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.readRequiredFile(join(root, "linked", "secret.txt"))).rejects.toThrow(/symlinked Automations path component/);
		await expect(store.readRequiredFile(join(root, "final-link"))).rejects.toThrow(/symlinked Automations path component/);
	});

	it("rejects non-regular read targets", async () => {
		const root = await createRoot();
		const directory = join(root, "not-a-file");
		await mkdir(directory);
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.readOptionalFile(directory)).rejects.toThrow(/regular file/);
		await expect(store.readRequiredFile(directory)).rejects.toThrow(/regular file/);
	});

	it("rejects symlink components while creating a missing descendant", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await symlink(outside, join(root, "new-link"));
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.ensurePrivateDir(join(root, "new-link", "created"))).rejects.toThrow(/symlinked Automations path component/);
		await expect(store.writePrivateFileAtomic(join(root, "new-link", "created.txt"), "escape")).rejects.toThrow(/symlinked Automations path component/);
	});

	it("preserves authorized external-workspace archive compaction", async () => {
		const workspace = await createRoot();
		await mkdir(join(workspace, ".pi", "automations"), { recursive: true });
		await writeFile(join(workspace, ".pi", "automations", "workspace.env"), "WORKSPACE_ID=external\\n", "utf8");
		await writeFile(join(workspace, "CONTEXT.md"), `# External\\n\\n${"detail\\n".repeat(9000)}`, "utf8");

		const result = await appendWorkspaceContext({ automationsHome: join(workspace, "other-automations") }, workspace, workspace, "stable fact");

		await expect(readFile(result.path, "utf8")).resolves.toContain("# Automations Workspace Context (SPR)");
		const archiveEntries = await readdir(join(workspace, "archive"));
		expect(archiveEntries).toHaveLength(1);
		const archiveName = archiveEntries[0];
		if (!archiveName) throw new Error("archive entry missing");
		await expect(readFile(join(workspace, "archive", archiveName), "utf8")).resolves.toContain("# External");
	});

	it("reads a required file and preserves ENOENT failures", async () => {
		const root = await createRoot();
		const path = join(root, "required.txt");
		await writeFile(path, "required", "utf8");
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.readRequiredFile(path)).resolves.toBe("required");
		await expect(store.readRequiredFile(join(root, "missing.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("validates every deletion target before removing any file", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		const retained = join(root, "retained.txt");
		await writeFile(retained, "keep", "utf8");
		await writeFile(join(outside, "secret.txt"), "secret", "utf8");
		await symlink(join(outside, "secret.txt"), join(root, "bad-link"));
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.removePrivateFiles([retained, join(root, "bad-link")])).rejects.toThrow(/symlinked Automations path component/);
		await expect(readFile(retained, "utf8")).resolves.toBe("keep");
	});

	it("rejects symlinked directory entries rather than filtering them", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		const listing = join(root, "listing");
		await mkdir(listing);
		await mkdir(join(listing, "normal-directory"));
		await writeFile(join(listing, "normal.log"), "log", "utf8");
		await symlink(outside, join(listing, "linked-entry"));
		const store = await ConfinedStore.forAutomationsHome({ automationsHome: root });

		await expect(store.countDirectories(listing)).rejects.toThrow(/symlinked Automations directory entry/);
		await expect(store.newestFile(listing, ".log")).rejects.toThrow(/symlinked Automations directory entry/);
	});
});
