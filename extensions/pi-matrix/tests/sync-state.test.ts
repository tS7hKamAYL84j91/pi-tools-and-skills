/** Tests for FileSyncStateStore. */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSyncStateStore } from "../sync-state.js";

describe("FileSyncStateStore", () => {
	it("returns null when no sync state exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		try {
			const store = new FileSyncStateStore({ storagePath: dir });
			expect(await store.load()).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists and loads a sync token", async () => {
		const dir = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		try {
			const store = new FileSyncStateStore({ storagePath: dir });
			await store.save("s1_2_3");
			expect(await store.load()).toBe("s1_2_3");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("quarantines corrupt state and returns null", async () => {
		const dir = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		try {
			fs.writeFileSync(join(dir, "sync.json"), "not json", "utf-8");
			const store = new FileSyncStateStore({ storagePath: dir });
			expect(await store.load()).toBeNull();
			expect(() => {
				// Quarantined file should exist after corrupt load.
				const fs = require("node:fs");
				fs.accessSync(join(dir, "sync.corrupt.json"));
			}).not.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects symlinked sync state paths", async () => {
		const dir = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		const otherDir = mkdtempSync(join(tmpdir(), "matrix-sync-other-"));
		try {
			fs.writeFileSync(join(otherDir, "sync.json"), '{"nextBatch":"tok"}', "utf-8");
			symlinkSync(join(otherDir, "sync.json"), join(dir, "sync.json"));
			const store = new FileSyncStateStore({ storagePath: dir });
			await expect(store.load()).rejects.toThrow("symlink");
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(otherDir, { recursive: true, force: true });
		}
	});

	it("creates the storage directory private instead of inheriting the umask", async () => {
		const parent = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		const storagePath = join(parent, "nested", "state");
		try {
			const store = new FileSyncStateStore({ storagePath });
			await store.save("s1_2_3");
			expect(fs.statSync(storagePath).mode & 0o777).toBe(0o700);
			expect(await store.load()).toBe("s1_2_3");
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("leaves an operator-configured storage directory mode untouched", async () => {
		const dir = mkdtempSync(join(tmpdir(), "matrix-sync-test-"));
		try {
			fs.chmodSync(dir, 0o750);
			const store = new FileSyncStateStore({ storagePath: dir });
			await store.save("s1_2_3");
			expect(fs.statSync(dir).mode & 0o777).toBe(0o750);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
