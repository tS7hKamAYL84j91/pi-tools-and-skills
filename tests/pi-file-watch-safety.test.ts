/** Disposable targets only: path policy, bounded hashing and reload cancellation. */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFileWatchConfig } from "../extensions/pi-file-watch/config.js";
import { buildFirewatchUpdate, createRuntimeState, describeWatchedFiles, queueBatchUpdate, startFileWatch, stopFileWatch } from "../extensions/pi-file-watch/watcher.js";

vi.mock("node:fs", async (original) => ({
	...await original<typeof import("node:fs")>(),
	readSync: vi.fn((await original<typeof import("node:fs")>()).readSync),
	openSync: vi.fn((await original<typeof import("node:fs")>()).openSync),
}));
let root: string;
let cwd: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "watch-safety-"));
	cwd = join(root, "workspace");
	mkdirSync(cwd);
	vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

function described(path: string) {
	const file = describeWatchedFiles(cwd, parseFileWatchConfig({ watch: [path] }))[0];
	if (!file) throw new Error("fixture file missing");
	return file;
}

for (const parent of [false, true]) for (const external of [false, true]) {
	describe(`${parent ? "parent-directory" : "file"} symlink to ${external ? "external" : "internal"} target`, () => {
		it.each([[false, false], [false, true], [true, false], [true, true]])("follow=%s external=%s", (followSymlinks, allowExternalPaths) => {
			const targetDir = join(external ? root : cwd, "target");
			mkdirSync(targetDir);
			writeFileSync(join(targetDir, "file"), "fixture");
			symlinkSync(parent ? targetDir : join(targetDir, "file"), join(cwd, "link"));
			const config = parseFileWatchConfig({ watch: [parent ? "link/file" : "link"], followSymlinks, allowExternalPaths });
			const file = describeWatchedFiles(cwd, config)[0];
			if (!file) throw new Error("fixture file missing");
			const allowed = followSymlinks && (!external || allowExternalPaths);
			expect(file.external).toBe(external);
			expect(file.status).toBe(allowed ? "watching" : "error");
			const update = buildFirewatchUpdate(file, "change");
			if (allowed) expect(update.hash).toMatch(/^[a-f0-9]{64}$/);
			else {
				expect(update.hash).toBeUndefined();
				expect(fs.openSync).not.toHaveBeenCalled();
				expect(fs.readSync).not.toHaveBeenCalled();
			}
		});
	});
}

