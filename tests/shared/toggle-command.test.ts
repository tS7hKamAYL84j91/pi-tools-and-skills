import { describe, expect, it, vi } from "vitest";
import { registerToggleCommand, type ToggleControl } from "../../lib/toggle-command.js";

function createFakePi() {
	let registeredHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		registerCommand: (_name: string, cmd: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			registeredHandler = cmd.handler;
		},
	};
	return {
		pi: pi as never,
		handler: () => {
			if (!registeredHandler) throw new Error("command not registered");
			return registeredHandler;
		},
	};
}

function createFakeContext() {
	const notify = vi.fn();
	return {
		ui: { notify },
		notify,
	};
}

describe("registerToggleCommand", () => {
	it("notifies current status when run with empty or non-toggle args", async () => {
		const { pi, handler } = createFakePi();
		const control: ToggleControl = {
			setEnabled: vi.fn(async () => {}),
			getStatus: () => "disabled",
		};
		registerToggleCommand(
			pi,
			{ name: "test-toggle", description: "test", label: "Test follow-ups" },
			control,
		);

		const ctx = createFakeContext();
		await handler()("", ctx);
		expect(ctx.notify).toHaveBeenCalledWith(
			"Test follow-ups are disabled. Usage: /test-toggle on|off",
			"info",
		);
	});

	it("enables follow-ups on 'on' argument", async () => {
		const { pi, handler } = createFakePi();
		let status = "disabled";
		const control: ToggleControl = {
			setEnabled: vi.fn(async (enabled: boolean) => {
				status = enabled ? "enabled" : "disabled";
			}),
			getStatus: () => status,
		};
		registerToggleCommand(
			pi,
			{ name: "test-toggle", description: "test", label: "Test follow-ups" },
			control,
		);

		const ctx = createFakeContext();
		await handler()("on", ctx);
		expect(control.setEnabled).toHaveBeenCalledWith(true);
		expect(ctx.notify).toHaveBeenCalledWith("Test follow-ups: enabled", "info");
	});

	it("notifies error when persisting fails", async () => {
		const { pi, handler } = createFakePi();
		const control: ToggleControl = {
			setEnabled: vi.fn(async () => {
				throw new Error("disk error");
			}),
			getStatus: () => "disabled",
		};
		registerToggleCommand(
			pi,
			{
				name: "test-toggle",
				description: "test",
				label: "Test follow-ups",
				settingsLabel: "test feature",
			},
			control,
		);

		const ctx = createFakeContext();
		await handler()("off", ctx);
		expect(ctx.notify).toHaveBeenCalledWith(
			"Unable to persist test feature settings.",
			"error",
		);
	});
});
