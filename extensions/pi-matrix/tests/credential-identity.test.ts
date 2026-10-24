/**
 * Identity proof for a dedicated Matrix credential.
 *
 * When a profile resolves `matrix.tokenSecret`, the adapter must prove the token
 * belongs to the rendered `userId` (`/account/whoami`) BEFORE it starts syncing or
 * joins a room. A mismatch aborts the start, so a wrong or half-provisioned
 * credential cannot bind a lead's room or answer in it.
 *
 * Fake SDK only: no homeserver, token or room.
 */

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
import { MatrixBridgeClient } from "../client.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const LEAD_A = `@lead-a:${HOME}`;
const LEAD_B = `@lead-b:${HOME}`;

type Handler = (...args: unknown[]) => unknown;

function createFakeClient(whoami: () => Promise<unknown>) {
	const listeners = new Map<string, Handler[]>();
	const client = {
		whoami: vi.fn(whoami),
		startClient: vi.fn(async () => {}),
		stopClient: vi.fn(async () => {}),
		joinRoom: vi.fn(async () => {}),
		on: vi.fn((event: string, handler: Handler) => {
			listeners.set(event, [...(listeners.get(event) ?? []), handler]);
			return client;
		}),
		off: vi.fn(),
		// waitForPrepared registers a once-handler right after startClient.
		once: vi.fn((event: string, handler: Handler) => {
			if (event === "sync") handler("PREPARED");
		}),
	};
	return client;
}

function makeConfig(overrides: Partial<MatrixConfig> = {}): MatrixConfig {
	return {
		homeserver: `https://${HOME}`,
		userId: LEAD_A,
		roomId: "!lead-a-room:matrix.example.net",
		sharedRoomId: "!eo-leads:matrix.example.net",
		mentionNames: ["lead-a"],
		mentionUserIds: [LEAD_A],
		accessToken: "fd_fixture_token_value_1234567890",
		verifyIdentity: true,
		storagePath: "/tmp/fake-identity",
		attachmentCachePath: "/tmp/fake-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: [],
		channelLabel: "matrix",
		trustedSenders: [`@jim:${HOME}`],
		allowAnySender: false,
		ingress: {},
		...overrides,
	} as MatrixConfig;
}

/** Bridge + real adapter over a fake SDK client, so joins are exercised too. */
function start(config: MatrixConfig, client: ReturnType<typeof createFakeClient>) {
	mocks.sdk.createClient.mockReturnValue(client);
	const adapter = new MatrixJsSdkAdapter({
		load: vi.fn(async () => null),
		save: vi.fn(async () => {}),
		reset: vi.fn(async () => {}),
	});
	const bridge = new MatrixBridgeClient(config, adapter);
	return { bridge };
}

describe("dedicated credential identity proof", () => {
	it("verifies whoami before syncing and joining, then proceeds when it matches", async () => {
		const client = createFakeClient(async () => ({ user_id: LEAD_A }));
		const { bridge } = start(makeConfig(), client);

		await bridge.start(() => {});

		expect(client.whoami).toHaveBeenCalledTimes(1);
		expect(client.startClient).toHaveBeenCalledTimes(1);
		// Both configured rooms are joined after the identity was proven.
		expect(client.joinRoom).toHaveBeenCalledWith("!lead-a-room:matrix.example.net");
		expect(client.joinRoom).toHaveBeenCalledWith("!eo-leads:matrix.example.net");
		const whoamiOrder = client.whoami.mock.invocationCallOrder[0] ?? 0;
		const startOrder = client.startClient.mock.invocationCallOrder[0] ?? 0;
		expect(whoamiOrder).toBeLessThan(startOrder);
	});

	it("refuses to start, sync or join when the token belongs to another lead", async () => {
		const client = createFakeClient(async () => ({ user_id: LEAD_B }));
		const { bridge } = start(makeConfig(), client);

		await expect(bridge.start(() => {})).rejects.toThrow(/identity mismatch/);
		expect(client.startClient).not.toHaveBeenCalled();
		expect(client.joinRoom).not.toHaveBeenCalled();
	});

	it("does not echo the returned identity on mismatch", async () => {
		const client = createFakeClient(async () => ({ user_id: LEAD_B }));
		const { bridge } = start(makeConfig(), client);

		const error = await bridge.start(() => {}).catch((err: Error) => err);
		expect((error as Error).message).not.toContain(LEAD_B);
		expect((error as Error).message).not.toContain("lead-b");
		expect((error as Error).message).toMatch(/does not belong to the rendered matrix\.userId/);
	});

	it("does not echo upstream error text, only a fixed-shape code", async () => {
		const leaky = Object.assign(new Error("POST https://homeserver/_matrix?access_token=syt_leaky"), {
			errcode: "M_UNKNOWN_TOKEN",
		});
		const client = createFakeClient(async () => {
			throw leaky;
		});
		const { bridge } = start(makeConfig(), client);

		const error = (await bridge.start(() => {}).catch((err: Error) => err)) as Error;
		expect(error.message).toContain("errcode M_UNKNOWN_TOKEN");
		expect(error.message).not.toContain("syt_leaky");
		expect(error.message).not.toContain("homeserver");
	});

	it("reports a bare error class when no safe code is available", async () => {
		const client = createFakeClient(async () => {
			throw new Error("token syt_leaky in a plain message");
		});
		const { bridge } = start(makeConfig(), client);

		const error = (await bridge.start(() => {}).catch((err: Error) => err)) as Error;
		expect(error.message).toContain("error Error");
		expect(error.message).not.toContain("syt_leaky");
	});

	it("treats a case-different MXID as a mismatch (no normalisation as identity)", async () => {
		const client = createFakeClient(async () => ({ user_id: `@Lead-A:${HOME}` }));
		const { bridge } = start(makeConfig(), client);

		await expect(bridge.start(() => {})).rejects.toThrow(/identity mismatch/);
		expect(client.startClient).not.toHaveBeenCalled();
	});

	it("refuses to start when whoami cannot be answered", async () => {
		const client = createFakeClient(async () => {
			throw new Error("M_UNKNOWN_TOKEN");
		});
		const { bridge } = start(makeConfig(), client);

		await expect(bridge.start(() => {})).rejects.toThrow(/identity could not be verified/);
		expect(client.startClient).not.toHaveBeenCalled();
		expect(client.joinRoom).not.toHaveBeenCalled();
	});

	it("never leaks the token in the failure message", async () => {
		const client = createFakeClient(async () => ({ user_id: LEAD_B }));
		const { bridge } = start(makeConfig(), client);

		const error = await bridge.start(() => {}).catch((err: Error) => err);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).not.toContain("fd_fixture_token_value_1234567890");
	});

	it("does not call whoami for an inherited credential (unchanged behaviour)", async () => {
		const client = createFakeClient(async () => ({ user_id: LEAD_A }));
		const config = makeConfig({ verifyIdentity: false });
		const { bridge } = start(config, client);

		await bridge.start(() => {});

		expect(client.whoami).not.toHaveBeenCalled();
		expect(client.startClient).toHaveBeenCalledTimes(1);
	});
});
