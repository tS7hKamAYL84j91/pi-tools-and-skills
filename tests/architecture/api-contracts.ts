/** API and dependency-boundary architecture fitness functions. */

import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";
import { extensionNames, listTsFiles, localImportSpecifiers } from "./helpers.js";

describe("dependency direction", () => {
	it("lib/ must not import from extensions/", async () => {
		const rule = projectFiles().inFolder("lib/**").shouldNot().dependOnFiles().inFolder("extensions/**");
		await expect(rule).toPassAsync();
	});

	it("lib/ must not import from tests/", async () => {
		const rule = projectFiles().inFolder("lib/**").shouldNot().dependOnFiles().inFolder("tests/**");
		await expect(rule).toPassAsync();
	});
});

describe("types.ts leaf isolation", () => {
	it("types.ts must not import from sibling extension modules", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			if (!file.endsWith(`${sep}types.ts`)) continue;
			const content = readFileSync(file, "utf8");
			const localSpecifiers = localImportSpecifiers(content).filter((specifier) => specifier.startsWith("./"));
			for (const specifier of localSpecifiers) {
				violations.push(`${relative(process.cwd(), file)} -> ${specifier}`);
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("extension isolation", () => {
	it("extensions must not import from other extensions", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const relativeFile = relative(process.cwd(), file);
			const [, sourceExtension] = relativeFile.split(sep);
			if (!sourceExtension) continue;

			const content = readFileSync(file, "utf8");
			for (const specifier of localImportSpecifiers(content)) {
				const target = normalize(join(dirname(file), specifier));
				const relativeTarget = relative(process.cwd(), target);
				const [root, targetExtension] = relativeTarget.split(sep);
				if (root === "extensions" && targetExtension !== sourceExtension) {
					violations.push(`${relativeFile} -> ${specifier}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("circular dependencies", () => {
	it("each extension should be cycle-free", async () => {
		for (const extensionName of extensionNames()) {
			const rule = projectFiles().inFolder(`extensions/${extensionName}/**`).should().haveNoCycles();
			await expect(rule).toPassAsync();
		}
	});

	it("lib modules should be cycle-free", async () => {
		const rule = projectFiles().inFolder("lib/**").should().haveNoCycles();
		await expect(rule).toPassAsync();
	});
});

describe("module structure", () => {
	it("index.ts should have exactly one default export", async () => {
		const rule = projectFiles()
			.withName("index.ts")
			.inFolder("extensions/**")
			.should()
			.adhereTo((file) => {
				const defaults = file.content.match(/export default/g);
				return defaults !== null && defaults.length === 1;
			}, "Extension index.ts must have exactly one default export (the entry point)");
		await expect(rule).toPassAsync();
	});
});
