/**
 * Vertical per-GM room slice (fake homeserver).
 *
 * Rendered project settings -> loadMatrixConfig -> MatrixBridgeClient ->
 * MatrixTransport -> message_read buffer. Two agents share one Matrix account
 * and one homeserver, each with its own private room and sync directory. This
 * is the smallest end-to-end assertion that room -> agent -> reply works and
 * that neither agent consumes or answers in the other's room.
 *
 * No live homeserver, token, or room: the token is a dummy fixture string.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
} from "../../extensions/pi-matrix/adapter.js";
import { MatrixBridgeClient } from "../../extensions/pi-matrix/client.js";
import { loadMatrixConfig } from "../../extensions/pi-matrix/config.js";
import { MatrixTransport } from "../../extensions/pi-matrix/transport.js";
import type { MatrixConfig } from "../../extensions/pi-matrix/types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const BOT = `@coas-bot:${HOME}`;
const TOKEN_ENV = "PI_MATRIX_VERTICAL_FIXTURE_TOKEN";

function makeAdapter() {
	const adapter = {
		callbacks: undefined as unknown as MatrixAdapterCallbacks,
		sent: [] as Array<{ roomId: string; body: string }>,
		joined: [] as string[],
		left: [] as string[],
		crypto: null,
		async start(_config: MatrixConfig, callbacks: MatrixAdapterCallbacks) {
			adapter.callbacks = callbacks;
		},
		async stop() {},
		async joinRoom(roomId: string) {
			adapter.joined.push(roomId);
		},
		async leaveRoom(roomId: string) {
			adapter.left.push(roomId);
		},
		async sendMessage(roomId: string, content: Record<string, unknown>) {
			adapter.sent.push({ roomId, body: String(content.body ?? "") });
			return { eventId: `$sent-${adapter.sent.length}` };
		},
		isConnected: () => true,
		async emit(event: Partial<MatrixInboundEvent> & { roomId: string; eventId: string }) {
			await adapter.callbacks.onMessage({
				roomId: event.roomId,
				sender: event.sender ?? JIM,
				eventId: event.eventId,
				timestampMs: event.timestampMs ?? Date.now(),
				content: event.content ?? { msgtype: "m.text", body: `hello ${event.eventId}` },
				isHistorical: event.isHistorical ?? false,
				isLocalEcho: event.isLocalEcho ?? false,
			});
		},
	};
	return adapter;
}

type FakeAdapter = ReturnType<typeof makeAdapter>;

async function startAgent(settingsPath: string, adapter: FakeAdapter) {
	const config = loadMatrixConfig(settingsPath);
	if (!config) throw new Error("fixture settings did not produce a Matrix config");
	const client = new MatrixBridgeClient(config, adapter as unknown as MatrixClientAdapter);
	const transport = new MatrixTransport(client);
	await client.start((msg) => transport.pushInbound(msg));
	return { config, client, transport };
}

let dir: string;
let previousToken: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "matrix-vertical-"));
	previousToken = process.env[TOKEN_ENV];
	process.env[TOKEN_ENV] = "dummy-fixture-token";
});

afterEach(() => {
	if (previousToken === undefined) delete process.env[TOKEN_ENV];
	else process.env[TOKEN_ENV] = previousToken;
	rmSync(dir, { recursive: true, force: true });
	delete process.env.PI_PANOPTICON_PARENT_ID;
});

function writeProjectSettings(agent: string, roomId: string): string {
	const agentDir = join(dir, agent);
	mkdirSync(agentDir, { recursive: true });
	const path = join(agentDir, "settings.json");
	writeFileSync(
		path,
		JSON.stringify({
			automationsProfile: { name: agent, toolWhitelist: ["read", "message_read", "message_send"] },
			"pi-matrix": {
				homeserver: `https://${HOME}`,
				userId: BOT,
				roomId,
				accessTokenEnv: TOKEN_ENV,
				trustedSenders: [JIM],
				storagePath: `~/.pi/agent/matrix-sync/${agent}`,
			},
		}),
	);
	return path;
}

describe("per-GM Matrix room vertical", () => {
	it("routes each GM's inbound and reply to its own room only", async () => {
		const gmRoom = "!gm-one:matrix.example.net";
		const otherRoom = "!gm-two:matrix.example.net";
		const adapterA = makeAdapter();
		const adapterB = makeAdapter();
		const a = await startAgent(writeProjectSettings("gm-one", gmRoom), adapterA);
		const b = await startAgent(writeProjectSettings("gm-two", otherRoom), adapterB);

		// Jim writes to both rooms; the shared account sees both events.
		await adapterA.emit({ roomId: gmRoom, eventId: "$a:1", content: { msgtype: "m.text", body: "for one" } });
		await adapterA.emit({ roomId: otherRoom, eventId: "$b:1", content: { msgtype: "m.text", body: "for two" } });
		await adapterB.emit({ roomId: otherRoom, eventId: "$b:1", content: { msgtype: "m.text", body: "for two" } });
		await adapterB.emit({ roomId: gmRoom, eventId: "$a:1", content: { msgtype: "m.text", body: "for one" } });

		expect(a.transport.receive("a").map((m) => m.text)).toEqual(["for one"]);
		expect(b.transport.receive("b").map((m) => m.text)).toEqual(["for two"]);

		const replyA = await a.transport.send({ id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" }, "gm-one", "answer one");
		const replyB = await b.transport.send({ id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" }, "gm-two", "answer two");

		expect(replyA.accepted).toBe(true);
		expect(replyB.accepted).toBe(true);
		expect(adapterA.sent).toEqual([{ roomId: gmRoom, body: "answer one" }]);
		expect(adapterB.sent).toEqual([{ roomId: otherRoom, body: "answer two" }]);
		expect(adapterA.joined).toEqual([gmRoom]);
		expect(adapterB.joined).toEqual([otherRoom]);
	});

	it("keeps a spawned helper out of the lead's room", async () => {
		const settings = writeProjectSettings("gm-one", "!gm-one:matrix.example.net");
		process.env.PI_PANOPTICON_PARENT_ID = "123-abc";
		expect(loadMatrixConfig(settings)).toBeNull();
	});

	it("ignores historical and replayed events on restart", async () => {
		const adapter = makeAdapter();
		const { transport } = await startAgent(
			writeProjectSettings("gm-one", "!gm-one:matrix.example.net"),
			adapter,
		);

		await adapter.emit({ roomId: "!gm-one:matrix.example.net", eventId: "$old:1", isHistorical: true });
		await adapter.emit({ roomId: "!gm-one:matrix.example.net", eventId: "$new:1" });
		await adapter.emit({ roomId: "!gm-one:matrix.example.net", eventId: "$new:1" });

		expect(transport.receive("gm-one").map((m) => m.id)).toEqual(["$new:1"]);
	});
});
