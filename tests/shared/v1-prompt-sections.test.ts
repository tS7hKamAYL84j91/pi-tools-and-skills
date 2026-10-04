import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../extensions/pi-matrix/config.js", () => ({
	loadMatrixConfig: () => ({
		channelLabel: "fixture",
		storagePath: "/tmp/fixture",
		ingress: "test",
	}),
}));
vi.mock("../../extensions/pi-matrix/client.js", () => ({
	MatrixBridgeClient: class {
		async start() {}
		async stop() {}
		isConnected() {
			return true;
		}
	},
}));
vi.mock("../../extensions/pi-matrix/js-sdk-adapter.js", () => ({
	MatrixJsSdkAdapter: class {},
}));
vi.mock("../../extensions/pi-matrix/sync-state.js", () => ({
	FileSyncStateStore: class {},
}));
vi.mock("../../extensions/pi-automations/config.js", () => ({
	resolveAutomationsConfig: () => ({ automationsHome: "/tmp/fixture" }),
}));
vi.mock("../../extensions/pi-automations/workspaces.js", () => ({
	currentWorkspaceLabel: async () => "fixture",
}));

import matrixExtension from "../../extensions/pi-matrix/index.js";
import { registerAutomationsLifecycle } from "../../extensions/pi-automations/lifecycle.js";
import type { PiScheduler } from "../../extensions/pi-automations/pi-scheduler.js";

describe("v1 structured prompt composition", () => {
	it("keeps existing sections and replaces each extension section without duplication", async () => {
		const handlers = new Map<
			string,
			Array<(event: unknown, ctx: unknown) => unknown>
		>();
		const api = {
			registerCommand() {},
			on(name: string, callback: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(name, [...(handlers.get(name) ?? []), callback]);
			},
		} as unknown as ExtensionAPI;
		matrixExtension(api);
		const ctx = {
			cwd: "/tmp/fixture/workspace",
			hasUI: true,
			ui: { setStatus() {}, notify() {} },
		};
		// Only Matrix's startup handler: no scheduler or network is started.
		await handlers.get("session_start")?.[0]?.({}, ctx);
		registerAutomationsLifecycle(api, {
			snapshot: () => ({ running: false, enabledSchedules: 0, activeRuns: 0 }),
			stop: async () => {},
		} as unknown as PiScheduler);
		const event = {
			systemPrompt: "base prompt",
			systemPromptOptions: {
				sections: { existing: "retain me" } as Record<string, string>,
			},
		};
		try {
			for (let i = 0; i < 2; i++) {
				for (const handler of handlers.get("before_agent_start") ?? [])
					expect(await handler(event, ctx)).toBeUndefined();
			}
			expect(event.systemPrompt).toBe("base prompt");
			expect(Object.keys(event.systemPromptOptions.sections).sort()).toEqual([
				"automations_workspace",
				"existing",
				"message-channel",
			]);
			expect(event.systemPromptOptions.sections.existing).toBe("retain me");
			expect(event.systemPromptOptions.sections["message-channel"]).toContain(
				'via "fixture"',
			);
			expect(
				event.systemPromptOptions.sections.automations_workspace,
			).toContain("stable, useful, non-secret facts");
		} finally {
			for (const handler of handlers.get("session_shutdown") ?? [])
				await handler({}, ctx);
		}
	});
});