describe("hash bounds and changing targets", () => {
	it("omits hashes above maxBytes without opening the file", () => {
		writeFileSync(join(cwd, "large"), "x".repeat(2048));
		const update = buildFirewatchUpdate(described("large"), "change", 512);
		expect(update).toMatchObject({ byte_size: 2048 });
		expect(update.hash).toBeUndefined();
		expect(fs.openSync).not.toHaveBeenCalled();
	});

	it("hashes an exact-limit file with a bounded read", () => {
		writeFileSync(join(cwd, "small"), "x".repeat(512));
		const update = buildFirewatchUpdate(described("small"), "change", 512);
		expect(update.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(fs.readSync).toHaveBeenCalled();
	});

	it("omits the hash if the file grows during a bounded read", async () => {
		const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
		writeFileSync(join(cwd, "growing"), "x".repeat(512));
		const file = described("growing");
		const read = vi.mocked(fs.readSync);
		read.mockImplementationOnce((...args: Parameters<typeof fs.readSync>) => {
			actual.appendFileSync(file.absolutePath, "x".repeat(2048));
			return actual.readSync(...args);
		});
		expect(buildFirewatchUpdate(file, "change", 512).hash).toBeUndefined();
		const buffer = read.mock.calls[0]?.[1];
		expect(buffer?.byteLength).toBe(513);
	});

	it.each([false, true])("does not read a target repointed after discovery (parent=%s)", (parent) => {
		const localDir = join(cwd, "local"); mkdirSync(localDir);
		const outsideDir = join(root, "outside"); mkdirSync(outsideDir);
		writeFileSync(join(localDir, "file"), "local fixture");
		writeFileSync(join(outsideDir, "file"), "external fixture");
		symlinkSync(parent ? localDir : join(localDir, "file"), join(cwd, "link"));
		const file = described(parent ? "link/file" : "link");
		unlinkSync(join(cwd, "link"));
		symlinkSync(parent ? outsideDir : join(outsideDir, "file"), join(cwd, "link"));
		expect(buildFirewatchUpdate(file, "change").hash).toBeUndefined();
		expect(fs.openSync).not.toHaveBeenCalled();
	});

	it("does not follow a regular file replaced by a symlink", () => {
		writeFileSync(join(cwd, "file"), "local");
		writeFileSync(join(root, "outside"), "external");
		const file = described("file");
		unlinkSync(file.absolutePath); symlinkSync(join(root, "outside"), file.absolutePath);
		expect(buildFirewatchUpdate(file, "change").hash).toBeUndefined();
		expect(fs.openSync).not.toHaveBeenCalled();
	});

	it("omits hashes for deleted and unreadable files", () => {
		writeFileSync(join(cwd, "file"), "fixture");
		const file = described("file");
		vi.mocked(fs.openSync).mockImplementationOnce(() => { throw new Error("EACCES fixture"); });
		expect(buildFirewatchUpdate(file, "change").hash).toBeUndefined();
		unlinkSync(file.absolutePath);
		expect(buildFirewatchUpdate(file, "rename")).toMatchObject({ path: "file", event: "rename" });
		expect(buildFirewatchUpdate(file, "rename").hash).toBeUndefined();
	});

	it("cancels a pending debounce on reload", () => {
		vi.useFakeTimers();
		writeFileSync(join(cwd, "file"), "fixture");
		const state = createRuntimeState();
		let changed: () => void = () => { throw new Error("watch not installed"); };
		state.watchFactory = (_path, callback) => {
			changed = () => callback("change", "file");
			return { close() {} };
		};
		const sendMessage = vi.fn();
		const pi = { sendMessage } as unknown as ExtensionAPI;
		const ctx = { cwd } as ExtensionContext;
		const config = parseFileWatchConfig({ watch: ["file"], debounceMs: 50, batchWindowMs: 100 });
		startFileWatch(pi, ctx, config, state);
		changed();
		expect(state.timers.size).toBe(1);
		startFileWatch(pi, ctx, config, state);
		vi.runAllTimers();
		expect(sendMessage).not.toHaveBeenCalled();
		stopFileWatch(state);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("uses configured hash bounds in batches and cancels queued work on reload", () => {
		vi.useFakeTimers();
		writeFileSync(join(cwd, "file"), "x".repeat(2048));
		const state = createRuntimeState();
		state.watchFactory = () => ({ close() {} });
		const sendMessage = vi.fn();
		const pi = { sendMessage } as unknown as ExtensionAPI;
		const ctx = { cwd } as ExtensionContext;
		const config = parseFileWatchConfig({ watch: ["file"], maxBytes: 512, batchWindowMs: 100 });
		const file = startFileWatch(pi, ctx, config, state)[0];
		if (!file) throw new Error("fixture file missing");
		queueBatchUpdate(pi, state, file, "change");
		vi.advanceTimersByTime(100);
		expect(sendMessage).toHaveBeenCalledTimes(1);
		const batch = sendMessage.mock.calls[0]?.[0];
		expect(batch.details.changes[0].hash).toBeUndefined();
		expect(batch.details.changes[0].byte_size).toBe(2048);
		queueBatchUpdate(pi, state, file, "change");
		startFileWatch(pi, ctx, config, state);
		vi.advanceTimersByTime(100);
		expect(sendMessage).toHaveBeenCalledTimes(1);
		stopFileWatch(state);
		expect(vi.getTimerCount()).toBe(0);
	});
});
