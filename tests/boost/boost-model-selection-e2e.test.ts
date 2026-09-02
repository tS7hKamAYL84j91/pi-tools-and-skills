/** End-to-end model-selection persistence tests for the /boost settings overlay (ADR-056). */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createBoostSettingsWriter,
	resolveEffectiveBoostSettings,
} from "../../extensions/pi-boost/boost-settings.js";
import {
	AUTO_MODEL_SELECTION_LABEL,
	formatModelSelection,
	toggleModelSelection,
} from "../../extensions/pi-boost/boost/model-selection.js";
import { HARD_MAX_PANEL_MODELS } from "../../extensions/pi-boost/boost/cognitive-types.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		tempDir = "";
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "boost-model-e2e-"));
	return tempDir;
}

describe("boost model selection persistence (e2e)", () => {
	it("persists toggled models through the settings writer and reads them back", async () => {
		const cwd = await makeTempDir();
		const globalPath = join(cwd, "global-settings.json");
		const writer = createBoostSettingsWriter(cwd, globalPath);

		// Simulate: user toggles two models in the /boost overlay.
		let selected: string[] = [];
		selected = [...toggleModelSelection(selected, "synth/alpha")];
		selected = [...toggleModelSelection(selected, "synth/beta")];
		expect(selected).toEqual(["synth/alpha", "synth/beta"]);

		// Simulate: overlay persists on toggle and drains on close.
		writer.enqueue("global", { models: selected });
		await writer.drain();

		// Verify: settings file contains exactly the selected models.
		const settings = JSON.parse(await readFile(globalPath, "utf8")) as {
			boost?: { models?: string[] };
		};
		expect(settings.boost?.models).toEqual(["synth/alpha", "synth/beta"]);

		// Verify: effective settings resolve the persisted models.
		const effective = resolveEffectiveBoostSettings(cwd, false, globalPath);
		expect(effective.models).toEqual(["synth/alpha", "synth/beta"]);
		expect(effective.sources.models).toBe("global");
	});

	it("persists a cleared selection back to auto mode", async () => {
		const cwd = await makeTempDir();
		const globalPath = join(cwd, "global-settings.json");
		const writer = createBoostSettingsWriter(cwd, globalPath);

		// Select models first.
		writer.enqueue("global", { models: ["synth/alpha"] });
		await writer.drain();

		// Simulate: user clears the selection in the overlay.
		writer.enqueue("global", { models: [] });
		await writer.drain();

		// Verify: empty selection reads back as auto (no models override).
		const effective = resolveEffectiveBoostSettings(cwd, false, globalPath);
		expect(effective.models).toEqual([]);
		expect(effective.sources.models).toBe("default");
	});

	it("enforces the hard panel cap on toggles", async () => {
		let selected: string[] = [];
		for (let i = 0; i < HARD_MAX_PANEL_MODELS + 2; i++) {
			selected = [...toggleModelSelection(selected, `synth/model-${i}`)];
		}
		expect(selected.length).toBe(HARD_MAX_PANEL_MODELS);
	});

	it("toggle removes an already-selected model", () => {
		const selected = ["a/one", "b/two"];
		expect(toggleModelSelection(selected, "a/one")).toEqual(["b/two"]);
		expect(toggleModelSelection(selected, "c/three")).toEqual([
			"a/one",
			"b/two",
			"c/three",
		]);
	});

	it("formatModelSelection shows auto for empty and count for non-empty", () => {
		expect(formatModelSelection([])).toBe(AUTO_MODEL_SELECTION_LABEL);
		expect(formatModelSelection(["a/one"])).toBe("1 selected: a/one");
		expect(formatModelSelection(["a/one", "b/two"])).toBe(
			"2 selected: a/one, b/two",
		);
	});

	it("serializes multiple overlay persist calls in order", async () => {
		const cwd = await makeTempDir();
		const globalPath = join(cwd, "global-settings.json");
		const writer = createBoostSettingsWriter(cwd, globalPath);

		// Simulate rapid toggles in the overlay before drain.
		writer.enqueue("global", { models: ["a/one"] });
		writer.enqueue("global", { models: ["a/one", "b/two"] });
		writer.enqueue("global", { models: ["b/two"] });
		await writer.drain();

		const effective = resolveEffectiveBoostSettings(cwd, false, globalPath);
		expect(effective.models).toEqual(["b/two"]);
	});
});
