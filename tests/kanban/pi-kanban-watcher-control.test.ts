import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

describe("Kanban watcher control", () => {
	const harness = setupKanbanToolHarness();
	let previousSetting: string | undefined;

	beforeEach(() => {
		previousSetting = process.env.KANBAN_WATCHER_AUTO_FOLLOW_UP;
		delete process.env.KANBAN_WATCHER_AUTO_FOLLOW_UP;
	});

	afterEach(() => {
		if (previousSetting === undefined) {
			delete process.env.KANBAN_WATCHER_AUTO_FOLLOW_UP;
		} else {
			process.env.KANBAN_WATCHER_AUTO_FOLLOW_UP = previousSetting;
		}
	});

	it("defaults follow-up injection to off while retaining widget updates", async () => {
		const result = await callTool(harness.tools, "kanban_watch", {
			action: "status",
		});

		expect(result.details).toMatchObject({
			enabled: false,
			widgetUpdates: true,
		});
	});

	it("allows an agent to toggle and inspect follow-up injection", async () => {
		const enabled = await callTool(harness.tools, "kanban_watch", {
			action: "on",
		});
		const status = await callTool(harness.tools, "kanban_watch", {
			action: "status",
		});

		expect(enabled.details).toMatchObject({ enabled: true });
		expect(status.details).toMatchObject({
			enabled: true,
			widgetUpdates: true,
		});
	});
});
