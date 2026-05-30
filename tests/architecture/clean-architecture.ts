/** Clean Architecture fitness functions for core-vs-extension boundaries. */

import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("Clean Architecture Fitness Functions", () => {
	it("Core domain (lib/) must not depend on outer layers (extensions/)", async () => {
		const rule = projectFiles().inFolder("lib/**").shouldNot().dependOnFiles().inFolder("extensions/**");
		await expect(rule).toPassAsync();
	});

	it("Core domain (lib/) must not import from external framework packages", async () => {
		const rule = projectFiles().inFolder("lib/**").should().adhereTo((file) => {
			const forbiddenFrameworks = ["express", "react", "mongoose", "typeorm"];
			const frameworkPattern = new RegExp(`from\\s+["'](${forbiddenFrameworks.join("|")})["']`, "g");
			return !frameworkPattern.test(file.content);
		}, "Core domain must not know about external frameworks like express, react, or DB ORMs");
		await expect(rule).toPassAsync();
	});

	it("Core domain (lib/) must not know about framework-specific HTTP or DB structures", async () => {
		const rule = projectFiles().inFolder("lib/**").should().adhereTo((file) => {
			const forbiddenObjects = ["HttpRequest", "HttpResponse", "QueryBuilder", "ConnectionPool"];
			return !forbiddenObjects.some((obj) => file.content.includes(obj));
		}, "Core domain must communicate via simple DTOs, not framework-specific objects");
		await expect(rule).toPassAsync();
	});
});
