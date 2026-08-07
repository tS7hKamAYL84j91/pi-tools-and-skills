import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfinedStore } from "../../extensions/pi-coas/store.js";

const testRoots: string[] = [];

async function createRoot(): Promise<string> {
	const root = join(tmpdir(), `pi-coas-store-security-${process.pid}-${Date.now()}-${testRoots.length}`);
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
	it("validates the complete CoAS-home-to-subroot chain", async () => {
		const home = await createRoot();
		const outside = await createRoot();
		await symlink(outside, join(home, "schedules"));

		await expect(ConfinedStore.forScheduleRoot({ coasHome: home })).rejects.toThrow(/symlinked CoAS path component/);
	});

	it("rejects a symlinked CoAS-home root", async () => {
		const parent = await createRoot();
		const home = join(parent, "home");
		const alias = join(parent, "alias");
		await mkdir(home);
		await symlink(home, alias);

		await expect(ConfinedStore.forCoasHome({ coasHome: alias })).rejects.toThrow(/symlinked CoAS root/);
	});

	it("requires authorized external workspace metadata without a symlinked metadata chain", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await expect(ConfinedStore.forExternalWorkspace(root)).rejects.toThrow(/not authorized/);
		await symlink(outside, join(root, ".pi"));
		await expect(ConfinedStore.forExternalWorkspace(root)).rejects.toThrow(/symlinked CoAS path component/);
		await rm(join(root, ".pi"));
		await mkdir(join(root, ".pi", "coas"), { recursive: true });
		await writeFile(join(root, ".pi", "coas", "workspace.env"), "WORKSPACE_ID=external\n", "utf8");

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
		const store = await ConfinedStore.forCoasHome({ coasHome: root });

		await expect(store.readRequiredFile(join(root, "linked", "secret.txt"))).rejects.toThrow(/symlinked CoAS path component/);
		await expect(store.readRequiredFile(join(root, "final-link"))).rejects.toThrow(/symlinked CoAS path component/);
	});

	it("reads a required file and preserves ENOENT failures", async () => {
		const root = await createRoot();
		const path = join(root, "required.txt");
		await writeFile(path, "required", "utf8");
		const store = await ConfinedStore.forCoasHome({ coasHome: root });

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
		const store = await ConfinedStore.forCoasHome({ coasHome: root });

		await expect(store.removePrivateFiles([retained, join(root, "bad-link")])).rejects.toThrow(/symlinked CoAS path component/);
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
		const store = await ConfinedStore.forCoasHome({ coasHome: root });

		await expect(store.countDirectories(listing)).rejects.toThrow(/symlinked CoAS directory entry/);
		await expect(store.newestFile(listing, ".log")).rejects.toThrow(/symlinked CoAS directory entry/);
	});
});
