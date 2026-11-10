/**
 * Tests for setup-pi package settings wiring.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
const MAKE_FILE = join(process.cwd(), "Makefile");
const SETUP_PI_SCRIPT = join(process.cwd(), "scripts", "setup-pi");
const SETUP_PI_CLEAN_SCRIPT = join(process.cwd(), "scripts", "setup-pi-clean");
const SHIPPED_EXTENSIONS_DIR = join(process.cwd(), "extensions");
const GLOBAL_EXTENSION_ALLOWLIST = [
	"extensions/pi-agent-hub/**",
	"extensions/pi-subagents/**",
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

/** Package sets declared by the settings helper, in file order. */
function declaredPackageSets(): {
	userInstallable: string[];
	projectOnly: string[];
} {
	const source = readFileSync(SETTINGS_SCRIPT, "utf8");
	const read = (name: string): string[] => {
		const block = new RegExp(`${name} = \\{([\\s\\S]*?)\\}`).exec(source);
		const body = block?.[1];
		if (body === undefined) {
			throw new Error(`${name} not found in pi-package-settings.py`);
		}
		return [...body.matchAll(/"([^"]+)"/g)].flatMap((match) => match[1] ?? []);
	};
	return {
		userInstallable: read("USER_INSTALLABLE_PACKAGES"),
		projectOnly: read("PROJECT_ONLY_PACKAGES"),
	};
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

	it("registers standalone pi-subagents without Agent Hub", () => {
		runSettingsHelper("register-package", "pi-subagents");

		expect(readSettings().packages).toEqual([{ source: join(packageDir, "extensions", "pi-subagents") }]);
	});

	it("registers standalone pi-team-workflows independently", () => {
		runSettingsHelper("register-package", "pi-team-workflows");

		const settings = readSettings();
		expect(settings.extensions).toBeUndefined();
		expect(settings.packages).toEqual([{ source: join(packageDir, "extensions", "pi-team-workflows") }]);
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
						join(extensionsDir, "pi-agent-hub"),
						join(extensionsDir, "pi-subagents"),
						join(extensionsDir, "pi-team-workflows"),
						join(extensionsDir, "pi-kanban"),
						join(extensionsDir, "pi-automations"),
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

describeIfPython("setup-pi package classification", () => {
	it("classifies every extension package that ships a manifest", () => {
		const { userInstallable, projectOnly } = declaredPackageSets();
		const classified = new Set([...userInstallable, ...projectOnly]);
		const shipped = readdirSync(SHIPPED_EXTENSIONS_DIR, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() &&
					existsSync(join(SHIPPED_EXTENSIONS_DIR, entry.name, "package.json")),
			)
			.map((entry) => entry.name);

		expect(shipped.length).toBeGreaterThan(0);
		expect(shipped.filter((name) => !classified.has(name))).toEqual([]);
	});

	it("advertises the same user-installable packages in make and setup-pi help", () => {
		const { userInstallable } = declaredPackageSets();
		const advertised = [...userInstallable].sort().join("|");
		const makefile = readFileSync(MAKE_FILE, "utf8");
		const setupPi = readFileSync(SETUP_PI_SCRIPT, "utf8");
		const setupTarget = makefile
			.split("\n")
			.find((line) => line.startsWith("setup-package:"));
		const cleanTarget = makefile
			.split("\n")
			.find((line) => line.startsWith("setup-package-clean:"));

		expect(setupTarget).toContain(advertised);
		expect(cleanTarget).toContain(advertised);
		for (const name of userInstallable) expect(setupPi).toContain(name);
	});
});

describeIfPython("setup-pi settings scope", () => {
	function runScript(
		script: string,
		args: string[],
		home: string,
	) {
		return spawnSync(script, args, {
			encoding: "utf8",
			env: { ...process.env, HOME: home },
		});
	}

	function readJson(path: string): PiSettings {
		return JSON.parse(readFileSync(path, "utf8")) as PiSettings;
	}

	it("registers into one project's settings file when --project is given", () => {
		const home = join(tmpDir, "home");
		const projectDir = join(tmpDir, "workspace");
		mkdirSync(projectDir, { recursive: true });

		const result = runScript(SETUP_PI_SCRIPT, ["--project", projectDir], home);

		expect(result.status).toBe(0);
		const settings = readJson(join(projectDir, ".pi", "settings.json"));
		expect(settings.packages).toEqual([
			{
				source: realpathSync(process.cwd()),
				extensions: GLOBAL_EXTENSION_ALLOWLIST,
			},
		]);
		expect(existsSync(join(home, ".pi", "agent", "settings.json"))).toBe(false);
	});

	it("registers globally when --project is omitted", () => {
		const home = join(tmpDir, "home-global");
		mkdirSync(home, { recursive: true });

		const result = runScript(SETUP_PI_SCRIPT, [], home);

		expect(result.status).toBe(0);
		const settings = readJson(join(home, ".pi", "agent", "settings.json"));
		expect(settings.packages).toEqual([
			{
				source: realpathSync(process.cwd()),
				extensions: GLOBAL_EXTENSION_ALLOWLIST,
			},
		]);
	});

	it("rejects a project directory that does not exist", () => {
		const result = runScript(
			SETUP_PI_SCRIPT,
			["--project", join(tmpDir, "absent")],
			join(tmpDir, "home-missing"),
		);

		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"project directory not found",
		);
	});

	it("cleans one project's settings file when --project is given", () => {
		const home = join(tmpDir, "home-clean");
		const projectDir = join(tmpDir, "workspace-clean");
		mkdirSync(projectDir, { recursive: true });
		runScript(SETUP_PI_SCRIPT, ["--project", projectDir], home);

		const result = runScript(SETUP_PI_CLEAN_SCRIPT, ["--project", projectDir], home);

		expect(result.status).toBe(0);
		const settings = readJson(join(projectDir, ".pi", "settings.json"));
		expect(settings.packages).toBeUndefined();
	});
});
