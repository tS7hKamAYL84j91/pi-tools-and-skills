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

function createProductionHarness() {
	const handlers = new Map<string, Handler>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const sent: unknown[] = [];
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerTool: vi.fn(),
		registerCommand: (_name: string, definition: { handler: Handler }) =>
			handlers.set("command", definition.handler),
		appendEntry: (customType: string, data?: unknown) =>
			entries.push({ type: "custom", customType, data }),
		sendMessage: (message: unknown) => sent.push(message),
	};
	const context = (cwd: string, options: { configDir?: string; trusted?: boolean } = {}) => ({
		cwd,
		hasUI: true,
		mode: "tui" as const,
		ui: { notify: vi.fn() },
		sessionManager: { getBranch: () => entries },
		configDir: options.configDir,
		isProjectTrusted: () => options.trusted !== false,
		isIdle: () => true,
		hasPendingMessages: () => false,
	});
	return { handlers, entries, sent, pi, context };
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

	it("retry restarts the production pump after an agent outcome is missing", async () => {
		vi.useFakeTimers();
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory();
		harness.entries.push(eventEntry(workRequested("w-2")));
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
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
		const profiles = alternate["profiles"] as Record<string, Record<string, unknown>>;
		profiles["alternate"] = {
			...profiles["default"],
			commands: {
				"perform-work": { message: "Alternate profile work.", expectedEvents: ["work.completed", "work.failed"] },
			},
		};
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory(CONFIG_RELATIVE_PATH, JSON.stringify({ ...alternate, activeProfile: "alternate" }));
		const ctx = harness.context(cwd);
		await harness.handlers.get("session_start")?.({}, ctx);
		expect(harness.sent[0]).toMatchObject({ details: { message: "Alternate profile work." } });
	});

	it("uses the configured config directory and trust boundary consistently", async () => {
		vi.useFakeTimers();
		const customPath = "settings/event-loop.json";
		const harness = createProductionHarness();
		eventLoopExtension(harness.pi as never);
		const cwd = configDirectory(customPath);
		const ctx = harness.context(cwd, { configDir: "settings" });
		await harness.handlers.get("session_start")?.({}, ctx);
		expect(harness.sent).toHaveLength(0);
		const untrusted = createProductionHarness();
		eventLoopExtension(untrusted.pi as never);
		await untrusted.handlers.get("session_start")?.({}, untrusted.context(cwd, { configDir: "settings", trusted: false }));
		expect(untrusted.sent).toHaveLength(0);
	});
});
