import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	discoverDeclarativeRoots,
	discoverFixedTargets,
	discoverMarkdownDirectories,
	findDeclarativeProjectRoot,
} from "../../lib/declarative-discovery.js";
import { assertProperty } from "./fast-check.js";

function options(cwd: string, roots?: readonly string[]) {
	return {
		configPath: join(cwd, "package", "config", "config.json"), settingsKey: "extension",
		readSettingsKey: (key: string, path: string): unknown => path.includes("user") && key === "extension"
			? { roots: ["relative-user", " ~/configured ", ""] } : undefined,
		userSettingsPath: join(cwd, "user-settings.json"), userFallbackRoot: "/user-fallback",
		projectSettingsRelativePath: join(".pi", "settings.json"), projectFallbackRoot: join(".pi", "extension"), cwd, roots,
	};
}

describe("declarative discovery", () => {
	it("preserves builtin/user/project precedence, lexical duplicates, and explicit roots", () => {
		const cwd = mkdtempSync(join(tmpdir(), "discovery-"));
		mkdirSync(join(cwd, ".git"));
		expect(discoverDeclarativeRoots(options(cwd)).map((root) => root.source)).toEqual(["builtin", "user", "user", "project"]);
		expect(discoverDeclarativeRoots(options(cwd, ["same", "same"])).map((root) => root.root)).toEqual([
			join(cwd, "package", "config"), "same", "same",
		]);
	});

	it("enumerates immediate Markdown files lexically and leaves symlink paths lexical", () => {
		const cwd = mkdtempSync(join(tmpdir(), "discovery-"));
		const root = join(cwd, "root");
		mkdirSync(join(root, "items"), { recursive: true });
		writeFileSync(join(root, "items", "z.md"), "z");
		writeFileSync(join(root, "items", "a.md"), "a");
		writeFileSync(join(root, "items", "skip.txt"), "skip");
		symlinkSync(join(root, "items"), join(root, "linked"));
		const roots = [{ source: "user" as const, root }];
		expect(discoverMarkdownDirectories(roots, ["items", "linked"]).map((path) => path.path)).toEqual([
			join(root, "items", "a.md"), join(root, "items", "z.md"), join(root, "linked", "a.md"), join(root, "linked", "z.md"),
		]);
		expect(discoverFixedTargets(roots, "boost.md")[0]?.path).toBe(join(root, "boost.md"));
		expect(findDeclarativeProjectRoot(join(cwd, "missing"))).toBe(join(cwd, "missing"));
	});

	it("property: explicit roots retain exact order and duplicates (FC_SEED is recorded by helper)", () => {
		assertProperty(fc.property(fc.array(fc.string(), { maxLength: 20 }), (roots) => {
			const discovered = discoverDeclarativeRoots(options("/cwd", roots));
			expect(discovered.slice(1).map((root) => root.root)).toEqual(roots);
		}));
	});
});
