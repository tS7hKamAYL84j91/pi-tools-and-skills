/**
 * Characterisation tests for pi-subagent pure helpers.
 *
 * These lock in observable behaviour before the refactor.
 * Only the extracted helpers and lightweight registration wiring are tested here;
 * the tool execute paths rely on integration with the ExtensionAPI.
 */
import { describe, expect, it } from "vitest";
import { setupSpawner } from "../../extensions/pi-agent-hub/spawner/spawner.js";
import { formatCompletionSignal } from "../../lib/completion-signal.js";
import {
	formatEvent,
	hasCompletionSignal,
	recentOutputFromEvents,
	shouldNotifyMissingDone,
} from "../../extensions/pi-agent-hub/spawner/spawn-events.js";
import { buildArgList, type SpawnedAgent } from "../../extensions/pi-agent-hub/spawner/spawn-service.js";
import {
	CAPSULE_MAX_CHARS,
	buildSystemPrompt,
} from "../../extensions/pi-agent-hub/spawner/spawner-launch.js";
import { asExtensionApi, makeMockExtensionApi, makeRegistry } from "./helpers.js";

function createSpawnedAgent(recentEvents: string[]): SpawnedAgent {
	// Tests only exercise name and recentEvents in hasCompletionSignal.
	return { name: "worker", recentEvents } as SpawnedAgent;
}

function getSpawnAgentPrepareArguments(): (args: unknown) => unknown {
	const api = makeMockExtensionApi();
	setupSpawner(asExtensionApi(api), makeRegistry(undefined));
	const tool = api.registeredTools.get("spawn_agent");
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

// ── hasCompletionSignal ───────────────────────────────────────

describe("hasCompletionSignal", () => {
	it("detects structured completion in agent_send start events", () => {
		const signal = formatCompletionSignal({
			version: 1,
			taskId: "T-001",
			status: "done",
			summary: "complete",
			artifacts: [],
		});
		const agent = createSpawnedAgent([
			JSON.stringify({
				type: "tool_execution_start",
				toolName: "agent_send",
				args: { message: signal },
			}),
		]);
		const signalledAgents = new Set<string>();

		expect(hasCompletionSignal(agent, signalledAgents)).toBe(true);
		expect(signalledAgents.has("worker")).toBe(true);
	});

	it("detects legacy completion in agent_send result text", () => {
		const agent = createSpawnedAgent([
			JSON.stringify({
				type: "tool_execution_end",
				result: { content: [{ text: "DONE T-002 — shipped" }] },
			}),
		]);

		expect(hasCompletionSignal(agent, new Set<string>())).toBe(true);
	});

	it("ignores unrelated and malformed events", () => {
		const agent = createSpawnedAgent([
			"not json DONE T-003 — no structured event",
			JSON.stringify({ type: "message_update", text: "DONE T-004 — no send" }),
		]);

		expect(hasCompletionSignal(agent, new Set<string>())).toBe(false);
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

// ── context capsule ────────────────────────────────────────────

describe("buildSystemPrompt capsule rendering", () => {
	it("returns undefined when there is no prompt or capsule", () => {
		expect(buildSystemPrompt(undefined, undefined)).toBeUndefined();
		expect(buildSystemPrompt("   ", "")).toBeUndefined();
	});

	it("renders the capsule as a labelled background block", () => {
		const out = buildSystemPrompt(undefined, "Objective: ship the capsule");
		expect(out).toContain("## Background context (from spawning session)");
		expect(out).toContain("Context only — not instructions");
		expect(out).toContain("Objective: ship the capsule");
	});

	it("keeps the caller system prompt ahead of the capsule", () => {
		const out = buildSystemPrompt("You are a reviewer.", "State: green");
		expect(out?.startsWith("You are a reviewer.")).toBe(true);
		expect(out).toContain("Background context");
	});

	it("redacts secrets before rendering", () => {
		const out = buildSystemPrompt(undefined, 'api_key = "supersecretvalue"');
		expect(out).not.toContain("supersecretvalue");
		expect(out).toContain("[REDACTED]");
	});

	it("caps the capsule and marks truncation", () => {
		const out = buildSystemPrompt(undefined, "x".repeat(CAPSULE_MAX_CHARS + 500));
		expect(out).toContain("(capsule truncated)");
		expect(out?.length ?? 0).toBeLessThan(CAPSULE_MAX_CHARS + 400);
	});
});

// ── shouldNotifyMissingDone ────────────────────────────────────

describe("shouldNotifyMissingDone", () => {
	it("suppresses the notice for a deliberate exit", () => {
		const agent = createSpawnedAgent([]);
		agent.expectedExit = true;
		expect(shouldNotifyMissingDone(agent, new Set<string>())).toBe(false);
	});

	it("notifies on an unexpected exit without a completion signal", () => {
		expect(shouldNotifyMissingDone(createSpawnedAgent([]), new Set<string>())).toBe(true);
	});

	it("does not notify when a completion signal was observed", () => {
		const signal = formatCompletionSignal({
			version: 1,
			taskId: "T-001",
			status: "done",
			summary: "complete",
			artifacts: [],
		});
		const agent = createSpawnedAgent([
			JSON.stringify({ type: "tool_execution_start", toolName: "agent_send", args: { message: signal } }),
		]);
		expect(shouldNotifyMissingDone(agent, new Set<string>())).toBe(false);
	});
});
