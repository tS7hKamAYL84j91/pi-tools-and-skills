/**
 * Characterisation tests for pi-subagent pure helpers.
 *
 * These lock in observable behaviour before the refactor.
 * Only the extracted helpers and lightweight registration wiring are tested here;
 * the tool execute paths rely on integration with the ExtensionAPI.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { setupSpawner } from "../extensions/pi-panopticon/spawner.js";
import { formatEvent, recentOutputFromEvents } from "../lib/spawn-events.js";
import { buildArgList } from "../lib/spawn-service.js";

interface RegisteredTool {
	name: string;
	prepareArguments?: (args: unknown) => unknown;
}

function getSpawnAgentPrepareArguments(): (args: unknown) => unknown {
	const tools = new Map<string, RegisteredTool>();
	// setupSpawner only calls registerTool while wiring tools in this test.
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	const registry = {
		selfId: "test-self",
		getRecord() {
			return undefined;
		},
		register() {},
		unregister() {},
		setStatus() {},
		updateModel() {},
		setTask() {},
		setName() {},
		updatePendingMessages() {},
		readAllPeers() {
			return [];
		},
		flush() {},
	} satisfies Parameters<typeof setupSpawner>[1];
	setupSpawner(api, registry);
	const tool = tools.get("spawn_agent");
	if (!tool?.prepareArguments) {
		throw new Error("spawn_agent prepareArguments was not registered");
	}
	return tool.prepareArguments;
}

// ── formatEvent ────────────────────────────────────────────────

describe("formatEvent", () => {
	it("formats message_update text_delta", () => {
		const line = JSON.stringify({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "hello " },
		});
		expect(formatEvent(line)).toBe("hello ");
	});

	it("returns empty string for message_update non-delta", () => {
		const line = JSON.stringify({
			type: "message_update",
			assistantMessageEvent: { type: "something_else" },
		});
		expect(formatEvent(line)).toBe("");
	});

	it("formats tool_execution_start", () => {
		const line = JSON.stringify({
			type: "tool_execution_start",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(formatEvent(line)).toContain("⚙ bash");
		expect(formatEvent(line)).toContain("ls");
	});

	it("formats tool_execution_end with text", () => {
		const line = JSON.stringify({
			type: "tool_execution_end",
			result: { content: [{ text: "file.ts" }] },
		});
		expect(formatEvent(line)).toBe("  → file.ts");
	});

	it("formats tool_execution_end with no result text", () => {
		const line = JSON.stringify({ type: "tool_execution_end" });
		expect(formatEvent(line)).toBe("  → (done)");
	});

	it("formats agent_start", () => {
		const line = JSON.stringify({ type: "agent_start" });
		expect(formatEvent(line)).toBe("\n▶ agent started");
	});

	it("formats agent_end", () => {
		const line = JSON.stringify({ type: "agent_end" });
		expect(formatEvent(line)).toBe("\n■ agent finished");
	});

	it("formats successful response", () => {
		const line = JSON.stringify({
			type: "response",
			command: "prompt",
			success: true,
		});
		expect(formatEvent(line)).toBe("  [prompt: ok]");
	});

	it("formats failed response", () => {
		const line = JSON.stringify({
			type: "response",
			command: "abort",
			success: false,
			error: "oops",
		});
		expect(formatEvent(line)).toBe("  [abort: oops]");
	});

	it("formats unknown event types", () => {
		const line = JSON.stringify({ type: "some_unknown_type" });
		expect(formatEvent(line)).toBe("  [some_unknown_type]");
	});

	it("handles non-JSON lines by truncating", () => {
		const raw = "raw log line";
		expect(formatEvent(raw)).toBe("raw log line");
	});

	it("truncates non-JSON lines at 120 chars", () => {
		const long = "x".repeat(200);
		expect(formatEvent(long)).toBe("x".repeat(120));
	});
});

// ── recentOutputFromEvents ─────────────────────────────────────

describe("recentOutputFromEvents", () => {
	it("returns placeholder for empty events", () => {
		expect(recentOutputFromEvents([])).toBe("(no events yet)");
	});

	it("joins formatted events, filtering empty strings", () => {
		const events = [
			JSON.stringify({ type: "agent_start" }),
			JSON.stringify({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "hi" },
			}),
			JSON.stringify({ type: "agent_end" }),
		];
		const out = recentOutputFromEvents(events);
		expect(out).toContain("▶ agent started");
		expect(out).toContain("hi");
		expect(out).toContain("■ agent finished");
	});

	it("respects the lines limit (takes last N)", () => {
		const events = Array.from({ length: 30 }, () =>
			JSON.stringify({ type: "agent_start" }),
		);
		// With lines=5, only 5 events processed
		const out = recentOutputFromEvents(events, 5);
		// Should have exactly 5 agent_start markers
		const count = (out.match(/▶ agent started/g) ?? []).length;
		expect(count).toBe(5);
	});
});

// ── spawn_agent registration ──────────────────────────────────

describe("spawn_agent registration", () => {
	it("normalizes null tools to an empty array before schema validation", () => {
		const prepareArguments = getSpawnAgentPrepareArguments();
		expect(prepareArguments({ name: "navigator", tools: null })).toEqual({
			name: "navigator",
			tools: [],
		});
	});

	it("leaves explicit tool restrictions unchanged", () => {
		const prepareArguments = getSpawnAgentPrepareArguments();
		expect(prepareArguments({ name: "navigator", tools: ["read"] })).toEqual({
			name: "navigator",
			tools: ["read"],
		});
	});
});

// ── buildArgList ───────────────────────────────────────────────

describe("buildArgList", () => {
	it("always includes --mode rpc", () => {
		const args = buildArgList({ name: "test-agent" });
		expect(args).toContain("--mode");
		expect(args).toContain("rpc");
	});

	it("includes model flag when provided", () => {
		const args = buildArgList({
			name: "test-agent",
			model: "anthropic/claude-sonnet",
		});
		expect(args).toContain("--models");
		expect(args).toContain("anthropic/claude-sonnet");
	});

	it("includes tools flag when provided", () => {
		const args = buildArgList({ name: "test-agent", tools: ["read", "bash"] });
		expect(args).toContain("--tools");
		expect(args).toContain("read,bash");
	});

	it("omits tools flag for an empty tool restriction array", () => {
		const args = buildArgList({ name: "test-agent", tools: [] });
		expect(args).not.toContain("--tools");
	});

	it("omits tools flag when tools is null", () => {
		const args = buildArgList({ name: "test-agent", tools: null });
		expect(args).not.toContain("--tools");
	});

	it("uses --session-dir when provided", () => {
		const args = buildArgList({
			name: "test-agent",
			sessionDir: "/tmp/my-session",
		});
		expect(args).toContain("--session-dir");
		expect(args).toContain("/tmp/my-session");
	});

	it("uses default session dir when no sessionDir provided", () => {
		const args = buildArgList({ name: "my-agent" });
		expect(args).toContain("--session-dir");
		expect(
			args.some((a) => a.includes("subagents") && a.includes("my-agent")),
		).toBe(true);
		expect(args).not.toContain("--no-session");
	});

	it("combines multiple flags correctly", () => {
		const args = buildArgList({
			name: "test-agent",
			model: "mymodel",
			tools: ["read"],
			sessionDir: "/tmp/s",
		});
		expect(args).toContain("--mode");
		expect(args).toContain("rpc");
		expect(args).toContain("--models");
		expect(args).toContain("mymodel");
		expect(args).toContain("--tools");
		expect(args).toContain("read");
		expect(args).toContain("--session-dir");
		expect(args).toContain("/tmp/s");
	});
});
