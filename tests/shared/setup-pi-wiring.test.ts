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
	"extensions/pi-goal/**",
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

type SettingsAction = "register" | "clean" | "register-package" | "clean-package";

function runSettingsHelper(action: SettingsAction, packageName?: string): void {
	const args = [
		SETTINGS_SCRIPT,
		action,
		settingsPath,
		packageDir,
		skillsDir,
		extensionsDir,
		promptsDir,
	];
	if (packageName !== undefined) {
		args.push(packageName);
	}
	const result = spawnSync(
		"python3",
		args,
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`pi-package-settings.py ${action} failed: ${result.stderr}`,
		);
	}
}

function runSettingsHelperResult(action: "register-package" | "clean-package", packageName: string) {
	return spawnSync(
		"python3",
		[
			SETTINGS_SCRIPT,
			action,
			settingsPath,
			packageDir,
			skillsDir,
			extensionsDir,
			promptsDir,
			packageName,
		],
		{ encoding: "utf8" },
	);
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

	it("registers an individual user-installable package globally", () => {
		runSettingsHelper("register-package", "pi-matrix");

		const settings = readSettings();
		expect(settings.extensions).toBeUndefined();
		expect(settings.packages).toEqual([{ source: join(packageDir, "extensions", "pi-matrix") }]);
	});

	it("registers standalone pi-teams independently", () => {
		runSettingsHelper("register-package", "pi-teams");

		const settings = readSettings();
		expect(settings.extensions).toBeUndefined();
		expect(settings.packages).toEqual([{ source: join(packageDir, "extensions", "pi-teams") }]);
	});

	it("rejects pi-research-tools because canonical ownership moved to pi-extension-poc", () => {
		const result = runSettingsHelperResult("register-package", "pi-research-tools");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Unknown or non-user-installable package");
	});

	it("rejects project-only packages for global individual install", () => {
		const result = runSettingsHelperResult("register-package", "pi-kanban");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("pi-kanban is project-specific");
	});

	it("cleans an individual user-installable package registration", () => {
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					packages: [{ source: join(packageDir, "extensions", "pi-goal") }, { source: "/external/package" }],
				},
				null,
				2,
			),
		);

		runSettingsHelper("clean-package", "pi-goal");

		const settings = readSettings();
		expect(settings.packages).toEqual([{ source: "/external/package" }]);
	});

	it("cleans legacy direct registrations for owned extensions", () => {
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					extensions: [
						join(extensionsDir, "pi-panopticon"),
						join(extensionsDir, "pi-teams"),
						join(extensionsDir, "pi-kanban"),
						join(extensionsDir, "pi-coas"),
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
