/** File-watch settings overlay: persistence round-trips and overlay interactions. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fileWatchExtension from "../extensions/pi-file-watch/index.js";
import {
	loadFileWatchConfig,
	parseFileWatchConfig,
	queueSaveFileWatchConfig,
	saveFileWatchConfig,
} from "../extensions/pi-file-watch/config.js";
import { openFileWatchSettings } from "../extensions/pi-file-watch/settings-overlay.js";
import { createRuntimeState, stopFileWatch } from "../extensions/pi-file-watch/watcher.js";
import type { WatchHandle, WatcherRuntimeState } from "../extensions/pi-file-watch/types.js";

let home: string;
let configPath: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "file-watch-settings-"));
	configPath = join(home, ".pi", "file-watch.json");
	await mkdir(join(home, ".pi"), { recursive: true });
	initTheme("dark", false);
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

const fakeWatchFactory = (): (path: string, cb: (event: string, filename: string | Buffer | null) => void) => WatchHandle => () => ({ close: () => undefined });
const fakeTui = { requestRender: vi.fn() } as unknown as TUI;
const passthroughTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

interface CapturedOverlay {
	component: Component & { handleInput(data: string): void };
	done: (value: void) => void;
}

function context(overrides: Partial<Record<string, unknown>> = {}): { ctx: ExtensionContext; overlay: () => CapturedOverlay | undefined } {
	let captured: CapturedOverlay | undefined;
	const ctx = {
		cwd: home,
		mode: "tui",
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			custom: vi.fn(async (factory: (tui: TUI, theme: unknown, kb: unknown, done: (v: void) => void) => Component) => {
				const done = vi.fn();
				const component = factory(fakeTui, passthroughTheme, {}, done);
				captured = { component: component as CapturedOverlay["component"], done };
				return undefined;
			}),
		},
		...overrides,
	} as unknown as ExtensionContext;
	return { ctx, overlay: () => captured };
}

function runtimeState(watch: string[]): WatcherRuntimeState {
	const state = createRuntimeState();
	state.config = parseFileWatchConfig({ watch });
	state.watchFactory = fakeWatchFactory();
	return state;
}

async function readRaw(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
}

describe("file-watch config persistence", () => {
	it("round-trips an edited config and preserves unknown keys", async () => {
		await writeFile(configPath, JSON.stringify({ watch: ["a.md"], maxBytes: 999_999, unknownKey: 42, nested: { keep: true } }), "utf8");
		const config = await loadFileWatchConfig(home);
		await saveFileWatchConfig(home, { ...config, watch: ["b.md"], triggerTurn: false });
		const raw = await readRaw();
		expect(raw.watch).toEqual(["b.md"]);
		expect(raw.triggerTurn).toBe(false);
		expect(raw.maxBytes).toBe(128_000); // clamped effective value, not the raw 999999
		expect(raw.unknownKey).toBe(42);
		expect(raw.nested).toEqual({ keep: true });
		expect((await loadFileWatchConfig(home)).watch).toEqual(["b.md"]);
	});

	it("replaces a malformed non-object config file with the effective config", async () => {
		await writeFile(configPath, JSON.stringify("not an object"), "utf8");
		const config = parseFileWatchConfig({ watch: ["x.md"] });
		await saveFileWatchConfig(home, config);
		expect(await readRaw()).toMatchObject({ watch: ["x.md"] });
		expect((await loadFileWatchConfig(home)).watch).toEqual(["x.md"]);
	});

	it("serializes rapid saves so the last one wins intact", async () => {
		const first = queueSaveFileWatchConfig(home, parseFileWatchConfig({ watch: ["first.md"] }));
		const second = queueSaveFileWatchConfig(home, parseFileWatchConfig({ watch: ["second.md"], debounceMs: 2000 }));
		await Promise.all([first, second]);
		const raw = await readRaw();
		expect(raw.watch).toEqual(["second.md"]);
		expect(raw.debounceMs).toBe(2000);
	});
});

describe("file-watch settings overlay", () => {
	it("renders the settings rows in TUI mode", async () => {
		const state = runtimeState(["journal.md"]);
		const { ctx, overlay } = context();
		try {
			await openFileWatchSettings({ sendMessage: vi.fn() } as never, ctx, state);
			const text = overlay()?.component.render(120).join("\n");
			expect(text).toContain("File Watch Settings");
			expect(text).toContain("Watched files");
			expect(text).toContain("1 file");
			expect(text).toContain("Trigger agent turn");
			expect(text).toContain("Hash byte limit");
		} finally {
			stopFileWatch(state);
		}
	});

	it("persists a toggled option and hot-reloads the watchers", async () => {
		const state = runtimeState(["journal.md"]);
		const { ctx, overlay } = context();
		try {
			await openFileWatchSettings({ sendMessage: vi.fn() } as never, ctx, state);
			const component = overlay()?.component;
			if (!component) throw new Error("overlay component missing");
			component.handleInput("\x1b[B"); // → Trigger agent turn
			component.handleInput(" "); // cycle on → off
			await vi.waitFor(async () => {
				expect((await readRaw()).triggerTurn).toBe(false);
			});
			expect(state.config?.triggerTurn).toBe(false);
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("file-watch", expect.any(String));
		} finally {
			stopFileWatch(state);
		}
	});

	it("edits the watched list: add via paste, delete, and close", async () => {
		const state = runtimeState(["journal.md"]);
		const { ctx, overlay } = context();
		try {
			await openFileWatchSettings({ sendMessage: vi.fn() } as never, ctx, state);
			const component = overlay()?.component;
			if (!component) throw new Error("overlay component missing");
			component.handleInput("\r"); // open the watched-files submenu
			expect(component.render(120).join("\n")).toContain("+ add file…");
			component.handleInput("a"); // add prompt with native input
			expect(component.render(120).join("\n")).toContain("type path");
			component.handleInput("\x1b[200~notes/todo.md\x1b[201~"); // bracketed paste
			component.handleInput("\r");
			await vi.waitFor(() => {
				expect(state.config?.watch).toContain("notes/todo.md");
			});
			expect((await readRaw()).watch).toEqual(["journal.md", "notes/todo.md"]);
			// Same open editor re-renders the live list.
			expect(component.render(120).join("\n")).toContain("notes/todo.md");
			component.handleInput("d"); // delete the selected first row (journal.md)
			await vi.waitFor(() => {
				expect(state.config?.watch).toEqual(["notes/todo.md"]);
			});
			expect((await readRaw()).watch).toEqual(["notes/todo.md"]);
			component.handleInput("\x1b"); // back to the settings list
			expect(component.render(120).join("\n")).toContain("Trigger agent turn");
		} finally {
			stopFileWatch(state);
		}
	});

	it("rejects duplicate adds without persisting a second entry", async () => {
		await writeFile(configPath, JSON.stringify({ watch: ["dup.md"] }), "utf8");
		const state = runtimeState(["dup.md"]);
		const { ctx, overlay } = context();
		try {
			await openFileWatchSettings({ sendMessage: vi.fn() } as never, ctx, state);
			const component = overlay()?.component;
			if (!component) throw new Error("overlay component missing");
			component.handleInput("\r");
			component.handleInput("a");
			for (const character of "dup.md") component.handleInput(character);
			component.handleInput("\r");
			// Duplicate adds are rejected: nothing is persisted, the prompt closes,
			// and the list still shows a single entry.
			expect(state.config?.watch).toEqual(["dup.md"]);
			expect((await readRaw()).watch).toEqual(["dup.md"]);
			const listText = component.render(120).join("\n");
			expect(listText).not.toContain("type path");
			expect(listText).toContain("dup.md");
		} finally {
			stopFileWatch(state);
		}
	});

	it("falls back to status refresh in non-interactive sessions", async () => {
		await writeFile(configPath, JSON.stringify({ watch: ["a.md"] }), "utf8");
		// a.md deliberately does not exist: the file lists as missing, so the
		// command path creates no real fs.watch instance (tests stay under the
		// system inotify instance limit even on loaded machines).
		const commands = new Map<string, { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
		const pi = {
			registerTool: vi.fn(),
			registerCommand: vi.fn((name: string, opts: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
				commands.set(name, opts);
			}),
			on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
				handlers.set(event, handler);
			}),
			sendMessage: vi.fn(),
		};
		fileWatchExtension(pi as never);
		const { ctx, overlay } = context({ mode: "rpc" });
		ctx.ui.custom = vi.fn();
		const command = commands.get("file-watch");
		if (!command) throw new Error("file-watch command missing");
		await command.handler("", ctx);
		try {
			expect(overlay()).toBeUndefined();
			expect(ctx.ui.custom).not.toHaveBeenCalled();
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("file-watch", expect.any(String));
			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("a.md"), "info");
		} finally {
			const shutdown = handlers.get("session_shutdown");
			if (shutdown) await shutdown({}, ctx);
		}
	});
});