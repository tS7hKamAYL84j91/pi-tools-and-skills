/** Matrix startup-failure resource cleanup regression tests. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const mocks = vi.hoisted(() => {
	const instances: Array<{
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		isConnected: ReturnType<typeof vi.fn>;
	}> = [];
	return {
		instances,
		registerChannel: vi.fn(),
		unregisterChannel: vi.fn(),
		loadMatrixConfig: vi.fn(),
		startError: undefined as Error | undefined,
	};
});

vi.mock("../config.js", () => ({
	loadMatrixConfig: mocks.loadMatrixConfig,
}));

vi.mock("../client.js", () => ({
	MatrixBridgeClient: class {
		start = vi.fn(async () => {
			if (mocks.startError) {
				throw mocks.startError;
			}
		});
		stop = vi.fn(async () => {});
		isConnected = vi.fn(() => true);

		constructor() {
			mocks.instances.push(this);
		}
	},
}));

vi.mock("../../../lib/message-transport.js", () => ({
	registerChannel: mocks.registerChannel,
	unregisterChannel: mocks.unregisterChannel,
	notifyChannel: vi.fn(),
}));

import matrixExtension from "../index.js";

interface HandlerApi {
	handlers: Map<string, Array<(...args: unknown[]) => Promise<unknown>>>;
}

function createApi(): HandlerApi & ExtensionAPI {
	const handlers = new Map<string, Array<(...args: unknown[]) => Promise<unknown>>>();
	return {
		handlers,
		on(event: string, handler: unknown) {
		const registered = handlers.get(event) ?? [];
		registered.push(handler as (...args: unknown[]) => Promise<unknown>);
		handlers.set(event, registered);
		},
		registerCommand: vi.fn(),
	} as unknown as HandlerApi & ExtensionAPI;
}

function createContext() {
	return {
		cwd: "/tmp/project",
		hasUI: true,
		mode: "tui",
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
	};
}

async function emit(api: HandlerApi, event: string, ...args: unknown[]): Promise<void> {
	for (const handler of api.handlers.get(event) ?? []) {
		await handler(...args);
	}
}

const MATRIX_CONFIG = {
	homeserver: "https://matrix.example",
	userId: "@bot:example",
	roomId: "!room:example",
	accessToken: "token",
	storagePath: "/tmp/matrix",
	attachmentCachePath: "/tmp/matrix",
	maxAttachmentBytes: 1,
	allowedMimePrefixes: ["text/"],
	channelLabel: "matrix",
	trustedSenders: [],
	allowAnySender: false,
};

describe("Matrix lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.instances.length = 0;
		mocks.startError = undefined;
		mocks.loadMatrixConfig.mockReturnValue(MATRIX_CONFIG);
	});

	it("releases the channel and client when startup fails", async () => {
		const api = createApi();
		matrixExtension(api);
		mocks.startError = new Error("sync failed");

		await emit(api, "session_start", {}, createContext());

		expect(mocks.unregisterChannel).toHaveBeenCalledWith("matrix");
		expect(mocks.instances).toHaveLength(1);
		expect(mocks.instances[0]?.stop).toHaveBeenCalledTimes(1);
	});
});
