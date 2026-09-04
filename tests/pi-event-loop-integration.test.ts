/** Production entry-point wiring tests for pi-event-loop operator controls. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import eventLoopExtension from "../extensions/pi-event-loop/index.js";
import { CONFIG_RELATIVE_PATH } from "../extensions/pi-event-loop/config.js";
import { configText } from "./fixtures/pi-event-loop.js";

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
	const context = (cwd: string) => ({
		cwd,
		hasUI: true,
		mode: "tui" as const,
		ui: { notify: vi.fn() },
		sessionManager: { getBranch: () => entries },
		isIdle: () => true,
		hasPendingMessages: () => false,
	});
	return { handlers, entries, sent, pi, context };
}

function configDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-event-loop-integration-"));
	mkdirSync(join(directory, ".pi"));
	writeFileSync(join(directory, CONFIG_RELATIVE_PATH), configText(), "utf8");
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
});
