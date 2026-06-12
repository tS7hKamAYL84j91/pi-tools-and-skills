import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadFileWatchConfig, parseFileWatchConfig } from "../extensions/pi-file-watch/config.js";
import { buildFirewatchUpdate, createRuntimeState, describeWatchedFiles, formatChangeMessage, formatWatchList, queueBatchUpdate } from "../extensions/pi-file-watch/watcher.js";

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
		expect(parsed.batchWindowMs).toBe(120_000);
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

	it("builds firewatch_update fields from readable files", () => {
		const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: [".pi/journal.md"] }));
		const file = files[0];
		expect(file?.status).toBe("watching");
		if (!file) return;

		const update = buildFirewatchUpdate(file, "change");

		expect(update.path).toBe(".pi/journal.md");
		expect(update.event).toBe("modified");
		expect(update.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(update.byte_size).toBe(3);
		expect(update.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("formats firewatch_update notifications without file content", () => {
		const message = formatChangeMessage({
			path: ".pi/journal.md",
			event: "modified",
			hash: "abc123",
			byte_size: 123,
			mtime: "2026-06-12T00:00:00.000Z",
			target: join(workspace, ".pi", "journal.md"),
		});

		expect(message).toContain("firewatch_update");
		expect(message).toContain("path: .pi/journal.md");
		expect(message).toContain("event: modified");
		expect(message).toContain("hash: abc123");
		expect(message).toContain("byte_size: 123");
		expect(message).toContain("mtime: 2026-06-12T00:00:00.000Z");
		expect(message).toContain("target:");
		expect(message).not.toContain("content:");
		expect(message).not.toContain("Current bounded/redacted file content");
		expect(message).not.toContain("one");
	});

	it("batches repeated changes and emits final metadata only", () => {
		vi.useFakeTimers();
		try {
			const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: [".pi/journal.md"], batchWindowMs: 120 }));
			const file = files[0];
			expect(file?.status).toBe("watching");
			if (!file) return;
			const messages: Array<{ customType: string; content: string; details: unknown }> = [];
			const pi = {
				sendMessage(message: { customType: string; content: string; details: unknown }) {
					messages.push(message);
				},
			} as ExtensionAPI;
			const state = createRuntimeState();
			state.config = parseFileWatchConfig({ watch: [".pi/journal.md"], batchWindowMs: 120 });

			queueBatchUpdate(pi, state, file, "change");
			writeFileSync(join(workspace, ".pi", "journal.md"), "two");
			queueBatchUpdate(pi, state, file, "change");
			vi.advanceTimersByTime(120);

			expect(messages).toHaveLength(1);
			expect(messages[0]?.customType).toBe("firewatch_batch");
			expect(messages[0]?.content).toContain("firewatch_batch");
			expect(messages[0]?.content).toContain("change_count=2");
			expect(messages[0]?.content).not.toContain("two");
			expect(messages[0]?.details).toMatchObject({
				changes: [expect.objectContaining({ path: ".pi/journal.md", event: "modified", byte_size: 3, change_count: 2 })],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("formats status and watch list messages", () => {
		const files = describeWatchedFiles(workspace, parseFileWatchConfig({ watch: ["missing.md"] }));

		const file = files[0];
		expect(file).toBeDefined();
		if (!file) return;
		expect(formatWatchList(files)).toContain("missing.md");
	});
});
