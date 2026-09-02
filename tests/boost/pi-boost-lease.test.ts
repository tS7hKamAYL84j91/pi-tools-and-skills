/** KISS boost lease tests: exercise the production extension via fake API/context. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBoostExtension } from "../../extensions/pi-boost/index.js";
import { resolveMaxYields } from "../../extensions/pi-boost/boost-settings.js";

const BASELINE = { provider: "ollama", id: "glm-5.2:cloud", input: ["text"] };
const BOOST_MODEL = { provider: "ollama", id: "glm-5.3:cloud", input: ["text"] };
const FRAME_PREFIX = "Challenge prior assumptions";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type NotifyMock = ReturnType<typeof vi.fn> & {
	mock: { calls: Array<[string, string]> };
};

function lastNotify(ctx: unknown): string {
	const calls = (ctx as { ui: { notify: NotifyMock } }).ui.notify.mock.calls;
	const last = calls.at(-1);
	return last ? String(last[0]) : "";
}

function createFakeContext(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/tmp/test",
		hasUI: true,
		mode: "tui",
		model: { ...BASELINE },
		modelRegistry: {
			getAvailable: () => [
				{ ...BASELINE },
				{ ...BOOST_MODEL },
				{ provider: "ollama", id: "gpt-oss:20b", input: ["text"] },
			],
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
		...overrides,
	};
}

function createFakePi() {
	const handlers = new Map<string, Handler>();
	let command: CommandHandler | undefined;
	const setModel = vi.fn(async () => true);
	const sendUserMessage = vi.fn();
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		registerCommand: (_name: string, cmd: { handler: CommandHandler }) => {
			command = cmd.handler;
		},
		setModel,
		sendUserMessage,
	};
	return {
		pi: pi as unknown as Parameters<ReturnType<typeof createBoostExtension>>[0],
		setModel,
		sendUserMessage,
		settled: () => {
			const handler = handlers.get("agent_end");
			if (!handler) throw new Error("agent_end not registered");
			return handler;
		},
		command: () => {
			if (!command) throw new Error("boost command not registered");
			return command;
		},
	};
}

beforeAll(() => {
	// Isolate settings reads/writes from the real home directory.
	process.env.HOME = mkdtempSync(join(tmpdir(), "pi-boost-test-"));
});

async function lastStatus(ctx: unknown): Promise<string> {
	const calls = (ctx as { ui: { setStatus: NotifyMock } }).ui.setStatus.mock
		.calls;
	const last = calls.at(-1);
	return last ? String(last[1]) : "";
}

describe("boost in-session model lease", () => {
	it("switches to the first different text model and sends the framed prompt", async () => {
		const { pi, setModel, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("debug this error", ctx);

		expect(setModel).toHaveBeenCalledWith(BOOST_MODEL);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.startsWith(FRAME_PREFIX)).toBe(true);
		expect(message.endsWith("debug this error")).toBe(true);
		expect(await lastStatus(ctx)).toContain("active");
		expect(await lastStatus(ctx)).toContain("2 left");
	});

	it("restores the baseline when the run settles", async () => {
		const { pi, setModel, settled, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		await settled()({}, ctx);

		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
		expect(await lastStatus(ctx)).toContain("off");
	});

	it("keeps the boost model through retries and only restores on settle", async () => {
		const { pi, setModel, settled, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		// A second boost while active is denied; the model is NOT restored early.
		await command()("again", ctx);
		expect(setModel).toHaveBeenCalledTimes(1);
		expect(setModel).toHaveBeenLastCalledWith(BOOST_MODEL);

		await settled()({}, ctx);
		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
	});

	it("denies after three yields and allows reset", async () => {
		const { pi, settled, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		for (let index = 0; index < 3; index++) {
			await command()(`run ${index}`, ctx);
			await settled()({}, ctx);
		}
		await command()("run 4", ctx);
		const denied = lastNotify(ctx);
		expect(denied).toContain("lease exhausted");

		await command()("reset", ctx);
		expect(await lastStatus(ctx)).toContain("3 left");
		await command()("run 5", ctx);
		expect(await lastStatus(ctx)).toContain("active");
	});

	it("blocks after restore failure and reset retries restore only", async () => {
		const setModel = vi
			.fn<(model: unknown) => Promise<boolean>>()
			.mockResolvedValueOnce(true) // boost switch
			.mockRejectedValueOnce(new Error("restore boom")) // settled restore
			.mockResolvedValueOnce(true); // reset retry
		const { pi, settled, command } = createFakePi();
		(pi as unknown as { setModel: typeof setModel }).setModel = setModel;
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		await settled()({}, ctx);
		expect(await lastStatus(ctx)).toContain("blocked");

		await command()("run again", ctx);
		const blocked = lastNotify(ctx);
		expect(blocked).toContain("blocked");

		await command()("reset", ctx);
		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
		expect(await lastStatus(ctx)).not.toContain("blocked");
	});

	it("denies without consuming a yield when the boost model has no auth", async () => {
		const setModel = vi.fn(async () => false);
		const { pi, command } = createFakePi();
		(pi as unknown as { setModel: typeof setModel }).setModel = setModel;
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		const denied = lastNotify(ctx);
		expect(denied).toContain("no auth configured");
		expect(await lastStatus(ctx)).toContain("3 left");
	});

	it("delivers with followUp when the agent is streaming", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext({ isIdle: () => false });

		await command()("run", ctx);
		expect(sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("run"),
			{ deliverAs: "followUp" },
		);
	});

	it("refunds the yield and restores immediately when dispatch throws", async () => {
		const { pi, sendUserMessage, setModel, command } = createFakePi();
		sendUserMessage.mockImplementation(() => {
			throw new Error("send boom");
		});
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
		expect(await lastStatus(ctx)).toContain("3 left");
	});
});

describe("boost settings", () => {
	it("clamps maxYields to the hard cap of 3", async () => {
		expect(await resolveMaxYields("/tmp/test")).toBe(3);
	});
});