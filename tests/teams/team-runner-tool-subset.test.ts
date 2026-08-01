/** Tests for per-run tool narrowing beneath the profile ceiling. */
import { describe, expect, it, vi } from "vitest";
import { resolveToolSubset } from "../../extensions/pi-panopticon/teams/runner.js";

describe("resolveToolSubset", () => {
	it("allows a subset narrower than the profile", () => {
		expect(resolveToolSubset(["read", "bash", "write"], ["read"])).toEqual(["read"]);
	});

	it("enforces the profile ceiling and logs rejected tools", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(resolveToolSubset(["read", "bash"], ["read", "write", "edit"])).toEqual(["read"]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("rejected 2 tool(s)"));
		warn.mockRestore();
	});

	it("preserves today's behavior when undefined", () => {
		expect(resolveToolSubset(["read", "bash"], undefined)).toEqual(["read", "bash"]);
		expect(resolveToolSubset(undefined, undefined)).toBeUndefined();
	});
});
