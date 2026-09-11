import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readPiSettingsKey,
	savePiSettingsBlock,
} from "../../lib/pi-settings.js";

describe("pi-settings helper", () => {
	let tempDir: string;
	let settingsPath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "pi-settings-test-"));
		settingsPath = join(tempDir, "settings.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("reads a key from an existing settings file", async () => {
		await writeFile(
			settingsPath,
			JSON.stringify({ testKey: "testValue", num: 42 }),
		);
		expect(readPiSettingsKey("testKey", settingsPath)).toBe("testValue");
		expect(readPiSettingsKey("num", settingsPath)).toBe(42);
		expect(readPiSettingsKey("missing", settingsPath)).toBeUndefined();
	});

	it("returns undefined for missing or malformed files", () => {
		expect(
			readPiSettingsKey("key", join(tempDir, "nonexistent.json")),
		).toBeUndefined();
		expect(readPiSettingsKey("key", join(tempDir, "not-settings.txt"))).toBeUndefined();
	});

	it("creates a new settings file and persists a namespace block", async () => {
		await savePiSettingsBlock(
			"myNamespace",
			(block) => {
				block.enabled = true;
				block.count = 5;
			},
			settingsPath,
		);

		const raw = await readFile(settingsPath, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual({
			myNamespace: {
				enabled: true,
				count: 5,
			},
		});
	});

	it("merges into an existing namespace block preserving other keys", async () => {
		await writeFile(
			settingsPath,
			JSON.stringify({
				otherNamespace: { foo: "bar" },
				myNamespace: { existing: "value" },
			}),
		);

		await savePiSettingsBlock(
			"myNamespace",
			(block) => {
				block.added = 123;
			},
			settingsPath,
		);

		const raw = await readFile(settingsPath, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual({
			otherNamespace: { foo: "bar" },
			myNamespace: {
				existing: "value",
				added: 123,
			},
		});
	});
});
