import { describe, expect, it } from "vitest";
import { fail, ok } from "../../lib/tool-result.js";

describe("tool-result", () => {
	describe("ok", () => {
		it("returns a successful ToolResult", () => {
			const res = ok("Success!");
			expect(res).toEqual({
				content: [{ type: "text", text: "Success!" }],
				details: {},
			});
		});

		it("returns a successful ToolResult with details", () => {
			const res = ok("Success!", { foo: "bar" });
			expect(res.details).toEqual({ foo: "bar" });
		});
	});

	describe("fail", () => {
		it("returns an error ToolResult", () => {
			const res = fail("Error!");
			expect(res).toEqual({
				content: [{ type: "text", text: "Error!" }],
				details: {},
				isError: true,
			});
		});

		it("supports structured failure metadata", () => {
			const res = fail("Rate limited", {
				code: "timeout",
				retryable: true,
				action: "Wait 5 minutes",
				schemaVersion: 1,
				truncated: false,
				correlationId: "req-123",
			});
			
			expect(res.details).toEqual({
				code: "timeout",
				retryable: true,
				action: "Wait 5 minutes",
				schemaVersion: 1,
				truncated: false,
				correlationId: "req-123",
			});
			expect(res.isError).toBe(true);
		});

		it("maintains backward compatibility with arbitrary details", () => {
			const res = fail("Validation failed", {
				code: "validation",
				customField: 42,
				nested: { a: 1 }
			});
			
			expect(res.details.customField).toBe(42);
			expect(res.details.nested).toEqual({ a: 1 });
			expect(res.details.code).toBe("validation");
		});
	});
});
