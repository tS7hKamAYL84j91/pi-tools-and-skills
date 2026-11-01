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

import loglevel from "loglevel";
import { MatrixJsSdkAdapter } from "../js-sdk-adapter.js";
import type { MatrixAdapterCallbacks } from "../adapter.js";
import type { MatrixConfig } from "../types.js";

type Handler = (data: unknown) => void;
type SdkLogger = {
	trace: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	log: (...args: unknown[]) => void;
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
		expect(() => logger.log("legacy noisy request log")).not.toThrow();
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

	it("drops MatrixRTC call-session housekeeping instead of surfacing it in the session", async () => {
		const { logger, onLog } = await startWithLogger();
		logger.warn("MatrixRTCSession !room:matrix.org: onCallMembershipEvent", { membership: "join" });
		logger.error("MatrixRTCSession !room:matrix.org: failed to resolve focus");
		logger.warn("  MatrixRTC !room:matrix.org: delayed event resend");
		// child loggers prepend a `[… ]` span before the family name
		logger.warn("[MatrixRTCSession !room:matrix.org m.call#ROOM] No membership changes detected");
		expect(onLog).not.toHaveBeenCalled();
		// Unrelated warnings are still delivered.
		logger.warn("M_UNKNOWN_TOKEN");
		expect(onLog).toHaveBeenCalledWith("M_UNKNOWN_TOKEN", "warning");
	});

	it("drops homeserver default push rule reconciliation warnings", async () => {
		const { logger, onLog } = await startWithLogger();
		logger.warn("Missing default global override push rule .m.rule.contains_display_name");
		logger.warn("Missing default global override push rule .m.rule.roomnotif");
		logger.warn("Adding default global override push rule .org.matrix.msc3786.rule.room.server_acl");
		logger.warn("Adding default global underride push rule .org.matrix.msc3914.rule.room.call");
		expect(onLog).not.toHaveBeenCalled();
	});

	it("routes runtime loglevel child loggers through the same filter", async () => {
		// matrix-js-sdk derives console-bound child loggers from `logger.getChild`
		// (loglevel registry names "matrix-[…]"); those bypass the client logger.
		const { onLog } = await startWithLogger();
		const rtc = loglevel.getLogger("matrix-[MatrixRTCSession !room:matrix.org m.call#ROOM]");
		rtc.debug("No membership changes detected for room !room:matrix.org");
		rtc.info("Leaving call session in room !room:matrix.org");
		rtc.error("MembershipManager encountered an unrecoverable error:", new Error("boom"));
		expect(onLog).toHaveBeenCalledTimes(1);
		expect(onLog).toHaveBeenCalledWith("MembershipManager encountered an unrecoverable error: boom", "error");
		// Non-SDK loglevel loggers keep their factory behaviour.
		rtc.warn("rate limited", 42);
		expect(onLog).toHaveBeenCalledWith("rate limited 42", "warning");
		const other = loglevel.getLogger("other-namespace");
		other.debug("not silenced");
		expect(onLog).toHaveBeenCalledTimes(2);
	});
});