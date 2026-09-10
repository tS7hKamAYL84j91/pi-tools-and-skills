/** Real Pi selector/settings components; disposable settings and mocked registry only. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, ModelSelectorComponent, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBoostSettingsOverlay } from "../../extensions/pi-boost/boost-settings-overlay.js";
import { resolveBoostModel, resolveLeaseMinutes } from "../../extensions/pi-boost/boost-settings.js";
import { createBoostModelPicker } from "../../extensions/pi-boost/model-picker.js";

type Model = NonNullable<ExtensionContext["model"]>;
const baseline = { provider: "fixture", id: "baseline", name: "Baseline", input: ["text"] } as Model;
const boost = { provider: "fixture", id: "org/boost:latest", name: "Better reasoning", input: ["text"] } as Model;
const tui = { requestRender: vi.fn() } as unknown as TUI;
let home: string;
let settingsPath: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "boost-settings-"));
	vi.stubEnv("HOME", home);
	settingsPath = join(home, ".pi", "agent", "settings.json");
	await mkdir(join(home, ".pi", "agent"), { recursive: true });
	await writeFile(settingsPath, JSON.stringify({ defaultModel: "unchanged", boost: { maxYields: 2 } }), { mode: 0o600 });
	initTheme("dark", false);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(home, { recursive: true, force: true });
});

function context() {
	return {
		cwd: home, mode: "tui", hasUI: true, model: baseline, scopedModels: [],
		modelRegistry: {
			getAvailable: () => [baseline, boost],
			find: (provider: string, id: string) => [baseline, boost].find(model => model.provider === provider && model.id === id),
			getError: () => undefined,
			refresh: vi.fn(async () => ({ errors: new Map(), aborted: false })),
		},
		ui: { notify: vi.fn(), custom: vi.fn() },
	} as unknown as ExtensionContext;
}

function type(component: Component, text: string) {
	for (const char of text) component.handleInput?.(char);
}

describe("Boost lease duration settings", () => {
	it.each([undefined, null, 0, -1, 61, 1.5, "30", true])("defaults invalid duration %j to 10 minutes", async (leaseMinutes) => {
		await writeFile(settingsPath, JSON.stringify({ boost: { leaseMinutes } }));
		expect(await resolveLeaseMinutes(home)).toBe(10);
	});
	it.each([1, 5, 10, 15, 30, 60])("loads a valid %i-minute duration", async (leaseMinutes) => {
		await writeFile(settingsPath, JSON.stringify({ boost: { leaseMinutes } }));
		expect(await resolveLeaseMinutes(home)).toBe(leaseMinutes);
	});
});

describe("Boost native model selector", () => {
	it("uses Pi's actual component, name search, and slash-containing registry IDs", async () => {
		const ctx = context();
		const done = vi.fn();
		const picker = createBoostModelPicker(ctx, tui, "auto", done);
		try {
			expect(picker).toBeInstanceOf(ModelSelectorComponent);
			expect(ctx.modelRegistry.refresh).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
			type(picker, "Better reasoning");
			picker.handleInput("\r");
			expect(done).toHaveBeenCalledWith("fixture/org/boost:latest");
			expect(ctx.model).toBe(baseline);
		} finally { picker.dispose(); }
	});

	it("honors scoped models and supports Pi's Tab switch to the full catalog", () => {
		const ctx = context();
		const done = vi.fn();
		const picker = createBoostModelPicker({ ...ctx, scopedModels: [{ model: baseline }] }, tui, "auto", done);
		try {
			type(picker, "Better reasoning");
			picker.handleInput("\r");
			expect(done).not.toHaveBeenCalled();
			picker.handleInput("\t");
			picker.handleInput("\r");
			expect(done).toHaveBeenCalledWith("fixture/org/boost:latest");
		} finally { picker.dispose(); }
	});

	it("cancels without selecting and aborts the catalog refresh", async () => {
		const ctx = context();
		vi.mocked(ctx.modelRegistry.refresh).mockImplementationOnce(() => new Promise(() => {}));
		const done = vi.fn();
		const picker = createBoostModelPicker(ctx, tui, "auto", done);
		const options = vi.mocked(ctx.modelRegistry.refresh).mock.calls[0]?.[0];
		picker.handleInput("\x1b");
		expect(done).toHaveBeenCalledWith();
		// Native selector owns cancellation and timeout cleanup.
		picker.dispose();
		await vi.waitFor(() => expect(options?.signal?.aborted).toBe(true));
	});

	it("handles an empty catalog without inventing a selection", () => {
		const ctx = context();
		ctx.modelRegistry.getAvailable = () => [];
		const done = vi.fn();
		const picker = createBoostModelPicker(ctx, tui, "auto", done);
		try {
			picker.handleInput("\r");
			expect(done).not.toHaveBeenCalled();
			picker.handleInput("\x1b");
			expect(done).toHaveBeenCalledWith();
		} finally { picker.dispose(); }
	});

	it("preselects the configured boost model without changing session defaults", () => {
		const ctx = context();
		const done = vi.fn();
		const picker = createBoostModelPicker(ctx, tui, "fixture/org/boost:latest", done);
		try {
			picker.handleInput("\r");
			expect(done).toHaveBeenCalledWith("fixture/org/boost:latest");
			expect(ctx.model).toBe(baseline);
		} finally { picker.dispose(); }
	});

	it("opens from the model row, saves before returning, and updates the displayed value", async () => {
		const ctx = context();
		ctx.ui.custom = vi.fn(async (factory) => {
			const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
			const done = vi.fn();
			const component = await factory(tui, theme as never, {} as never, done) as Component & Focusable & { dispose?(): void };
			try {
				component.focused = true;
				expect(component.render(80).join("\n")).toContain("Boost model");
				component.handleInput?.("\r");
				type(component, "Better reasoning");
				component.handleInput?.("\r");
				expect(component.render(80).join("\n")).toContain("fixture/org/boost:latest");
				component.handleInput?.("\x1b[B");
				component.handleInput?.("\r"); // maxYields 2 -> 3
				component.handleInput?.("\x1b[B");
				expect(component.render(80).join("\n")).toContain("Lease time (minutes)");
				component.handleInput?.("\r"); // leaseMinutes 10 -> 15
				component.handleInput?.("\x1b");
				expect(done).toHaveBeenCalledOnce();
			} finally { component.dispose?.(); }
			return undefined;
		}) as ExtensionContext["ui"]["custom"];
		await openBoostSettingsOverlay(ctx);
		expect(await resolveBoostModel(home)).toBe("fixture/org/boost:latest");
		expect(await resolveLeaseMinutes(home)).toBe(15);
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({ defaultModel: "unchanged", boost: { model: "fixture/org/boost:latest", maxYields: 3, leaseMinutes: 15 } });
		expect(ctx.model).toBe(baseline);
	});

	it("Escape from the picker returns to settings without saving", async () => {
		const ctx = context();
		const before = await readFile(settingsPath, "utf8");
		ctx.ui.custom = vi.fn(async (factory) => {
			const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
			const done = vi.fn();
			const component = await factory(tui, theme as never, {} as never, done);
			component.handleInput?.("\r");
			type(component, "Better reasoning");
			component.handleInput?.("\x1b");
			expect(done).not.toHaveBeenCalled();
			expect(component.render(80).join("\n")).toContain("Boost model");
			component.handleInput?.("\x1b");
			expect(done).toHaveBeenCalledOnce();
			return undefined;
		}) as ExtensionContext["ui"]["custom"];
		await openBoostSettingsOverlay(ctx);
		expect(await readFile(settingsPath, "utf8")).toBe(before);
	});

	it.each(["rpc", "print"] as const)("does not open TUI components in %s mode", async (mode) => {
		const ctx = { ...context(), mode };
		await openBoostSettingsOverlay(ctx);
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Boost settings:"), "info");
	});
});
