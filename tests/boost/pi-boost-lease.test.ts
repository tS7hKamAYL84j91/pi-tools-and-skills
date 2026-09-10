/** KISS boost lease tests: exercise the production extension via fake API/context. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBoostExtension } from "../../extensions/pi-boost/index.js";
import {
	BOOST_LEASE_TTL_MS,
	queueSaveBoostSetting,
	resolveMaxYields,
} from "../../extensions/pi-boost/boost-settings.js";

const BASELINE = { provider: "ollama", id: "glm-5.2:cloud", input: ["text"] };
const BOOST_MODEL = {
	provider: "ollama",
	id: "glm-5.3:cloud",
	input: ["text"],
};
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
			custom: vi.fn(async () => undefined),
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

	it("automatically renews an expired lease on the next boost prompt", async () => {
		vi.useFakeTimers();
		try {
			const { pi, settled, command } = createFakePi();
			createBoostExtension()(pi);
			const ctx = createFakeContext();

			await command()("run", ctx);
			await settled()({}, ctx);
			vi.setSystemTime(Date.now() + BOOST_LEASE_TTL_MS);

			await command()("status", ctx);
			expect(lastNotify(ctx)).toContain("next /boost renews");
			expect(await lastStatus(ctx)).toContain("expired");
			await command()("run again", ctx);
			expect(await lastStatus(ctx)).toContain("active");
			expect(await lastStatus(ctx)).toContain("2 left");
			await settled()({}, ctx);
			await command()("run 3", ctx);
			expect(await lastStatus(ctx)).toContain("1 left");
		} finally {
			vi.useRealTimers();
		}
	});

	it("bare /boost renews an expired exhausted lease without consuming a yield", async () => {
		vi.useFakeTimers();
		try {
			const { pi, settled, command } = createFakePi();
			createBoostExtension()(pi);
			const ctx = createFakeContext();
			for (let index = 0; index < 3; index++) {
				await command()("run", ctx);
				await settled()({}, ctx);
			}
			vi.setSystemTime(Date.now() + BOOST_LEASE_TTL_MS);
			await command()("", ctx);
			expect(ctx.ui.custom).toHaveBeenCalledOnce();
			expect(await lastStatus(ctx)).toContain("3 left");
			await command()("run", ctx);
			expect(await lastStatus(ctx)).toContain("active");
			expect(await lastStatus(ctx)).toContain("2 left");
		} finally { vi.useRealTimers(); }
	});

	it("does not renew or interrupt an in-flight boost after expiry", async () => {
		vi.useFakeTimers();
		try {
			const { pi, setModel, settled, command } = createFakePi();
			createBoostExtension()(pi);
			const ctx = createFakeContext();

			await command()("run", ctx);
			vi.setSystemTime(Date.now() + BOOST_LEASE_TTL_MS);
			await command()("status", ctx);
			expect(await lastStatus(ctx)).toContain("active");
			await command()("again", ctx);
			expect(lastNotify(ctx)).toContain("already active");
			expect(setModel).toHaveBeenCalledTimes(1);
			await settled()({}, ctx);

			expect(setModel).toHaveBeenLastCalledWith(BASELINE);
			expect(await lastStatus(ctx)).toContain("expired");
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([5, 30])("uses the configured %i-minute expiry for status and renewal", async (minutes) => {
		vi.useFakeTimers();
		try {
			await queueSaveBoostSetting("leaseMinutes", minutes);
			const { pi, settled, command } = createFakePi();
			createBoostExtension()(pi);
			const ctx = createFakeContext();
			await command()("run", ctx);
			await settled()({}, ctx);
			vi.setSystemTime(Date.now() + minutes * 60_000 - 1);
			await command()("status", ctx);
			expect(lastNotify(ctx)).toContain(`lease=${minutes}m`);
			expect(await lastStatus(ctx)).not.toContain("expired");
			vi.setSystemTime(Date.now() + 1);
			await command()("status", ctx);
			expect(await lastStatus(ctx)).toContain("expired");
			await command()("run again", ctx);
			expect(await lastStatus(ctx)).toContain("active");
			expect(await lastStatus(ctx)).toContain("2 left");
		} finally {
			vi.useRealTimers();
			await queueSaveBoostSetting("leaseMinutes", 10);
		}
	});

	it("changing lease length applies to the current lease without interrupting its turn", async () => {
		vi.useFakeTimers();
		try {
			const { pi, setModel, settled, command } = createFakePi();
			createBoostExtension()(pi);
			const ctx = createFakeContext();
			await command()("run", ctx);
			vi.setSystemTime(Date.now() + 6 * 60_000);
			await queueSaveBoostSetting("leaseMinutes", 5);
			await command()("status", ctx);
			expect(await lastStatus(ctx)).toContain("active");
			expect(setModel).toHaveBeenCalledTimes(1);
			await settled()({}, ctx);
			expect(await lastStatus(ctx)).toContain("expired");
			await queueSaveBoostSetting("leaseMinutes", 30);
			await command()("status", ctx);
			expect(await lastStatus(ctx)).toContain("off");
			expect(await lastStatus(ctx)).toContain("2 left");
		} finally {
			vi.useRealTimers();
			await queueSaveBoostSetting("leaseMinutes", 10);
		}
	});

	it("defaults to a 10-minute lease TTL", () => {
		expect(BOOST_LEASE_TTL_MS).toBe(600_000);
	});

	it("keeps a blocked lease blocked even past the TTL", async () => {
		vi.useFakeTimers();
		try {
			const setModel = vi
				.fn<(model: unknown) => Promise<boolean>>()
				.mockResolvedValueOnce(true) // boost switch
				.mockRejectedValueOnce(new Error("restore boom")); // settled restore
			const { pi, settled, command } = createFakePi();
			(pi as unknown as { setModel: typeof setModel }).setModel = setModel;
			createBoostExtension()(pi);
			const ctx = createFakeContext();

			await command()("run", ctx);
			await settled()({}, ctx);
			expect(await lastStatus(ctx)).toContain("blocked");

			vi.setSystemTime(Date.now() + BOOST_LEASE_TTL_MS);
			await command()("run later", ctx);
			const denied = lastNotify(ctx);
			expect(denied).toContain("blocked");
			expect(denied).not.toContain("expired");
		} finally {
			vi.useRealTimers();
		}
	});

	it("starts a fresh lease clock after a refunded dispatch", async () => {
		vi.useFakeTimers();
		try {
			const { pi, sendUserMessage, command } = createFakePi();
			sendUserMessage.mockImplementationOnce(() => {
				throw new Error("send boom");
			});
			createBoostExtension()(pi);
			const ctx = createFakeContext();

			await command()("run", ctx); // dispatch fails; yield refunded
			vi.setSystemTime(Date.now() + BOOST_LEASE_TTL_MS);

			await command()("run again", ctx); // fresh clock, must succeed
			expect(lastNotify(ctx)).not.toContain("expired");
			expect(await lastStatus(ctx)).toContain("active");
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["false", "throw"])("retains recovery state when dispatch fails and restore returns %s", async (failure) => {
		const { pi, sendUserMessage, setModel, command } = createFakePi();
		setModel.mockResolvedValueOnce(true);
		if (failure === "false") setModel.mockResolvedValueOnce(false);
		else setModel.mockRejectedValueOnce(new Error("restore failed"));
		sendUserMessage.mockImplementationOnce(() => { throw new Error("send failed"); });
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("run", ctx);
		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
		expect(await lastStatus(ctx)).toContain("blocked");
		expect(await lastStatus(ctx)).toContain("3 left");
		await command()("run again", ctx);
		expect(lastNotify(ctx)).toContain("blocked");
		expect(setModel).toHaveBeenCalledTimes(2);

		await command()("reset", ctx);
		expect(setModel).toHaveBeenLastCalledWith(BASELINE);
		expect(await lastStatus(ctx)).toContain("off");
		await command()("run after reset", ctx);
		expect(await lastStatus(ctx)).toContain("active");
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

describe("boost modes", () => {
	function userEntry(text: string): { type: string; message: { role: string; content: string } } {
		return { type: "message", message: { role: "user", content: text } };
	}
	function contextWithBranch(entries: unknown[]): Record<string, unknown> {
		return createFakeContext({ sessionManager: { getBranch: () => entries } });
	}

	it("runs explicit challenge mode with the same framing as the default", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("challenge fix the leak", ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.startsWith(FRAME_PREFIX)).toBe(true);
		expect(message).toContain("alternative approaches and one concrete useful next move");
		expect(message.endsWith("fix the leak")).toBe(true);
	});

	it("runs plan mode with a TODO frame that forbids execution", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("plan fix the leak", ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.startsWith("Produce a concise, actionable TODO plan")).toBe(true);
		expect(message).toContain("This is planning only");
		expect(message).toContain("do not start implementing");
		expect(message.endsWith("fix the leak")).toBe(true);
		expect(message.startsWith(FRAME_PREFIX)).toBe(false);
	});

	it("treats a leading 'plan' in free text as plan mode (documented ambiguity)", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("plan to migrate the parser", ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.startsWith("Produce a concise")).toBe(true);
		expect(message.endsWith("to migrate the parser")).toBe(true);
	});

	it("lets explicit challenge mode escape the plan ambiguity", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext();

		await command()("challenge plan everything twice", ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.startsWith(FRAME_PREFIX)).toBe(true);
		expect(message.endsWith("plan everything twice")).toBe(true);
	});

	it.each(["plan", "challenge"])("omitted prompt in %s mode boosts the most recent real problem", async (mode) => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = contextWithBranch([
			userEntry("the parser breaks on nested quotes"),
			userEntry("Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\nolder boost prompt"),
		]);

		await command()(mode, ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.endsWith("the parser breaks on nested quotes")).toBe(true);
		if (mode === "plan") expect(message.startsWith("Produce a concise")).toBe(true);
		else expect(message.startsWith(FRAME_PREFIX)).toBe(true);
	});

	it("skips boost-injected prompts when finding current-problem context", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		// Latest entries are boost-injected; the real problem is earlier in the branch.
		const ctx = contextWithBranch([
			userEntry("the flaky test only fails under load"),
			userEntry("Produce a concise, actionable TODO plan for the request below: list the concrete steps, their dependencies, and the first step to take. This is planning only — do not start implementing, modify files, or treat it as authorization to execute; the user will review the plan first.\n\nolder plan prompt"),
		]);

		await command()("challenge", ctx);
		const message = String(sendUserMessage.mock.calls[0]?.[0]);
		expect(message.endsWith("the flaky test only fails under load")).toBe(true);
	});

	it("reads array-form user message content", async () => {
		const { pi, sendUserMessage, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = contextWithBranch([
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "array-form problem" }] } },
		]);

		await command()("plan", ctx);
		expect(String(sendUserMessage.mock.calls[0]?.[0]).endsWith("array-form problem")).toBe(true);
	});

	it("denies an omitted prompt with no recent problem without consuming a yield", async () => {
		const { pi, setModel, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = createFakeContext(); // no sessionManager, no branch

		await command()("plan", ctx);
		expect(lastNotify(ctx)).toContain("no prompt given and no recent user problem");
		expect(setModel).not.toHaveBeenCalled();
		expect(await lastStatus(ctx)).toContain("3 left");
	});

	it("keeps exact subcommands ahead of mode parsing", async () => {
		const { pi, setModel, command } = createFakePi();
		createBoostExtension()(pi);
		const ctx = contextWithBranch([userEntry("plan is just my word")]);

		await command()("clear", ctx);
		expect(lastNotify(ctx)).toContain("cleared");
		expect(setModel).not.toHaveBeenCalled();

		await command()("status", ctx);
		expect(lastNotify(ctx)).toContain("Boost:");
	});
});
