/** Regression tests for bounded Matrix ingress resources. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatrixAdapterCallbacks, MatrixClientAdapter } from "../../extensions/pi-matrix/adapter.js";
import { extractMatrixAttachment } from "../../extensions/pi-matrix/attachments.js";
import { MatrixBridgeClient } from "../../extensions/pi-matrix/client.js";
import { MatrixJsSdkAdapter } from "../../extensions/pi-matrix/js-sdk-adapter.js";
import {
	AttachmentDownloadResources,
	BoundedRecentSet,
} from "../../extensions/pi-matrix/resource-bounds.js";
import type { MatrixConfig } from "../../extensions/pi-matrix/types.js";

function createConfig(cachePath: string, maxAttachmentBytes = 16): MatrixConfig {
	return {
		homeserver: "https://matrix.example",
		userId: "@bot:example",
		roomId: "!room:example",
		accessToken: "token",
		storagePath: cachePath,
		attachmentCachePath: cachePath,
		maxAttachmentBytes,
		allowedMimePrefixes: ["text/"],
		channelLabel: "matrix",
		trustedSenders: ["@alice:example"],
		allowAnySender: false,
		ingress: {},
	};
}

function mediaEvent(index = 0) {
	return {
		sender: "@alice:example",
		event_id: `$media-${index}:example`,
		content: {
			msgtype: "m.file",
			body: `file-${index}.txt`,
			url: `mxc://example/media-${index}`,
			info: { mimetype: "text/plain", size: 1 },
		},
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (error: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function waitFor(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("Condition was not reached before test deadline.");
}

describe("Matrix attachment resource bounds", () => {
	let cachePath: string;

	afterEach(() => {
		vi.unstubAllGlobals();
		if (cachePath) rmSync(cachePath, { recursive: true, force: true });
	});

	it("limits concurrent downloads by count and aggregate byte reservations", async () => {
		cachePath = mkdtempSync(join(tmpdir(), "matrix-resource-test-"));
		const config = createConfig(cachePath, 10);
		const resources = new AttachmentDownloadResources(3, 20, 8);
		const responses: Array<ReturnType<typeof deferred<Response>>> = [];
		let activeFetches = 0;
		let maxActiveFetches = 0;
		const fetchMock = vi.fn(() => {
			activeFetches += 1;
			maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
			const response = deferred<Response>();
			responses.push(response);
			return response.promise.finally(() => {
				activeFetches -= 1;
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const downloads = Array.from({ length: 4 }, (_, index) =>
			extractMatrixAttachment({
				config,
				client: {},
				roomId: "!room:example",
				event: mediaEvent(index),
				downloadResources: resources,
			}),
		);
		await waitFor(() => fetchMock.mock.calls.length === 2);
		expect(maxActiveFetches).toBe(2);

		responses[0]?.resolve(new Response("a", { headers: { "content-type": "text/plain" } }));
		await waitFor(() => fetchMock.mock.calls.length === 3);
		responses[1]?.resolve(new Response("b", { headers: { "content-type": "text/plain" } }));
		await waitFor(() => fetchMock.mock.calls.length === 4);
		responses[2]?.resolve(new Response("c", { headers: { "content-type": "text/plain" } }));
		responses[3]?.resolve(new Response("d", { headers: { "content-type": "text/plain" } }));

		const results = await Promise.all(downloads);
		expect(results.every((result) => result?.error === undefined)).toBe(true);
		expect(maxActiveFetches).toBeLessThanOrEqual(2);
	});

	it("releases aggregate reservations after both success and failure", async () => {
		const resources = new AttachmentDownloadResources(2, 1, 4);
		const first = deferred<void>();
		const order: string[] = [];
		const failed = resources.run(1, new AbortController().signal, async () => {
			order.push("failed-start");
			await first.promise;
			throw new Error("download failed");
		});
		const succeeded = resources.run(1, new AbortController().signal, async () => {
			order.push("success-start");
			return "ok";
		});

		await waitFor(() => order.length === 1);
		first.resolve();
		await expect(failed).rejects.toThrow("download failed");
		await expect(succeeded).resolves.toBe("ok");
		expect(order).toEqual(["failed-start", "success-start"]);
	});

	it("normalizes an aborted admission with no signal reason", async () => {
		const resources = new AttachmentDownloadResources(1, 1, 1);
		// Minimal signal isolates runtimes or adapters that omit AbortSignal.reason.
		const signal = { aborted: true, reason: undefined } as AbortSignal;

		await expect(resources.run(1, signal, async () => "unused")).rejects.toThrow(
			"Matrix attachment download aborted",
		);
	});

	it("cancels an oversize response reader before releasing resources", async () => {
		cachePath = mkdtempSync(join(tmpdir(), "matrix-oversize-test-"));
		let bodyCancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(17));
			},
			cancel: () => {
				bodyCancelled = true;
			},
		});
		vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
			headers: { "content-type": "text/plain" },
		})));

		const result = await extractMatrixAttachment({
			config: createConfig(cachePath),
			client: {},
			roomId: "!room:example",
			event: mediaEvent(),
			downloadResources: new AttachmentDownloadResources(1, 16, 1),
		});

		expect(result?.error).toContain("exceeds maxAttachmentBytes");
		expect(bodyCancelled).toBe(true);
	});

	it("aborts an active response body read at its deadline", async () => {
		cachePath = mkdtempSync(join(tmpdir(), "matrix-timeout-test-"));
		let bodyCancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel: () => {
				bodyCancelled = true;
			},
		});
		vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
			headers: { "content-type": "text/plain" },
		})));

		const result = await extractMatrixAttachment({
			config: createConfig(cachePath),
			client: {},
			roomId: "!room:example",
			event: mediaEvent(),
			downloadResources: new AttachmentDownloadResources(1, 16, 1),
			timeoutMs: 10,
		});

		expect(result?.error).toContain("timed out");
		expect(bodyCancelled).toBe(true);
	});
});

describe("Matrix lifecycle and event work bounds", () => {
	it("aborts attachment reads when the bridge stops", async () => {
		const cachePath = mkdtempSync(join(tmpdir(), "matrix-stop-test-"));
		let callbacks: MatrixAdapterCallbacks | undefined;
		const adapter: MatrixClientAdapter = {
			start: vi.fn(async (_config, registeredCallbacks) => {
				callbacks = registeredCallbacks;
			}),
			stop: vi.fn(async () => {}),
			joinRoom: vi.fn(async () => {}),
			leaveRoom: vi.fn(async () => {}),
			sendMessage: vi.fn(async () => ({ eventId: "$sent:example" })),
			isConnected: vi.fn(() => true),
			crypto: null,
		};
		let bodyCancelled = false;
		vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
			cancel: () => {
				bodyCancelled = true;
			},
		}), { headers: { "content-type": "text/plain" } })));
		const inbound = vi.fn();
		const bridge = new MatrixBridgeClient(createConfig(cachePath), adapter);
		await bridge.start(inbound);

		const handling = callbacks?.onMessage({
			roomId: "!room:example",
			sender: "@alice:example",
			eventId: "$media:example",
			timestampMs: 1,
			content: mediaEvent().content,
			isHistorical: false,
			isLocalEcho: false,
		});
		await waitFor(() => vi.mocked(fetch).mock.calls.length === 1);
		await bridge.stop();
		await handling;

		expect(bodyCancelled).toBe(true);
		expect(inbound.mock.calls[0]?.[0].attachments[0].error).toContain("client stopped");
		rmSync(cachePath, { recursive: true, force: true });
		vi.unstubAllGlobals();
	});

	it("evicts the oldest seen event ID deterministically", () => {
		const recent = new BoundedRecentSet(3);
		recent.add("$first");
		recent.add("$second");
		recent.add("$second");
		recent.add("$third");
		recent.add("$fourth");

		expect(recent.has("$first")).toBe(false);
		expect(recent.has("$second")).toBe(true);
		expect(recent.has("$third")).toBe(true);
		expect(recent.has("$fourth")).toBe(true);
	});

	it("shares one bounded task set across membership and timeline callbacks", async () => {
		const syncState = {
			load: vi.fn(async () => null),
			save: vi.fn(async () => {}),
			reset: vi.fn(async () => {}),
		};
		const adapter = new MatrixJsSdkAdapter(syncState);
		const eventHandlers = new Map<string, (...args: unknown[]) => void>();
		const fakeClient = {
			on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
				eventHandlers.set(eventName, handler);
			}),
			stopClient: vi.fn(async () => {}),
		};
		const internal = adapter as unknown as {
			client: typeof fakeClient;
			bindMembership: (sdk: unknown, config: MatrixConfig, callbacks: MatrixAdapterCallbacks) => void;
			bindTimeline: (sdk: unknown, config: MatrixConfig, callbacks: MatrixAdapterCallbacks) => void;
		};
		internal.client = fakeClient;
		const blocker = deferred<void>();
		let membershipCallbackCount = 0;
		let timelineCallbackCount = 0;
		const onLog = vi.fn();
		const callbacks: MatrixAdapterCallbacks = {
			onMembership: vi.fn(() => {
				membershipCallbackCount += 1;
				return membershipCallbackCount === 1 ? Promise.reject(new Error("handler failed")) : blocker.promise;
			}),
			onMessage: vi.fn(() => {
				timelineCallbackCount += 1;
				return blocker.promise;
			}),
			onLog,
		};
		const config = createConfig("/tmp");
		internal.bindMembership({ RoomMemberEvent: { Membership: "membership" } }, config, callbacks);
		internal.bindTimeline({ RoomEvent: { Timeline: "timeline" } }, config, callbacks);

		const membershipEvent = {
			getRoomId: () => "!room:example",
			getSender: () => "@alice:example",
		};
		const member = { userId: config.userId, membership: "invite" };
		for (let index = 0; index < 4; index += 1) {
			eventHandlers.get("membership")?.(membershipEvent, member);
		}
		const timelineEvent = {
			event: { content: { msgtype: "m.text", body: "hello" } },
			getType: () => "m.room.message",
			getSender: () => "@alice:example",
			getStatus: () => null,
			getRoomId: () => "!room:example",
			getId: () => "$event:example",
			getTs: () => 1,
		};
		for (let index = 0; index < 8; index += 1) {
			eventHandlers.get("timeline")?.(timelineEvent, null, false);
		}
		await waitFor(() => membershipCallbackCount === 4 && timelineCallbackCount === 4);
		await waitFor(() => onLog.mock.calls.some((call) => String(call[0]).includes("handler failed")));

		expect(onLog.mock.calls.filter((call) => String(call[0]).includes("work limit"))).toHaveLength(4);
		blocker.resolve();
		await adapter.stop();
	});
});
