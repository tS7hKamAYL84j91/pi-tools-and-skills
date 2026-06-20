/** Tests for Matrix bridge helpers. */

import { describe, expect, it } from "vitest";

import { mxidLocalpart } from "../bridge.js";

describe("mxidLocalpart", () => {
	it("extracts the Matrix localpart", () => {
		expect(mxidLocalpart("@jim.smith:matrix.example.net")).toBe("jim.smith");
	});

	it("falls back for missing or empty sender values", () => {
		expect(mxidLocalpart(undefined)).toBe("unknown");
		expect(mxidLocalpart("")).toBe("unknown");
		expect(mxidLocalpart("@:matrix.example.net")).toBe("unknown");
	});
});
