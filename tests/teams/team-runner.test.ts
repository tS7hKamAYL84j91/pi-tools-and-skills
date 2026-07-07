import { describe, expect, it } from "vitest";
import { extractPiPrintOutput, mapSpawnResultToModelRun, toolArgs } from "../../extensions/pi-panopticon/teams/runner.js";

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

describe("mapSpawnResultToModelRun", () => {
	const args = { prompt: "p", systemPrompt: "s" };

	it("maps a successful run with text output", () => {
		const result = mapSpawnResultToModelRun(args, {
			stdout: "final answer\n",
			stderr: "",
			durationMs: 10,
			ok: true,
		});
		expect(result).toEqual({
			prompt: "p",
			systemPrompt: "s",
			output: "final answer",
			durationMs: 10,
			ok: true,
		});
		expect(result.error).toBeUndefined();
	});

	it("surfaces a non-zero exit as failure with stderr", () => {
		const result = mapSpawnResultToModelRun(args, {
			stdout: "",
			stderr: "boom",
			durationMs: 10,
			ok: false,
			error: "exit 1",
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBe("boom");
	});

	it("treats ok+empty stdout as a loud failure (lockfile-wrapper silent abort)", () => {
		const stderr =
			"WARNING: An agent is already running for this workspace.\nNon-interactive duplicate launch detected.";
		const result = mapSpawnResultToModelRun(args, {
			stdout: "",
			stderr,
			durationMs: 5,
			ok: true,
		});
		expect(result.ok).toBe(false);
		expect(result.output).toBe("");
		expect(result.error).toContain("produced no output");
		expect(result.error).toContain("Non-interactive duplicate launch detected");
	});

	it("uses a default empty-output message when stderr is also empty", () => {
		const result = mapSpawnResultToModelRun(args, {
			stdout: "   \n  ",
			stderr: "  ",
			durationMs: 5,
			ok: true,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBe("pi --print child exited successfully but produced no output.");
	});

	it("does not false-positive on JSON event output that yields text", () => {
		const stdout = [
			JSON.stringify({ type: "tool_execution_start", toolName: "read" }),
			JSON.stringify({ type: "agent_end", messages: [
				{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			] }),
		].join("\n");
		const result = mapSpawnResultToModelRun(args, {
			stdout,
			stderr: "",
			durationMs: 5,
			ok: true,
		});
		expect(result.ok).toBe(true);
		expect(result.output).toBe("answer");
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
