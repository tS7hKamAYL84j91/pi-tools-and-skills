/** Clean-code architecture fitness functions. */

import { projectFiles, metrics } from "archunit";
import { describe, expect, it } from "vitest";

function countFuncParams(content: string, maxParams: number): boolean {
	const funcPattern = /function\s+\w+\s*\(([^)]*?)\)/g;
	for (const match of content.matchAll(funcPattern)) {
		const params = match[1]?.replace(/,\s*$/, "").trim();
		if (!params) continue;
		let depth = 0;
		let count = 1;
		for (const ch of params) {
			if (ch === "<" || ch === "(") depth++;
			else if (ch === ">" || ch === ")") depth--;
			else if (ch === "," && depth === 0) count++;
		}
		if (count > maxParams) return false;
	}
	return true;
}

function allowsParameterException(path: string): boolean {
	// applyEvent() consumes one parsed log event: task, event, agent, timestamp,
	// and key/value payload. This is legacy event-sourcing core, not new API shape.
	return path.endsWith("extensions/pi-kanban/board.ts");
}

describe("file size", () => {
	it("no extension file should exceed 600 lines", async () => {
		const rule = projectFiles().inFolder("extensions/**").should().adhereTo((file) => {
			const lines = file.content.split("\n").length;
			return lines <= 600;
		}, "Extension files should not exceed 600 lines");
		await expect(rule).toPassAsync();
	});

	it("no lib file should exceed 200 lines", async () => {
		const rule = projectFiles().inFolder("lib/**").should().adhereTo((file) => {
			const lines = file.content.split("\n").length;
			return lines <= 200;
		}, "Lib files should not exceed 200 lines");
		await expect(rule).toPassAsync();
	});
});

describe("documentation", () => {
	it("every extension .ts file should start with a JSDoc comment", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo((file) => file.content.trimStart().startsWith("/**"), "Extension files must start with a /** JSDoc */ module comment");
		await expect(rule).toPassAsync();
	});
});

describe("function parameters", () => {
	it("extension functions should have at most 4 parameters", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo((file) => allowsParameterException(file.path) || countFuncParams(file.content, 4), "Functions should have at most 4 parameters (Clean Code: 3 ideal, 4 max)");
		await expect(rule).toPassAsync();
	});

	it("lib functions should have at most 4 parameters", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.should()
			.adhereTo((file) => countFuncParams(file.content, 4), "Functions should have at most 4 parameters (Clean Code: 3 ideal, 4 max)");
		await expect(rule).toPassAsync();
	});
});

describe("class cohesion", () => {
	it("classes should have high cohesion (LCOM96b < 0.8)", async () => {
		const rule = metrics().inFolder("extensions/**").lcom().lcom96b().shouldBeBelow(0.8);
		await expect(rule).toPassAsync({ allowEmptyTests: true });
	});
});

describe("error handling", () => {
	it("catch blocks must contain at least a comment", async () => {
		const rule = projectFiles().inFolder("extensions/**").should().adhereTo((file) => {
			const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
			return !emptyCatch.test(file.content);
		}, "Empty catch blocks must have a comment explaining why the error is ignored");
		await expect(rule).toPassAsync();
	});
});
