import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { inferWorkspaceIdentity } from "../../extensions/pi-panopticon/registry/state.js";
import { assertProperty } from "../lib/fast-check.js";

describe("bounded Panopticon identity properties", () => {
	it("maps supported input channels deterministically", () => {
		assertProperty(fc.property(fc.array(fc.constantFrom("a", "B", "0", "-", "_"), { minLength: 1, maxLength: 24 }).map((parts) => parts.join("")), (identity) => {
			expect(inferWorkspaceIdentity({ source: "interactive" })).toEqual({
				workspaceId: "local:interactive", sourceChannel: "local", humanIdentity: "interactive",
			});
			expect(inferWorkspaceIdentity({ source: "rpc" })).toEqual({
				workspaceId: "local:rpc", sourceChannel: "local", humanIdentity: "rpc",
			});
			const result = inferWorkspaceIdentity({ source: "extension", text: `<agent-message from="${identity}">` });
			expect(result?.humanIdentity).toBe(identity);
			expect(result?.workspaceId).toBe(`agent:${identity}`);
		}));
	});
});
