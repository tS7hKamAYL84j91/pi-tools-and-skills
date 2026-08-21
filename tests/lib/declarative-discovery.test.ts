import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	discoverDeclarativeRoots,
	discoverFixedTargets,
	discoverMarkdownDirectories,
	findDeclarativeProjectRoot,
} from "../../lib/declarative-discovery.js";
import { assertProperty } from "./fast-check.js";

function options(cwd: string, values: Record<string, unknown> = {}, roots?: readonly string[]) {
	return {
		configPath: join(cwd, "package", "config", "config.json"), settingsKey: "extension",
		readSettingsKey: (_key: string, path: string): unknown => values[path],
		userSettingsPath: join(cwd, "user-settings.json"), userFallbackRoot: "/user-fallback",
		projectSettingsRelativePath: join(".pi", "settings.json"), projectFallbackRoot: join(".pi", "extension"), cwd,
		...(roots === undefined ? {} : { roots }),
	};
}

describe("declarative discovery", () => {
	it("orders builtin, configured user, and configured project roots with lexical expansion", () => {
		const cwd = mkdtempSync(join(tmpdir(), "discovery-"));
		mkdirSync(join(cwd, ".git"));
		const userSettings = join(cwd, "user-settings.json");
		const projectSettings = join(cwd, ".pi", "settings.json");
		const roots = discoverDeclarativeRoots(options(cwd, {
			[userSettings]: { roots: ["relative-user", " ~/configured ", "", 1] },
			[projectSettings]: { roots: ["relative-project", "/project-absolute"] },
		}));
		expect(roots).toEqual([
			{ source: "builtin", root: join(cwd, "package", "config") },
			{ source: "user", root: resolve(cwd, "relative-user") },
			{ source: "user", root: join(homedir(), "configured") },
			{ source: "project", root: resolve(cwd, "relative-project") },
			{ source: "project", root: "/project-absolute" },
		]);
	});

	it("uses fallback roots for missing, malformed, or invalid settings while preserving project markers", () => {
		const root = mkdtempSync(join(tmpdir(), "discovery-"));
		const cwd = join(root, "nested", "deeper");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(root, "package.json"), "{}");
		const projectSettings = join(root, ".pi", "settings.json");
		for (const value of [undefined, null, [], {}, { roots: "wrong" }, { roots: ["", null] }]) {
			const discovered = discoverDeclarativeRoots(options(cwd, { [projectSettings]: value }));
			expect(discovered.map((entry) => entry.root)).toEqual([
				join(cwd, "package", "config"), "/user-fallback", join(root, ".pi", "extension"),
			]);
		}
		expect(findDeclarativeProjectRoot(cwd)).toBe(root);
		const noMarker = mkdtempSync(join(tmpdir(), "discovery-no-marker-"));
		expect(findDeclarativeProjectRoot(noMarker)).toBe(noMarker);
	});

	it("explicit roots skip settings and project discovery, including an empty list", () => {
		const cwd = "/cwd";
		const called: string[] = [];
		const base = options(cwd, {}, ["same", "same"]);
		const roots = discoverDeclarativeRoots({ ...base, readSettingsKey: (key, path) => { called.push(`${key}:${path}`); return { roots: ["ignored"] }; } });
		expect(roots).toEqual([
			{ source: "builtin", root: join(cwd, "package", "config") }, { source: "user", root: "same" }, { source: "user", root: "same" },
		]);
		expect(called).toEqual([]);
		expect(discoverDeclarativeRoots(options(cwd, {}, [])).map((entry) => entry.source)).toEqual(["builtin"]);
	});

	it("enumerates only immediate lexical Markdown entries, retains duplicates, and propagates directory errors", () => {
		const cwd = mkdtempSync(join(tmpdir(), "discovery-"));
		const root = join(cwd, "root");
		mkdirSync(join(root, "items", "nested"), { recursive: true });
		writeFileSync(join(root, "items", "z.md"), "z");
		writeFileSync(join(root, "items", "a.md"), "a");
		writeFileSync(join(root, "items", "nested", "hidden.md"), "hidden");
		writeFileSync(join(root, "items", "skip.MD"), "skip");
		symlinkSync(join(root, "items"), join(root, "linked"));
		const roots = [{ source: "user" as const, root }, { source: "user" as const, root }];
		expect(discoverMarkdownDirectories(roots, ["items", "linked"]).map((entry) => entry.path)).toEqual([
			join(root, "items", "a.md"), join(root, "items", "z.md"), join(root, "linked", "a.md"), join(root, "linked", "z.md"),
			join(root, "items", "a.md"), join(root, "items", "z.md"), join(root, "linked", "a.md"), join(root, "linked", "z.md"),
		]);
		writeFileSync(join(root, "file.md"), "not a directory");
		expect(() => discoverMarkdownDirectories([{ source: "user", root }], ["file.md"])).toThrow();
	});

	it("returns fixed targets lexically without probing, rewriting, or deduplicating", () => {
		const roots = [{ source: "builtin" as const, root: "/built" }, { source: "user" as const, root: "/same" }, { source: "user" as const, root: "/same" }];
		expect(discoverFixedTargets(roots, join("nested", "boost.md"))).toEqual([
			{ source: "builtin", root: "/built", path: join("/built", "nested", "boost.md") },
			{ source: "user", root: "/same", path: join("/same", "nested", "boost.md") },
			{ source: "user", root: "/same", path: join("/same", "nested", "boost.md") },
		]);
	});

	it("property: explicit roots retain exact order and duplicates (FC_SEED is recorded by helper)", () => {
		assertProperty(fc.property(fc.array(fc.string(), { maxLength: 20 }), (roots) => {
			const discovered = discoverDeclarativeRoots(options("/cwd", {}, roots));
			expect(discovered.slice(1).map((entry) => entry.root)).toEqual(roots);
		}));
	});
});
