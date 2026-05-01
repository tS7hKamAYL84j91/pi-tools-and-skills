import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readPiSettingsKey } from "../lib/pi-settings.js";

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
	path = join(dir, "settings.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("readPiSettingsKey", () => {
	it("returns undefined when the file is missing", () => {
		expect(readPiSettingsKey("council", path)).toBeUndefined();
	});

	it("returns undefined when the file is malformed", () => {
		writeFileSync(path, "{ this is not json ");
		expect(readPiSettingsKey("council", path)).toBeUndefined();
	});

	it("returns undefined when the key is absent", () => {
		writeFileSync(path, JSON.stringify({ matrix: { homeserver: "x" } }));
		expect(readPiSettingsKey("council", path)).toBeUndefined();
	});

	it("returns the raw value at the key when present", () => {
		const settings = { council: { defaultChairman: "openai/gpt-5.5" } };
		writeFileSync(path, JSON.stringify(settings));
		expect(readPiSettingsKey("council", path)).toEqual({
			defaultChairman: "openai/gpt-5.5",
		});
	});

	it("returns array values when the key holds an array", () => {
		writeFileSync(path, JSON.stringify({ skills: ["/a", "/b"] }));
		expect(readPiSettingsKey("skills", path)).toEqual(["/a", "/b"]);
	});

	it("returns null when the key is explicitly null in JSON", () => {
		writeFileSync(path, JSON.stringify({ council: null }));
		expect(readPiSettingsKey("council", path)).toBeNull();
	});
});
