/** Public entrypoint placement is a boundary; file size is not. */
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

describe("public entrypoint boundaries", () => {
	it("panopticon root exposes only its entrypoint and public types", () => {
		const allowed = new Set([
			"extensions/pi-agent-hub/index.ts",
			"extensions/pi-agent-hub/types.ts",
		]);
		const rootFiles = listTsFiles("extensions/pi-agent-hub")
			.map((path) => relative(process.cwd(), path))
			.filter((path) => path.split("/").length === 3);
		expect(rootFiles.filter((path) => !allowed.has(path))).toEqual([]);
	});
});
