/**
 * Tests for setup-pi package settings wiring.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface PackageEntry {
	source?: string;
	extensions?: string[];
}

interface PiSettings {
	packages?: PackageEntry[];
	extensions?: string[];
}

const SETTINGS_SCRIPT = join(
	process.cwd(),
	"scripts",
	"pi-package-settings.py",
);
const GLOBAL_EXTENSION_ALLOWLIST = [
	"extensions/pi-panopticon/**",
	"extensions/pi-llm-council/**",
];

let tmpDir: string;
let settingsPath: string;
let packageDir: string;
let skillsDir: string;
let extensionsDir: string;
let promptsDir: string;

function hasPython3(): boolean {
	const result = spawnSync("python3", ["--version"], { encoding: "utf8" });
	return result.status === 0;
}

function runSettingsHelper(action: "register" | "clean"): void {
	const result = spawnSync(
		"python3",
		[
			SETTINGS_SCRIPT,
			action,
			settingsPath,
			packageDir,
			skillsDir,
			extensionsDir,
			promptsDir,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`pi-package-settings.py ${action} failed: ${result.stderr}`,
		);
	}
}

function readSettings(): PiSettings {
	return JSON.parse(readFileSync(settingsPath, "utf8")) as PiSettings;
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "setup-pi-wiring-"));
	settingsPath = join(tmpDir, "settings.json");
	packageDir = join(tmpDir, "pi-tools-and-skills");
	skillsDir = join(packageDir, "skills");
	extensionsDir = join(packageDir, "extensions");
	promptsDir = join(packageDir, "prompts");
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

const describeIfPython = hasPython3() ? describe : describe.skip;

describeIfPython("setup-pi package wiring", () => {
	it("globally enables the reusable operator extensions through the package filter", () => {
		runSettingsHelper("register");

		const settings = readSettings();
		expect(settings.extensions).toBeUndefined();
		expect(settings.packages).toHaveLength(1);
		expect(settings.packages?.[0]).toEqual({
			source: packageDir,
			extensions: GLOBAL_EXTENSION_ALLOWLIST,
		});
	});

	it("cleans legacy direct registrations for owned extensions", () => {
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					extensions: [
						join(extensionsDir, "pi-panopticon"),
						join(extensionsDir, "kanban"),
						"/external/extension",
					],
					packages: [
						{ source: packageDir, extensions: GLOBAL_EXTENSION_ALLOWLIST },
					],
				},
				null,
				2,
			),
		);

		runSettingsHelper("clean");

		const settings = readSettings();
		expect(settings.extensions).toEqual(["/external/extension"]);
		expect(settings.packages).toBeUndefined();
	});
});
