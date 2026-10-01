/** Maintenance conventions, without size/parameter/cohesion quotas. */
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("documentation", () => {
	it("every extension .ts file should start with a JSDoc comment", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo((file) => file.content.trimStart().startsWith("/**"), "Extension files must start with a /** JSDoc */ module comment");
		await expect(rule).toPassAsync();
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
