/** Tests for the Pi lifecycle wiring (SPEC §17): restore, deliver, timers, checkpoints. */

import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configText, contextFor, createFakeEventLoopPi } from "../../../tests/fixtures/pi-event-loop.js";
import { CONFIG_RELATIVE_PATH } from "../config.js";
import eventLoopExtension from "../index.js";

const BASE_TIME = new Date("2026-01-05T10:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(BASE_TIME);
});

const createdDirs: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const dir of createdDirs.splice(0)) {
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

function writeConfigDir(text: string): string {
	const dir = nodeFs.mkdtempSync(join(tmpdir(), "event-loop-wiring-"));
	nodeFs.mkdirSync(join(dir, ".pi"), { recursive: true });
	nodeFs.writeFileSync(join(dir, CONFIG_RELATIVE_PATH), text, "utf8");
	createdDirs.push(dir);
	return dir;
}

async function runSessionStart(fake: FakePi, cwd: string): Promise<void> {
	const handler = fake.handlers.get("session_start");
	if (handler === undefined) {
		throw new Error("session_start handler not registered");
	}
	await handler(
		{ type: "session_start", reason: "startup" },
		contextFor(fake, cwd),
	);
	await vi.advanceTimersByTimeAsync(5);
}

async function fireAgentSettled(fake: FakePi, cwd: string): Promise<void> {
	const handler = fake.handlers.get("agent_settled");
	if (handler === undefined) {
		throw new Error("agent_settled handler not registered");
	}
	await handler({ type: "agent_settled" }, contextFor(fake, cwd));
	await vi.advanceTimersByTimeAsync(5);
}

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakePi = ReturnType<typeof createFakeEventLoopPi>;

/** Narrow the registered handler map off the shared fixture fake. */
function handlersOf(fake: FakePi): Map<string, Handler> {
	return fake.handlers;
}

describe("index lifecycle wiring (SPEC §17)", () => {
	it("registers agent_settled lifecycle hook", () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		expect(handlersOf(fake).has("agent_settled")).toBe(true);
	});

	it("delivery pump is re-entrant: empty initial cycle followed by later event delivers", async () => {
		const fake = createFakeEventLoopPi();
		const registeredTools: Array<{
			name: string;
			execute: (
				id: string,
				params: unknown,
				ext?: unknown,
				sig?: unknown,
				ctx?: unknown,
			) => Promise<unknown>;
		}> = [];
		fake.api = {
			on: (
				event: string,
				handler: (event: unknown, ctx: unknown) => unknown,
			) => {
				fake.handlers.set(event, handler);
			},
			registerTool: (tool: {
				name: string;
				execute: (
					id: string,
					params: unknown,
					ext?: unknown,
					sig?: unknown,
					ctx?: unknown,
				) => Promise<unknown>;
			}) => {
				registeredTools.push(tool);
			},
			registerCommand: () => undefined,
			appendEntry: (customType: string, data?: unknown) => {
				fake.entries.push({ type: "custom", customType, data: data ?? null });
			},
			sendMessage: (message: unknown, options: unknown) => {
				fake.sent.push({ message, options });
				fake.idle = false;
			},
		} as never;

		eventLoopExtension(fake.api);
		const raw = JSON.parse(configText()) as {
			profiles: {
				default: { events: Record<string, Record<string, unknown>> };
			};
		};
		raw.profiles.default.events["work.requested"] = {
			...raw.profiles.default.events["work.requested"],
			allowAgentEmit: true,
			allowWithoutCommand: true,
		};
		const cwd = writeConfigDir(JSON.stringify(raw));

		await runSessionStart(fake, cwd);
		expect(fake.sent).toHaveLength(0);
		await fireAgentSettled(fake, cwd);

		// Emit an event after the initial cycle exited
		const emitTool = registeredTools.find((t) => t.name === "event_loop_emit");
		expect(emitTool).toBeDefined();

		await emitTool!.execute(
			"call-1",
			{
				event: "work.requested",
				dedupeKey: "work-reentry-1",
				payload: { workId: "work-reentry-1" },
			},
			undefined,
			undefined,
			contextFor(fake, cwd),
		);
		await vi.advanceTimersByTimeAsync(5);
		await Promise.resolve();
		await Promise.resolve();

		// Should deliver the command for the new item
		expect(fake.sent).toHaveLength(1);
	});
});
