import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withAdvisoryLock } from "../../lib/file-lock.js";

let tempDir = "";
let targetPath = "";

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pi-file-lock-"));
	targetPath = join(tempDir, "state.json");
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

function ownerMetadata(ownerId: string, pid = 999_999_999): string {
	return `${JSON.stringify({
		pid,
		createdAt: new Date(0).toISOString(),
		ownerId,
	})}\n`;
}

describe("withAdvisoryLock fail-closed ownership", () => {
	it("never steals an existing lock", async () => {
		const lockPath = `${targetPath}.lock`;
		await writeFile(lockPath, ownerMetadata("stale-owner"), "utf8");
		const old = new Date(Date.now() - 60 * 60_000);
		await utimes(lockPath, old, old);

		await expect(
			withAdvisoryLock(targetPath, async () => {}, { maxRetries: 0 }),
		).rejects.toThrow("lock is held by pid 999999999");
		expect(await readFile(lockPath, "utf8")).toBe(ownerMetadata("stale-owner"));
	});

	it("keeps aged malformed lock metadata", async () => {
		const lockPath = `${targetPath}.lock`;
		await writeFile(lockPath, "not-json", "utf8");
		const old = new Date(Date.now() - 60 * 60_000);
		await utimes(lockPath, old, old);

		await expect(
			withAdvisoryLock(targetPath, async () => {}, { maxRetries: 0 }),
		).rejects.toThrow("lock is held");
		expect(await readFile(lockPath, "utf8")).toBe("not-json");
	});

	it("rejects and preserves a symlinked lock path", async () => {
		const authority = join(tempDir, "foreign-lock");
		await writeFile(authority, ownerMetadata("foreign-owner"), "utf8");
		await symlink(authority, `${targetPath}.lock`);

		await expect(
			withAdvisoryLock(targetPath, async () => {}, { maxRetries: 0 }),
		).rejects.toThrow(/symlink/);
		expect(await readFile(authority, "utf8")).toBe(ownerMetadata("foreign-owner"));
	});

	it("rejects non-regular and oversized lock metadata", async () => {
		const lockPath = `${targetPath}.lock`;
		await mkdir(lockPath);
		await expect(
			withAdvisoryLock(targetPath, async () => {}, { maxRetries: 0 }),
		).rejects.toThrow(/not a regular file/);

		await rm(lockPath, { recursive: true });
		await writeFile(lockPath, "x".repeat(4_097), "utf8");
		await expect(
			withAdvisoryLock(targetPath, async () => {}, { maxRetries: 0 }),
		).rejects.toThrow(/exceeds 4096 bytes/);
		expect((await readFile(lockPath)).byteLength).toBe(4_097);
	});

	it("does not release a changed inode or owner", async () => {
		const lockPath = `${targetPath}.lock`;
		await withAdvisoryLock(targetPath, async () => {
			await rm(lockPath);
			await writeFile(lockPath, ownerMetadata("replacement-owner"), "utf8");
		});
		expect(await readFile(lockPath, "utf8")).toBe(ownerMetadata("replacement-owner"));

		await rm(lockPath);
		await withAdvisoryLock(targetPath, async () => {
			await writeFile(lockPath, ownerMetadata("changed-owner", process.pid), "utf8");
		});
		expect(await readFile(lockPath, "utf8")).toBe(ownerMetadata("changed-owner", process.pid));
	});

	it("releases its unchanged lock", async () => {
		await withAdvisoryLock(targetPath, async () => {});
		await expect(access(`${targetPath}.lock`)).rejects.toThrow();
	});
});
