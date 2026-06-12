import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFileWatchConfig, parseFileWatchConfig } from "../extensions/pi-file-watch/config.js";
import { describeWatchedFiles, formatChangeMessage, formatWatchList } from "../extensions/pi-file-watch/watcher.js";

let workspace: string;
let external: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "file-watch-workspace-"));
	external = await mkdtemp(join(tmpdir(), "file-watch-external-"));
	mkdirSync(join(workspace, ".pi"));
	writeFileSync(join(workspace, ".pi", "journal.md"), "one");
	writeFileSync(join(external, "journal.md"), "two");
});

afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
	await rm(external, { recursive: true, force: true });
});

describe("file watch config", () => {
	it("defaults to no paths", () => {
		const parsed = parseFileWatchConfig(undefined);

		expect(parsed.watch).toEqual([]);
		expect(parsed.allowExternalPaths).toBe(true);
		expect(parsed.followSymlinks).toBe(true);
	});

	it("loads explicit workspace-local paths from config file", async () => {
		writeFileSync(join(workspace, ".pi", "file-watch.json"), JSON.stringify({ watch: [".pi/journal.md"] }));

		const config = await loadFileWatchConfig(workspace);
		const files = describeWatchedFiles(workspace, config);

		expect(files).toHaveLength(1);
		expect(files[0]?.status).toBe("watching");
		expect(files[0]?.external).toBe(false);
	});

	it("accepts explicit external paths by default and can reject them by config", async () => {
		const externalReal = await realpath(join(external, "journal.md"));
		const accepted = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: [externalReal] }));
		const rejected = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: [externalReal], allowExternalPaths: false }));

		expect(accepted[0]?.status).toBe("watching");
		expect(accepted[0]?.external).toBe(true);
		expect(rejected[0]?.status).toBe("error");
		expect(rejected[0]?.error).toContain("external path not allowed");
	});

	it("follows explicitly configured symlinks by default", async () => {
		const externalReal = await realpath(join(external, "journal.md"));
		symlinkSync(externalReal, join(workspace, "journal-link.md"));

		const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: ["journal-link.md"] }));

		expect(files[0]?.status).toBe("watching");
		expect(files[0]?.external).toBe(true);
		expect(files[0]?.realPath).toBe(externalReal);
	});

	it("formats change notifications without file content", () => {
		const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: [".pi/journal.md"] }));
		const file = files[0];
		expect(file?.status).toBe("watching");
		if (!file) return;

		const message = formatChangeMessage({ ...file, status: "watching", realPath: join(workspace, ".pi", "journal.md") }, {
			eventType: "change",
			timestamp: "2026-06-12T00:00:00.000Z",
			sizeBytes: 123,
			mtimeMs: 1_765_497_600_000,
		});

		expect(message).toContain("FILE WATCH UPDATE");
		expect(message).toContain("event: change");
		expect(message).toContain("sizeBytes: 123");
		expect(message).toContain("content: not included");
		expect(message).not.toContain("Current bounded/redacted file content");
		expect(message).not.toContain("one");
	});

	it("formats status and watch list messages", () => {
		const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: ["missing.md"] }));

		const file = files[0];
		expect(file).toBeDefined();
		if (!file) return;
		expect(formatWatchList(files)).toContain("missing.md");
	});
});
