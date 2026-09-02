import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createBoostSettingsWriter,
	DEFAULT_BOOST_SETTINGS,
	resolveEffectiveBoostSettings,
	saveBoostSettings,
} from "../../extensions/pi-boost/boost-settings.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openBoostSettingsOverlay } from "../../extensions/pi-boost/boost/boost-settings-overlay.js";
import {
	AUTO_MODEL_SELECTION_LABEL,
	formatModelSelection,
	listTextCapableModels,
	toggleModelSelection,
} from "../../extensions/pi-boost/boost/model-selection.js";
import { DEFAULT_BOOST_HOST_CAPABILITIES } from "../../extensions/pi-boost/boost/host-capabilities.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<{
	root: string;
	globalPath: string;
	projectPath: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "boost-settings-"));
	roots.push(root);
	const globalPath = join(root, "global-settings.json");
	const projectPath = join(root, ".pi", "settings.json");
	return { root, globalPath, projectPath };
}

describe("Boost standard settings precedence and trust", () => {
	it("defaults to single-model mode and honors explicit mode overrides", async () => {
		const paths = await workspace();
		const defaults = resolveEffectiveBoostSettings(
			paths.root,
			false,
			paths.globalPath,
		);
		expect(defaults.mode).toBe("single");
		await saveBoostSettings(
			"global",
			{ mode: "fusion" },
			paths.root,
			paths.globalPath,
		);
		await saveBoostSettings(
			"project",
			{ mode: "single" },
			paths.root,
			paths.globalPath,
		);
		const settings = resolveEffectiveBoostSettings(
			paths.root,
			true,
			paths.globalPath,
		);
		expect(settings.mode).toBe("single");
		expect(settings.sources.mode).toBe("project");
		const untrusted = resolveEffectiveBoostSettings(
			paths.root,
			false,
			paths.globalPath,
		);
		expect(untrusted.mode).toBe("fusion");
		expect(untrusted.sources.mode).toBe("global");
	});

	it("defaults deny agent self-boost and ignores untrusted project settings", async () => {
		const paths = await workspace();
		await saveBoostSettings(
			"global",
			{ profile: "fast", panelSize: 2 },
			paths.root,
			paths.globalPath,
		);
		await saveBoostSettings(
			"project",
			{
				profile: "thorough",
				agentSelfBoost: { enabled: true, allowCognitive: true },
			},
			paths.root,
			paths.globalPath,
		);
		const untrusted = resolveEffectiveBoostSettings(
			paths.root,
			false,
			paths.globalPath,
		);
		expect(untrusted.profile).toBe("fast");
		expect(untrusted.agentSelfBoost.enabled).toBe(false);
		const trusted = resolveEffectiveBoostSettings(
			paths.root,
			true,
			paths.globalPath,
		);
		expect(trusted.profile).toBe("thorough");
		expect(trusted.agentSelfBoost).toMatchObject({
			enabled: true,
			allowCognitive: true,
		});
	});

	it("merges nested project agent policy without resetting inherited global caps", async () => {
		const paths = await workspace();
		await saveBoostSettings(
			"global",
			{
				agentSelfBoost: {
					enabled: false,
					maxYields: 1,
					maxPanelModels: 2,
					allowEnvironmental: true,
					allowCognitive: false,
				},
			},
			paths.root,
			paths.globalPath,
		);
		await saveBoostSettings(
			"project",
			{ agentSelfBoost: { enabled: true } },
			paths.root,
			paths.globalPath,
		);
		const settings = resolveEffectiveBoostSettings(
			paths.root,
			true,
			paths.globalPath,
		);
		expect(settings.agentSelfBoost).toEqual({
			enabled: true,
			maxYields: 1,
			maxPanelModels: 2,
			allowEnvironmental: true,
			allowCognitive: false,
		});
	});

	it("validates caps and model identities rather than trusting raw JSON", async () => {
		const paths = await workspace();
		await writeFile(
			paths.globalPath,
			JSON.stringify({
				boost: {
					profile: "unbounded",
					panelSize: 99,
					models: ["bad", "ok/model", "ok/model"],
					timeoutMs: 999_999,
					agentSelfBoost: {
						enabled: "yes",
						maxYields: 99,
						maxPanelModels: 99,
						allowEnvironmental: "yes",
						allowCognitive: true,
					},
				},
			}),
		);
		const settings = resolveEffectiveBoostSettings(
			paths.root,
			false,
			paths.globalPath,
		);
		expect(settings.profile).toBe(DEFAULT_BOOST_SETTINGS.profile);
		expect(settings.panelSize).toBe(DEFAULT_BOOST_SETTINGS.panelSize);
		expect(settings.models).toEqual(["ok/model"]);
		expect(settings.timeoutMs).toBe(DEFAULT_BOOST_SETTINGS.timeoutMs);
		expect(settings.agentSelfBoost).toMatchObject({
			enabled: false,
			maxYields: 3,
			maxPanelModels: 3,
			allowEnvironmental: false,
			allowCognitive: true,
		});
	});

	it("atomically merges only the selected namespaced scope", async () => {
		const paths = await workspace();
		await writeFile(
			paths.globalPath,
			JSON.stringify({
				theme: "dark",
				boost: { profile: "fast", agentSelfBoost: { enabled: false } },
			}),
		);
		await saveBoostSettings(
			"global",
			{ panelSize: 2, agentSelfBoost: { allowCognitive: true } },
			paths.root,
			paths.globalPath,
		);
		const raw = JSON.parse(await readFile(paths.globalPath, "utf8"));
		expect(raw).toMatchObject({
			theme: "dark",
			boost: {
				profile: "fast",
				panelSize: 2,
				agentSelfBoost: { enabled: false, allowCognitive: true },
			},
		});
	});

	it("serializes rapid writes and persists each selected standard scope", async () => {
		const paths = await workspace();
		const writer = createBoostSettingsWriter(paths.root, paths.globalPath);
		writer.enqueue("global", { profile: "fast" });
		writer.enqueue("global", { panelSize: 2 });
		writer.enqueue("project", { profile: "thorough" });
		await writer.drain();
		expect(
			resolveEffectiveBoostSettings(paths.root, false, paths.globalPath),
		).toMatchObject({ profile: "fast", panelSize: 2 });
		expect(
			resolveEffectiveBoostSettings(paths.root, true, paths.globalPath),
		).toMatchObject({ profile: "thorough", panelSize: 2 });
	});

	it("shows effective provenance through the non-interactive settings surface", async () => {
		const paths = await workspace();
		await saveBoostSettings(
			"global",
			{ profile: "fast", models: ["a/one"] },
			paths.root,
			paths.globalPath,
		);
		const notices: string[] = [];
		const ctx = {
			cwd: paths.root,
			hasUI: false,
			ui: {
				notify: (message: string) => {
					notices.push(message);
				},
			},
		} as unknown as ExtensionContext;
		await openBoostSettingsOverlay(ctx, {
			isProjectTrusted: () => false,
			globalSettingsPath: paths.globalPath,
		});
		expect(notices.join("\n")).toContain("profile: fast [global]");
	});

	it("shows the auto host-registry state when no models are configured", async () => {
		const paths = await workspace();
		const notices: string[] = [];
		const ctx = {
			cwd: paths.root,
			hasUI: false,
			ui: {
				notify: (message: string) => {
					notices.push(message);
				},
			},
		} as unknown as ExtensionContext;
		await openBoostSettingsOverlay(ctx, {
			isProjectTrusted: () => false,
			globalSettingsPath: paths.globalPath,
		});
		const summary = notices.join("\n");
		expect(summary).toContain(AUTO_MODEL_SELECTION_LABEL);
		expect(summary).toContain("execution: 1 model, no judge");
	});

	it("persists and clears model selections through the scoped writer", async () => {
		const paths = await workspace();
		const writer = createBoostSettingsWriter(paths.root, paths.globalPath);
		writer.enqueue("global", { models: ["a/one", "b/two"] });
		await writer.drain();
		expect(
			resolveEffectiveBoostSettings(paths.root, false, paths.globalPath).models,
		).toEqual(["a/one", "b/two"]);
		writer.enqueue("global", { models: [] });
		await writer.drain();
		expect(
			resolveEffectiveBoostSettings(paths.root, false, paths.globalPath).models,
		).toEqual([]);
	});

	it("uses a typed host trust method when available and otherwise fails closed", () => {
		expect(
			DEFAULT_BOOST_HOST_CAPABILITIES.isProjectTrusted("/x", { cwd: "/x" }),
		).toBe(false);
		const context = { cwd: "/x", isProjectTrusted: () => true };
		expect(
			DEFAULT_BOOST_HOST_CAPABILITIES.isProjectTrusted("/x", context),
		).toBe(true);
	});
});

