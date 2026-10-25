/**
 * pi-overview overlay input: the panel closes on esc, q and enter.
 *
 * Renders nothing here — it only proves the component's handleInput contract, so
 * no terminal or TUI runtime is needed.
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import overviewExtension from "../../extensions/pi-overview/index.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Overlay {
	/** Feed one raw key to the overlay; true when that key closed it. */
	readonly press: (data: string) => boolean;
}

/** Run /overview against a fake host and return the opened overlay component. */
async function openOverlay(): Promise<Overlay> {
	const cwd = mkdtempSync(join(tmpdir(), "pi-overview-overlay-"));
	dirs.push(cwd);
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	overviewExtension({
		registerCommand: (_name: string, command: { handler: typeof handler }) => {
			handler = command.handler;
		},
	} as unknown as ExtensionAPI);
	if (!handler) throw new Error("/overview was not registered");

	let component: Component | undefined;
	let closed = false;
	let opened = false;
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		model: { provider: "test", id: "model" },
		sessionManager: {
			getSessionName: () => undefined,
			getEntries: () => [],
		},
		getContextUsage: () => undefined,
		isIdle: () => true,
		ui: {
			notify: vi.fn(),
			custom: async (
				factory: (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => Component,
			) => {
				component = factory({ requestRender: () => {} }, fakeTheme, {}, () => {
					closed = true;
				});
				opened = true;
			},
		},
	} as unknown as ExtensionCommandContext;

	await handler("", ctx);
	if (!opened || !component) throw new Error("/overview did not open an overlay");

	return {
		press: (data: string) => {
			component?.handleInput?.(data);
			return closed;
		},
	};
}

describe("pi-overview overlay keys", () => {
	it.each([
		["q", "q"],
		["escape", "\u001b"],
		["enter", "\r"],
	])("closes on %s", async (_name, data) => {
		const overlay = await openOverlay();
		expect(overlay.press(data)).toBe(true);
	});

	it("ignores unrelated keys", async () => {
		const overlay = await openOverlay();
		expect(overlay.press("j")).toBe(false);
	});
});
