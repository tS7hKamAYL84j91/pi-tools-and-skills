import {
	mkdirSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadFileWatchConfig,
	parseFileWatchConfig,
} from "../extensions/pi-file-watch/config.js";
import type {
	WatchedFileDescription,
	WatcherRuntimeState,
} from "../extensions/pi-file-watch/types.js";
import {
	buildFirewatchUpdate,
	createRuntimeState,
	describeWatchedFiles,
	formatChangeMessage,
	formatWatchList,
	queueBatchUpdate,
	renderStatus,
	startFileWatch,
	stopFileWatch,
} from "../extensions/pi-file-watch/watcher.js";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		lstatSync: vi.fn(
			(
				path: import("node:fs").PathLike,
				options?: import("node:fs").StatOptions,
			) => {
				if (path.toString().includes("unreadable.md")) {
					throw new Error("EACCES: permission denied");
				}
				return actual.lstatSync(path, options);
			},
		),
	};
});
let workspace: string;
let external: string;

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	expect(condition()).toBe(true);
}

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
		writeFileSync(
			join(workspace, ".pi", "file-watch.json"),
			JSON.stringify({ watch: [".pi/journal.md"] }),
		);

		const config = await loadFileWatchConfig(workspace);
		const files = describeWatchedFiles(workspace, config);

		expect(files).toHaveLength(1);
		expect(files[0]?.status).toBe("watching");
		expect(files[0]?.external).toBe(false);
	});

	it("accepts explicit external paths by default and can reject them by config", async () => {
		const externalReal = await realpath(join(external, "journal.md"));
		const accepted = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({ watch: [externalReal] }),
		);
		const rejected = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({
				watch: [externalReal],
				allowExternalPaths: false,
			}),
		);

		expect(accepted[0]?.status).toBe("watching");
		expect(accepted[0]?.external).toBe(true);
		expect(rejected[0]?.status).toBe("error");
		expect(rejected[0]?.error).toContain("external path not allowed");
	});

	it("follows explicitly configured symlinks by default", async () => {
		const externalReal = await realpath(join(external, "journal.md"));
		symlinkSync(externalReal, join(workspace, "journal-link.md"));

		const files = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({ watch: ["journal-link.md"] }),
		);

		expect(files[0]?.status).toBe("watching");
		expect(files[0]?.external).toBe(true);
		expect(files[0]?.realPath).toBe(externalReal);
	});

	it("builds firewatch_update fields from readable files", () => {
		const files = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({ watch: [".pi/journal.md"] }),
		);
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
			const files = describeWatchedFiles(
				workspace,
				parseFileWatchConfig({ watch: [".pi/journal.md"], batchWindowMs: 120 }),
			);
			const file = files[0];
			expect(file?.status).toBe("watching");
			if (!file) return;
			const messages: Array<{
				customType: string;
				content: string;
				display?: boolean;
				details: unknown;
			}> = [];
			const options: unknown[] = [];
			const pi = {
				sendMessage(
					message: {
						customType: string;
						content: string;
						display?: boolean;
						details: unknown;
					},
					sendOptions?: unknown,
				) {
					messages.push(message);
					options.push(sendOptions);
				},
			} as ExtensionAPI;
			const state = createRuntimeState();
			state.config = parseFileWatchConfig({
				watch: [".pi/journal.md"],
				batchWindowMs: 120,
			});

			queueBatchUpdate(pi, state, file, "change");
			writeFileSync(join(workspace, ".pi", "journal.md"), "two");
			queueBatchUpdate(pi, state, file, "change");
			vi.advanceTimersByTime(120);

			expect(messages).toHaveLength(1);
			expect(messages[0]?.customType).toBe("firewatch_batch");
			expect(messages[0]?.display).toBe(false);
			expect(options[0]).toEqual({ triggerTurn: true });
			expect(messages[0]?.content).toContain("firewatch_batch");
			expect(messages[0]?.content).toContain("change_count=2");
			expect(messages[0]?.content).not.toContain("two");
			expect(messages[0]?.details).toMatchObject({
				changes: [
					expect.objectContaining({
						path: ".pi/journal.md",
						event: "modified",
						byte_size: 3,
						change_count: 2,
					}),
				],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("formats status and watch list messages", () => {
		const files = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({ watch: ["missing.md"] }),
		);

		const file = files[0];
		expect(file).toBeDefined();
		if (!file) return;
		expect(formatWatchList(files)).toContain("missing.md");
	});

	it("renders watch status correctly", () => {
		const config = parseFileWatchConfig({
			watch: ["one.md", "two.md", "three.md"],
		});
		const state = createRuntimeState();
		state.eventCount = 42;

		const files: WatchedFileDescription[] = [
			{
				configuredPath: "one.md",
				absolutePath: "/one.md",
				exists: true,
				status: "watching",
				external: false,
				symlink: false,
			},
			{
				configuredPath: "two.md",
				absolutePath: "/two.md",
				exists: true,
				status: "watching",
				external: false,
				symlink: false,
			},
			{
				configuredPath: "three.md",
				absolutePath: "/three.md",
				exists: false,
				status: "missing",
				external: false,
				symlink: false,
			},
		];

		const status = renderStatus(config, files, state);
		expect(status).toBe("File watch: 2/3 watching, events=42");

		const emptyStatus = renderStatus(
			parseFileWatchConfig({ watch: [] }),
			[],
			state,
		);
		expect(emptyStatus).toBe("File watch: 0/0 watching, events=42");
	});

	it("emits error status when file system read fails (e.g., permission denied)", () => {
		// Mock intercepts lstatSync for paths including "unreadable.md"
		writeFileSync(join(workspace, "unreadable.md"), "secret");

		const config = parseFileWatchConfig({ watch: ["unreadable.md"] });
		const files = describeWatchedFiles(workspace, config);

		expect(files).toHaveLength(1);
		expect(files[0]?.status).toBe("error");
		expect(files[0]?.error).toContain("EACCES: permission denied");
	});

	it("reports target content changes through a configured symlink path", async () => {
		const externalReal = await realpath(join(external, "journal.md"));
		symlinkSync(externalReal, join(workspace, "journal-link.md"));
		const messages: Array<{
			customType: string;
			content: string;
			display?: boolean;
			details: { changes?: Array<{ path?: string; hash?: string }> };
		}> = [];
		const pi = {
			sendMessage(message: {
				customType: string;
				content: string;
				display?: boolean;
				details: { changes?: Array<{ path?: string; hash?: string }> };
			}) {
				messages.push(message);
			},
		} as ExtensionAPI;
		const watchedDirs = new Map<
			string,
			(event: string, filename: string | Buffer | null) => void
		>();
		const state = createRuntimeState();
		state.watchFactory = (dir, callback) => {
			watchedDirs.set(dir, callback);
			return {
				close: () => {
					watchedDirs.delete(dir);
				},
			};
		};
		try {
			startFileWatch(
				pi,
				{ cwd: workspace } as ExtensionContext,
				parseFileWatchConfig({
					watch: ["journal-link.md"],
					debounceMs: 20,
					batchWindowMs: 20,
				}),
				state,
			);
			writeFileSync(externalReal, "changed");
			watchedDirs.get(dirname(externalReal))?.("change", "journal.md");

			await waitFor(() => messages.length > 0);

			expect(messages[0]?.details.changes?.[0]).toMatchObject({
				path: "journal-link.md",
			});
			expect(messages[0]?.display).toBe(false);
			expect(messages[0]?.content).not.toContain("changed");
		} finally {
			stopFileWatch(state);
		}
	});

	it("rebuilds watcher state when a configured symlink is repointed", async () => {
		const otherExternal = await mkdtemp(
			join(tmpdir(), "file-watch-other-external-"),
		);
		const firstReal = await realpath(join(external, "journal.md"));
		const second = join(otherExternal, "journal.md");
		writeFileSync(second, "three");
		symlinkSync(firstReal, join(workspace, "journal-link.md"));
		const messages: Array<{
			details: { changes?: Array<{ target?: string }> };
		}> = [];
		const pi = {
			sendMessage(message: {
				details: { changes?: Array<{ target?: string }> };
			}) {
				messages.push(message);
			},
		} as ExtensionAPI;
		const watchedDirs = new Map<
			string,
			(event: string, filename: string | Buffer | null) => void
		>();
		const state = createRuntimeState();
		state.watchFactory = (dir, callback) => {
			watchedDirs.set(dir, callback);
			return {
				close: () => {
					watchedDirs.delete(dir);
				},
			};
		};
		try {
			startFileWatch(
				pi,
				{ cwd: workspace } as ExtensionContext,
				parseFileWatchConfig({
					watch: ["journal-link.md"],
					debounceMs: 20,
					batchWindowMs: 20,
				}),
				state,
			);
			unlinkSync(join(workspace, "journal-link.md"));
			symlinkSync(second, join(workspace, "journal-link.md"));
			watchedDirs.get(workspace)?.("rename", "journal-link.md");
			await waitFor(() => state.files[0]?.realPath === second);
			writeFileSync(second, "four");
			watchedDirs.get(dirname(state.files[0]?.realPath ?? second))?.(
				"change",
				"journal.md",
			);

			await waitFor(() =>
				messages.some((message) =>
					message.details.changes?.some((change) => change.target === second),
				),
			);
		} finally {
			stopFileWatch(state);
			await rm(otherExternal, { recursive: true, force: true });
		}
	});
});

