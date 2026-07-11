/** Tests for FileSyncStateStore. */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
			writeFileSync(join(dir, "sync.json"), "not json", "utf-8");
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
			writeFileSync(join(otherDir, "sync.json"), '{"nextBatch":"tok"}', "utf-8");
			symlinkSync(join(otherDir, "sync.json"), join(dir, "sync.json"));
			const store = new FileSyncStateStore({ storagePath: dir });
			await expect(store.load()).rejects.toThrow("symlink");
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(otherDir, { recursive: true, force: true });
		}
	});
});
