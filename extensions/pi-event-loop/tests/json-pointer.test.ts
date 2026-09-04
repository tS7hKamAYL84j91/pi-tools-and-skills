/** Security regression tests for read-only JSON Pointer traversal. */

import { describe, expect, it } from "vitest";
import { projectionKey } from "../json-pointer.js";

describe("projectionKey own-data traversal", () => {
	it("rejects inherited properties and prototype-related tokens", () => {
		const inherited = Object.create({ inherited: "secret" }) as Record<
			string,
			unknown
		>;
		inherited.own = "visible";
		expect(projectionKey(inherited, "/own")).toBe("visible");
		expect(projectionKey(inherited, "/inherited")).toBeUndefined();
		expect(projectionKey(inherited, "/__proto__")).toBeUndefined();
		expect(projectionKey(inherited, "/constructor")).toBeUndefined();
		expect(projectionKey(inherited, "/prototype")).toBeUndefined();
	});

	it("rejects accessor properties without invoking their getter", () => {
		let getterCalls = 0;
		const payload: Record<string, unknown> = {};
		Object.defineProperty(payload, "computed", {
			enumerable: true,
			get: () => {
				getterCalls++;
				return "unsafe";
			},
		});
		expect(projectionKey(payload, "/computed")).toBeUndefined();
		expect(getterCalls).toBe(0);
	});
});