describe("directory watch", () => {
	interface DirHarness {
		dirReal: string;
		fire(event: string, filename: string | Buffer | null): void;
		messages: Array<{
			details: { changes?: Array<Record<string, unknown>> };
			content?: string;
		}>;
		state: WatcherRuntimeState;
	}

	function startDirWatch(batchWindowMs = 20): DirHarness {
		const dir = join(workspace, "directives");
		mkdirSync(dir);
		const messages: Array<{
			details: { changes?: Array<Record<string, unknown>> };
			content?: string;
		}> = [];
		const pi = {
			sendMessage(message: (typeof messages)[number]) {
				messages.push(message);
			},
		} as ExtensionAPI;
		const callbacks = new Map<
			string,
			(event: string, filename: string | Buffer | null) => void
		>();
		const state = createRuntimeState();
		state.watchFactory = (path, callback) => {
			callbacks.set(path, callback);
			return { close: () => callbacks.delete(path) };
		};
		startFileWatch(
			pi,
			{ cwd: workspace } as ExtensionContext,
			parseFileWatchConfig({
				watch: ["directives"],
				debounceMs: 20,
				batchWindowMs,
			}),
			state,
		);
		const dirReal = realpathSync(dir);
		return {
			dirReal,
			fire(event, filename) {
				callbacks.get(dirReal)?.(event, filename);
			},
			messages,
			state,
		};
	}

	it("accepts directory entries and reports them as watched directories", () => {
		mkdirSync(join(workspace, "inbox"));
		const [file] = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({ watch: ["inbox"] }),
		);
		expect(file?.status).toBe("watching");
		expect(file?.isDirectory).toBe(true);
	});

	it("rejects external directories by config", async () => {
		const rejected = describeWatchedFiles(
			workspace,
			parseFileWatchConfig({
				watch: [await realpath(external)],
				allowExternalPaths: false,
			}),
		);
		expect(rejected[0]?.status).toBe("error");
		expect(rejected[0]?.error).toContain("external path not allowed");
	});

	it("fires a per-file batch entry for a file created in a watched directory", async () => {
		const harness = startDirWatch();
		try {
			expect(harness.state.files[0]?.isDirectory).toBe(true);
			writeFileSync(join(workspace, "directives", "d-1.json"), '{"note":1}');
			harness.fire("rename", Buffer.from("d-1.json"));
			await waitFor(() => harness.messages.length > 0);
			const change = harness.messages[0]?.details.changes?.[0];
			expect(change).toMatchObject({
				path: join("directives", "d-1.json"),
				event: "rename",
				byte_size: 10,
				change_count: 1,
			});
			expect(change?.hash).toMatch(/^[a-f0-9]{64}$/);
			expect(harness.messages[0]?.content).not.toContain('{"note":1}');
		} finally {
			stopFileWatch(harness.state);
		}
	});

	it("coalesces repeated child events per file and keeps per-file batch entries", () => {
		vi.useFakeTimers();
		const harness = startDirWatch(100);
		try {
			writeFileSync(join(workspace, "directives", "a.json"), "one");
			harness.fire("rename", "a.json");
			vi.advanceTimersByTime(50); // first debounce expiry → queued update
			writeFileSync(join(workspace, "directives", "a.json"), "two");
			harness.fire("change", "a.json");
			harness.fire("rename", "b.json");
			vi.advanceTimersByTime(50); // second debounce expiry → same file count=2, new file entry
			vi.advanceTimersByTime(100); // batch flush
			expect(harness.messages).toHaveLength(1);
			const changes = harness.messages[0]?.details.changes ?? [];
			expect(changes).toHaveLength(2);
			expect(changes[0]).toMatchObject({
				path: join("directives", "a.json"),
				event: "modified",
				byte_size: 3,
				change_count: 2,
			});
			expect(changes[1]).toMatchObject({
				path: join("directives", "b.json"),
				event: "rename",
				change_count: 1,
			});
		} finally {
			vi.useRealTimers();
			stopFileWatch(harness.state);
		}
	});

	it("skips unidentifiable and unsafe child names", async () => {
		const harness = startDirWatch();
		try {
			harness.fire("rename", null);
			harness.fire("rename", ".");
			harness.fire("rename", "..");
			harness.fire("rename", "../escape");
			harness.fire("rename", "sub/child");
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(harness.messages).toHaveLength(0);
			expect(harness.state.timers.size).toBe(0);
			expect(harness.state.batchChanges.size).toBe(0);
		} finally {
			stopFileWatch(harness.state);
		}
	});

	it("emits metadata-only entries for symlinked and directory children", async () => {
		const harness = startDirWatch();
		try {
			mkdirSync(join(workspace, "directives", "nested"));
			symlinkSync(
				join(external, "journal.md"),
				join(workspace, "directives", "link.json"),
			);
			harness.fire("rename", "nested");
			harness.fire("rename", "link.json");
			await waitFor(() => harness.messages.length > 0);
			const changes = harness.messages[0]?.details.changes ?? [];
			expect(changes).toHaveLength(2);
			for (const change of changes) {
				expect(change?.byte_size).toBeUndefined();
				expect(change?.hash).toBeUndefined();
			}
			expect(changes[0]).toMatchObject({
				path: join("directives", "nested"),
				event: "rename",
			});
			expect(changes[1]).toMatchObject({
				path: join("directives", "link.json"),
				event: "rename",
			});
		} finally {
			stopFileWatch(harness.state);
		}
	});
});
