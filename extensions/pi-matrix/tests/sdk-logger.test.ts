/** Matrix SDK logger filtering regression tests. */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sdk: {
		MemoryStore: class {
			setSyncToken() {}
		},
		createClient: vi.fn(),
		ClientEvent: { Sync: "sync" },
		RoomMemberEvent: { Membership: "membership" },
		RoomEvent: { Timeline: "timeline" },
	},
}));

vi.mock("matrix-js-sdk", () => mocks.sdk);

import { MatrixJsSdkAdapter } from "../js-sdk-adapter.js";
import type { MatrixAdapterCallbacks } from "../adapter.js";
import type { MatrixConfig } from "../types.js";

type Handler = (data: unknown) => void;
type SdkLogger = {
	trace: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	getChild: (namespace: string) => unknown;
};

function createFakeClient(): FakeClient {
	const listeners = new Map<string, Handler[]>();
	const add = (event: string, handler: Handler) => {
		listeners.set(event, [...(listeners.get(event) ?? []), handler]);
	};
	const remove = (event: string, handler: Handler) => {
		listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
	};
	return {
		on: (event, handler) => add(event, handler),
		off: (event, handler) => remove(event, handler),
		// waitForPrepared registers a once-handler immediately after startClient;
		// resolving it inline keeps these tests synchronous and fast.
		once: (event, handler) => {
			if (event === "sync") handler("PREPARED");
		},
		startClient: vi.fn(async () => {}),
		stopClient: vi.fn(async () => {}),
	};
}

interface FakeClient {
	on: (event: string, handler: Handler) => void;
	off: (event: string, handler: Handler) => void;
	once: (event: string, handler: Handler) => void;
	startClient: () => Promise<void>;
	stopClient: () => Promise<void>;
}

function config(): MatrixConfig {
	return {
		homeserver: "https://matrix.example.org",
		accessToken: "token",
		userId: "@bot:example.org",
		trustedSenders: [],
	} as unknown as MatrixConfig;
}

async function startWithLogger(): Promise<{
	logger: SdkLogger;
	onLog: ReturnType<typeof vi.fn>;
}> {
	let logger: SdkLogger | undefined;
	mocks.sdk.createClient.mockImplementation((opts: { logger: SdkLogger }) => {
		logger = opts.logger;
		return createFakeClient();
	});
	const onLog = vi.fn();
	const adapter = new MatrixJsSdkAdapter({
		load: vi.fn(async () => null),
		save: vi.fn(async () => {}),
		reset: vi.fn(async () => {}),
	});
	await adapter.start(config(), { onLog } as unknown as MatrixAdapterCallbacks);
	await adapter.stop();
	expect(logger).toBeDefined();
	return { logger: logger as SdkLogger, onLog };
}

describe("MatrixJsSdkAdapter sdk logger", () => {
	it("filtered logger swallows per-request debug noise and never reaches notify", async () => {
		const { logger, onLog } = await startWithLogger();
		expect(() => logger.debug("FetchHttpApi: --> GET /_matrix/client/v3/sync")).not.toThrow();
		expect(() => logger.trace("noisy")).not.toThrow();
		expect(() => logger.info("noisy")).not.toThrow();
		expect(logger.getChild("http")).toBeDefined();
		expect(onLog).not.toHaveBeenCalled();
	});

	it("routes sdk warn/error logs to the extension notify path", async () => {
		const { logger, onLog } = await startWithLogger();
		logger.error("sync failed", new Error("boom"));
		logger.warn("rate limited", 42);
		expect(onLog).toHaveBeenCalledWith("sync failed boom", "error");
		expect(onLog).toHaveBeenCalledWith("rate limited 42", "warning");
	});
});