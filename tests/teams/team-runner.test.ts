import { describe, expect, it } from "vitest";
import { extractPiPrintOutput, toolArgs } from "../../extensions/pi-panopticon/teams/runner.js";

describe("extractPiPrintOutput", () => {
	it("keeps plain text-mode output", () => {
		expect(extractPiPrintOutput("final answer\n")).toBe("final answer");
	});

	it("returns the final assistant message from JSON event output", () => {
		const stdout = [
			JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "intermediate" } }),
			JSON.stringify({ type: "tool_execution_start", toolName: "read" }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "first tool-call chunk" }] } }),
			JSON.stringify({ type: "tool_execution_end", toolName: "read", result: {} }),
			JSON.stringify({ type: "agent_end", messages: [
				{ role: "user", content: "review" },
				{ role: "assistant", content: [{ type: "text", text: "final synthesized answer" }] },
			] }),
		].join("\n");

		expect(extractPiPrintOutput(stdout)).toBe("final synthesized answer");
	});
});

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
