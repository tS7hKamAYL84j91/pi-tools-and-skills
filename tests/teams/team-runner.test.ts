import { describe, expect, it } from "vitest";
import { toolArgs } from "../../extensions/pi-panopticon/teams/runner.js";

describe("toolArgs", () => {
	it("omits tool flags when tools are unspecified", () => {
		expect(toolArgs(undefined)).toEqual([]);
	});

	it("disables tools when tools are explicitly empty", () => {
		expect(toolArgs([])).toEqual(["--no-tools"]);
	});

	it("allowlists non-empty tools", () => {
		expect(toolArgs(["read", "bash"])).toEqual(["--tools", "read,bash"]);
	});
});
