/** Vendor-at-pack packaging regression: staged extensions are self-contained. */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildExtensionPackage, buildUmbrellaPackage, extensionDirectories } from "../../scripts/pack-packages.mjs";

const SPECIFIER = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

function tsFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) tsFiles(full, out);
		else if (full.endsWith(".ts")) out.push(full);
	}
	return out;
}

function escapingImports(staging: string): string[] {
	const problems: string[] = [];
	for (const file of tsFiles(staging)) {
		for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
			const specifier = match[1];
			if (!specifier) continue;
			const base = resolve(dirname(file), specifier);
			const target = [base, base.replace(/\.js$/, ".ts")].find((candidate) => {
				try { return statSync(candidate).isFile(); } catch { return false; }
			});
			if (!target) { problems.push(`${relative(staging, file)} -> ${specifier} (unresolved)`); continue; }
			const rel = relative(staging, target);
			if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) problems.push(`${relative(staging, file)} -> ${specifier} (escapes package)`);
		}
	}
	return problems;
}

const dirs: string[] = [];
const temp = (): string => { const dir = mkdtempSync(join(tmpdir(), "pack-pkg-")); dirs.push(dir); return dir; };
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

describe("vendor-at-pack packaging", () => {
	it("stages every extension with a scoped name and no escaping imports", () => {
		for (const extension of extensionDirectories()) {
			const staging = buildExtensionPackage(extension, join(temp(), "pkg"));
			const manifest = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
			expect(manifest.name, extension).toMatch(/^@solo-visual\/pi-/);
			expect(manifest.devDependencies, staging).toBeUndefined();
			expect(escapingImports(staging), staging).toEqual([]);
		}
	});

	it("vendors the cross-extension approval helper into Agent Hub", () => {
		const staging = buildExtensionPackage(resolve("extensions/pi-agent-hub"), join(temp(), "pkg"));
		expect(readdirSync(join(staging, "vendor", "lib")).length).toBeGreaterThan(0);
		expect(tsFiles(join(staging, "vendor")).some((file) => file.includes("pi-automations"))).toBe(true);
	});

	it("stages the umbrella with the pi extension glob and no dev dependencies", () => {
		const staging = buildUmbrellaPackage(join(temp(), "umb"));
		const manifest = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
		expect(manifest.name).toBe("@solo-visual/pi-tools-and-skills");
		expect(manifest.pi.extensions).toContain("./extensions/*/index.ts");
		expect(manifest.devDependencies).toBeUndefined();
	});
});