describe("Boost model selection (ADR-056)", () => {
	it("defaults to an empty auto model selection with no provider IDs", () => {
		expect(DEFAULT_BOOST_SETTINGS.models).toEqual([]);
	});

	it("lists only text-capable host registry models in registry order", () => {
		const ctx = {
			modelRegistry: {
				getAvailable: () => [
					{ provider: "a", id: "one", input: ["text"] },
					{ provider: "img", id: "vision", input: ["image"] },
					{ provider: "b", id: "two", input: ["text", "image"] },
				],
			},
		} as unknown as ExtensionContext;
		expect(listTextCapableModels(ctx)).toEqual(["a/one", "b/two"]);
	});

	it("toggles models with ordered membership and the hard panel cap", () => {
		let selected: readonly string[] = [];
		selected = toggleModelSelection(selected, "a/one");
		selected = toggleModelSelection(selected, "b/two");
		expect(selected).toEqual(["a/one", "b/two"]);
		selected = toggleModelSelection(selected, "b/two");
		expect(selected).toEqual(["a/one"]);
		const full = ["a/1", "b/2", "c/3", "d/4"];
		expect(toggleModelSelection(full, "e/5")).toEqual(full);
		expect(toggleModelSelection(full, "a/1")).toEqual(["b/2", "c/3", "d/4"]);
	});

	it("formats auto and explicit selection states", () => {
		expect(formatModelSelection([])).toBe(AUTO_MODEL_SELECTION_LABEL);
		expect(formatModelSelection(["a/one", "b/two"])).toBe(
			"2 selected: a/one, b/two",
		);
	});
});
