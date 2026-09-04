/** Production entry-point wiring tests for pi-event-loop operator controls. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import eventLoopExtension from "../extensions/pi-event-loop/index.js";
import { CONFIG_RELATIVE_PATH } from "../extensions/pi-event-loop/config.js";
import {
	configText,
	eventEntry,
	itemIdOf,
	workRequested,
} from "./fixtures/pi-event-loop.js";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

const directories: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

interface HarnessTool {
	readonly name: string;
	readonly parameters: { readonly properties: Record<string, unknown> };
	readonly description: string;
	readonly execute?: (
		callId: string,
		params: unknown,
		signal?: unknown,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<unknown>;
}

function createProductionHarness() {
	const handlers = new Map<string, Handler>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const sent: unknown[] = [];
	const sentDeliveries: Array<{ message: unknown; options?: unknown }> = [];
	const toolsByName = new Map<string, HarnessTool>();
	const messageRenderers = new Map<string, unknown>();
	const statuses = new Map<string, string | undefined>();
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerTool: vi.fn((tool: HarnessTool) => {
			toolsByName.set(tool.name, tool);
		}),
		registerCommand: (_name: string, definition: { handler: Handler }) =>
			handlers.set("command", definition.handler),
		registerMessageRenderer: vi.fn((customType: string, renderer: unknown) => {
			messageRenderers.set(customType, renderer);
		}),
		appendEntry: (customType: string, data?: unknown) =>
			entries.push({ type: "custom", customType, data }),
		sendMessage: (message: unknown, options?: unknown) => {
			sent.push(message);
			sentDeliveries.push({ message, options });
		},
	};
	const context = (cwd: string, options: { configDir?: string; trusted?: boolean } = {}) => ({
		cwd,
		hasUI: true,
		mode: "tui" as const,
		ui: {
			notify: vi.fn(),
			setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			custom: undefined,
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: { getBranch: () => entries },
		configDir: options.configDir,
		isProjectTrusted: () => options.trusted !== false,
		isIdle: () => true,
		hasPendingMessages: () => false,
	});
	return { handlers, entries, sent, sentDeliveries, toolsByName, messageRenderers, statuses, pi, context };
}

function configDirectory(configPath = CONFIG_RELATIVE_PATH, text = configText()): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-event-loop-integration-"));
	mkdirSync(join(directory, join(configPath, "..")), { recursive: true });
	writeFileSync(join(directory, configPath), text, "utf8");
	directories.push(directory);
	return directory;
}

describe("pi-event-loop production wiring", () => {
	it("resume restarts the lifecycle-owned pump after an issued diagnostic", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
		await harness.handlers.get("command")?.("issue perform-work {\"workItemId\":\"w-1\"}", ctx);
		await harness.handlers.get("command")?.("resume", ctx);
		await vi.runOnlyPendingTimersAsync();
		expect(harness.sent).toHaveLength(1);
	});

	it("production transitions publish status and expose inspect fallback", async () => {
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
		expect(harness.statuses.has("pi-event-loop")).toBe(true);
		await harness.handlers.get("command")?.("inspect", ctx);
		expect((ctx.ui.notify as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	it("retry restarts the production pump after an agent outcome is missing", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		harness.entries.push(eventEntry(workRequested("w-2")));
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		harness.sent.length = 0;
		await harness.handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
		await harness.handlers.get("command")?.(`retry ${itemIdOf(workRequested("w-2"), "w-2")}`, ctx);
		await vi.runOnlyPendingTimersAsync();
		expect(harness.sent).toHaveLength(1);
	});

	it("reload rebuilds projection and reconciles queued work", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
		harness.sent.length = 0;
		harness.entries.push(eventEntry(workRequested("w-reload")));
		await harness.handlers.get("command")?.("reload", ctx);
		await vi.runOnlyPendingTimersAsync();
		expect(harness.sent).toHaveLength(1);
	});

	it("profile switch rebuilds live state and uses the selected profile", async () => {
		vi.useFakeTimers();
		const alternate = JSON.parse(configText()) as Record<string, unknown>;
		const profiles = alternate.profiles as Record<string, Record<string, unknown>>;
		profiles.alternate = {
			...profiles.default,
			commands: {
				"perform-work": { message: "Alternate profile work.", expectedEvents: ["work.completed", "work.failed"] },
			},
		};
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory(CONFIG_RELATIVE_PATH, JSON.stringify({ ...alternate, activeProfile: "alternate" }));
		const ctx = harness.context(cwd);
		harness.entries.push(eventEntry(workRequested("w-profile")));
		await harness.handlers.get("session_start")?.({}, ctx);
		expect(harness.sent[0]).toMatchObject({ content: expect.stringContaining("Alternate profile work.") });
	});

	it("keeps the runtime inert when the project is untrusted", async () => {
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		await harness.handlers
			.get("session_start")
			?.({}, harness.context(cwd, { trusted: false }));
		expect(harness.sent).toHaveLength(0);
	});

	it("active command start and agent_settled re-register event_loop_emit with narrowed and widened schema", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const base = JSON.parse(configText()) as Record<string, unknown>;
		const profiles = base.profiles as Record<string, Record<string, unknown>>;
		const defaultProfile = profiles.default as Record<string, unknown>;
		const events = defaultProfile.events as Record<string, unknown>;
		events["progress.note"] = {
			description: "A free observation.",
			allowAgentEmit: true,
			requiredPayload: [],
			allowWithoutCommand: true,
		};
		const cwd = configDirectory(CONFIG_RELATIVE_PATH, JSON.stringify(base));
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);

		const initialTool = harness.toolsByName.get("event_loop_emit");
		expect(initialTool).toBeDefined();
		expect(initialTool?.parameters.properties.event).toMatchObject({
			const: "progress.note",
		});

		harness.entries.push(eventEntry(workRequested("w-narrow")));
		await harness.handlers.get("command")?.("reload", ctx);
		await vi.runOnlyPendingTimersAsync();

		const activeTool = harness.toolsByName.get("event_loop_emit");
		expect(activeTool?.parameters.properties.event).toMatchObject({
			anyOf: [{ const: "work.completed" }, { const: "work.failed" }],
		});
		expect(activeTool?.description).toContain("Active command: \"perform-work\"");

		const emitTool = harness.toolsByName.get("event_loop_emit");
		expect(emitTool?.execute).toBeDefined();
		await emitTool?.execute?.(
			"call-narrow-complete",
			{
				event: "work.completed",
				dedupeKey: "narrow-complete-key",
				payload: { workId: "w-narrow", resultPath: "/out/1" },
			},
			undefined,
			undefined,
			ctx,
		);
		await harness.handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

		const settledTool = harness.toolsByName.get("event_loop_emit");
		expect(settledTool?.parameters.properties.event).toMatchObject({
			const: "progress.note",
		});
		expect(settledTool?.description).not.toContain("Active command");
	});

	it("host semantics: command delivery triggers turn, command remains active until agent_settled, then next command delivers without polling", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		const ctx = harness.context(cwd);

		harness.entries.push(eventEntry(workRequested("w-host-1")));
		harness.entries.push(eventEntry(workRequested("w-host-2")));

		await harness.handlers.get("session_start")?.({}, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(harness.sentDeliveries).toHaveLength(1);
		expect(harness.sentDeliveries[0]?.options).toMatchObject({ triggerTurn: true });

		await vi.advanceTimersByTimeAsync(60_000);
		expect(harness.sentDeliveries).toHaveLength(1);

		const emitTool = harness.toolsByName.get("event_loop_emit");
		expect(emitTool?.execute).toBeDefined();
		await emitTool?.execute?.(
			"call-host-1-done",
			{
				event: "work.completed",
				dedupeKey: "host-1-done-key",
				payload: { workId: "w-host-1", resultPath: "/tmp/host-1" },
			},
			undefined,
			undefined,
			ctx,
		);
		await harness.handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(harness.sentDeliveries).toHaveLength(2);
		expect(harness.sentDeliveries[1]?.options).toMatchObject({ triggerTurn: true });
		expect((harness.sentDeliveries[1]?.message as { details: { correlationId: string } }).details.correlationId).toBe("w-host-2");
	});
});
