/** Host-native registry fixtures never touch the live Panopticon registry. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { startHttp } from "../fleet-mcp/server.js";
import { createMessaging } from "../extensions/pi-panopticon/messaging/messaging.js";
import { setupExternalPeerSource } from "../extensions/pi-panopticon/registry/external-peer-source.js";
import { registerChannel, unregisterChannel } from "../lib/message-transport.js";
import type { AgentRecord } from "../lib/agent-registry.js";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";
import { visibleNativePeers } from "../fleet-mcp/native-peers.js";
import { createMaildirTransport } from "../lib/transports/maildir.js";
import { makeAgentRecord, makeMockExtensionApi, asExtensionApi, makeRegistry, toolText } from "./panopticon/helpers.js";

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../lib/agent-registry.js", async (original) => ({
	...await original<typeof import("../lib/agent-registry.js")>(),
	get REGISTRY_DIR() { return paths.registry; },
	ensureRegistryDir: () => mkdirSync(paths.registry, { recursive: true, mode: 0o700 }),
}));
let root: string;
let native: ReturnType<typeof makeAgentRecord>;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fleet-native-"));
	paths.registry = join(root, "agents");
	await mkdir(paths.registry, { mode: 0o700 });
	native = makeAgentRecord({ id: "native-root", name: "internal-root", pid: process.pid, kind: "pi", visibility: "global", status: "waiting" });
	await saveNative(native);
	createMaildirTransport().init(native.id);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function saveNative(record: ReturnType<typeof makeAgentRecord>) {
	await writeFile(join(paths.registry, `${record.id}.json`), JSON.stringify(record), { mode: 0o600 });
}
function config(nativeAgentId?: string) {
	return parseFleetConfig({ workspaceAlias: "test", workspaceRoot: join(root, "workspace"), mailboxRoot: join(root, "mail"), stateDir: join(root, "state"), principal: "external-test", ...(nativeAgentId ? { nativeAgentId } : {}) });
}

describe("Fleet native discovery and delivery", () => {
	it.each(["sdk", ...(process.env.PI_FLEET_MCP_MCPORTER_SMOKE === "1" ? ["mcporter"] : [])])("closes a %s HTTP → native tools → inbox/ack loop", async (clientKind) => {
		const settings = { ...config(native.id), transport: "http" as const, bearerToken: randomBytes(24).toString("hex"), listenPort: 0 };
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_WORKSPACE_ROOT", settings.workspaceRoot);
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_MAILBOX_ROOT", settings.mailboxRoot);
		const gateway = new FleetGateway(settings);
		await gateway.init();
		const server = await startHttp(settings, gateway);
		const client = new Client({ name: "outside", version: "1.0.0" });
		const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
		const mcporterConfig = join(root, "mcporter.json");
		await writeFile(mcporterConfig, JSON.stringify({ mcpServers: {}, imports: [] }), { mode: 0o600 });
		const api = makeMockExtensionApi();
		const registry = makeRegistry(native);
		let externalPeers: AgentRecord[] = [];
		vi.mocked(registry.setExternalPeers).mockImplementation((records) => { externalPeers = records; });
		vi.mocked(registry.readAllPeers).mockImplementation(() => [native, ...externalPeers]);
		const source = setupExternalPeerSource(asExtensionApi(api), registry);
		await source.refresh("/a-different-native-project");
		const transport = createMaildirTransport();
		registerChannel("agent", transport);
		const messaging = createMessaging({ send: transport, broadcast: transport })(asExtensionApi(api), registry);
		const beforeTool = api.eventHandlers.get("tool_call")?.[0] as unknown as (event: { toolName: string }, ctx: { cwd: string }) => Promise<void>;
		async function nativeCall(name: string, args: Record<string, unknown> = {}) {
			await beforeTool({ toolName: name }, { cwd: "/a-different-native-project" });
			const tool = api.registeredTools.get(name);
			if (!tool) throw new Error("native tool missing");
			return tool.execute("test", args, new AbortController().signal);
		}
		async function call(name: string, args: Record<string, unknown> = {}) {
			if (clientKind === "mcporter") {
				await saveNative({ ...native, heartbeat: Date.now() });
				let stdout: string;
				try {
					({ stdout } = await promisify(execFile)("npx", ["--yes", "mcporter@0.13.10", "--config", mcporterConfig, "--log-level", "error", "call", "--http-url", url.href, "--allow-http", "--header", "Authorization=Bearer ${FLEET_MCP_TEST_TOKEN}", "--tool", name, "--args", JSON.stringify({ workspace: "test", ...args }), "--output", "json", "--no-oauth"], {
						cwd: root, env: { ...process.env, FLEET_MCP_TEST_TOKEN: settings.bearerToken }, timeout: 30_000, maxBuffer: 65_536,
					}));
				} catch { throw new Error(`mcporter ${name} failed; process output withheld`); }
				return (JSON.parse(stdout) as { result: unknown }).result;
			}
			const response = CallToolResultSchema.parse(await client.callTool({ name, arguments: { workspace: "test", ...args } }));
			expect(response.isError).not.toBe(true);
			return response.structuredContent?.result;
		}
		try {
			if (clientKind === "sdk") await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${settings.bearerToken}` } } }));
			const registered = await call("fleet_register_external", { display_name: "outside" }) as { agent_id: string };
			expect(await call("fleet_agents")).toEqual(expect.arrayContaining([expect.objectContaining({ agent_id: native.id })]));
			await call("fleet_send", { recipient_id: native.id, text: "synthetic request", idempotency_key: "request" });
			expect(toolText(await nativeCall("message_read"))).toContain("synthetic request");
			expect(toolText(await nativeCall("agent_send", { name: "outside", message: "synthetic reply" }))).toContain("Sent to outside");
			const inbox = await call("fleet_inbox") as Array<{ message_id: string }>;
			expect(inbox).toEqual([expect.objectContaining({ sender_id: native.id, sender_label: native.name, text: "synthetic reply" })]);
			expect(await call("fleet_inbox")).toEqual(inbox);
			await call("fleet_ack", { message_ids: inbox.map((message) => message.message_id) });
			expect(await call("fleet_inbox")).toEqual([]);
			const broadcast = await call("fleet_broadcast", { text: "external broadcast", idempotency_key: "batch" });
			expect(broadcast).toMatchObject({ state: "complete", targets: [native.id] });
			expect(toolText(await nativeCall("message_read"))).toContain("external broadcast");
			await nativeCall("agent_broadcast", { message: "native broadcast" });
			expect(await call("fleet_inbox")).toEqual([expect.objectContaining({ sender_id: native.id, text: "native broadcast" })]);
			await call("fleet_unregister_external", { agent_id: registered.agent_id });
			expect(toolText(await nativeCall("agent_send", { name: "outside", message: "must not send" }))).toContain("No agent named");
			expect(externalPeers).toEqual([]);
		} finally {
			messaging.dispose();
			unregisterChannel("agent");
			await client.close();
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		}
	}, 120_000);

	it("defaults to no native access, then sends and receives through real host Maildirs with an explicit reference", async () => {
		const denied = new FleetGateway(config());
		await denied.init();
		expect(await denied.agents("test")).toEqual([]);
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		const external = await gateway.register("test", "outside");
		expect(await gateway.agents("test")).toEqual(expect.arrayContaining([expect.objectContaining({ agent_id: native.id, kind: "pi" })]));
		const receipt = await gateway.send("test", native.id, "synthetic request", "request-1");
		const transport = createMaildirTransport();
		expect(transport.receive(native.id)).toEqual([expect.objectContaining({ id: receipt.message_id, from: "outside", senderId: external.agent_id, text: "synthetic request" })]);
		transport.ack(native.id, receipt.message_id);
		expect(transport.receive(native.id)).toEqual([]);
		await expect(gateway.register("test", "outside")).resolves.toEqual(external);
	});

	it("preserves requester-based canSee scope and never uses undefined as a visibility context", async () => {
		await saveNative({ ...native, visibility: "scoped", parentId: "parent" });
		const hidden = { ...native, id: "hidden", name: "hidden", visibility: "global" as const };
		const sibling = { ...native, id: "sibling", name: "sibling", parentId: "parent", visibility: "scoped" as const };
		await saveNative(hidden);
		await saveNative(sibling);
		expect((await visibleNativePeers(native.id)).map((record) => record.id).sort()).toEqual([native.id, sibling.id].sort());
		await expect(visibleNativePeers("missing")).rejects.toThrow("reference unavailable");
	});

	it("denies delivery to a native peer outside the reference scope", async () => {
		await saveNative({ ...native, visibility: "scoped", parentId: "parent" });
		const hidden = { ...native, id: "hidden", name: "hidden" };
		await saveNative(hidden);
		const transport = createMaildirTransport();
		transport.init(hidden.id);
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		await gateway.register("test", "outside");
		await expect(gateway.send("test", hidden.id, "must not deliver", "hidden")).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(transport.receive(hidden.id)).toEqual([]);
	});

	it("preserves native-to-native Maildir delivery and optional legacy sender labels", async () => {
		const peer = { ...native, id: "native-peer", name: "native-peer" };
		await saveNative(peer);
		const transport = createMaildirTransport();
		transport.init(peer.id);
		await transport.send(peer, native.name, "native message", native.id);
		expect(transport.receive(peer.id)).toEqual([expect.objectContaining({ from: native.name, senderId: native.id, text: "native message" })]);
		await transport.send(native, peer.name, "legacy reply");
		expect(transport.receive(native.id)).toEqual([expect.objectContaining({ from: peer.name, text: "legacy reply" })]);
		expect(transport.receive(native.id)[0]).not.toHaveProperty("senderId");
	});

	it("rejects stale references and native name collisions", async () => {
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		await expect(gateway.register("test", native.name)).rejects.toMatchObject({ code: "CONFLICT" });
		await saveNative({ ...native, heartbeat: Date.now() - 60_000 });
		await expect(gateway.agents("test")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
	});

	it("ignores corrupt, forged and symlinked records without modifying them", async () => {
		const corrupt = join(paths.registry, "corrupt.json");
		await writeFile(corrupt, "not-json", { mode: 0o600 });
		await writeFile(join(paths.registry, "forged.json"), JSON.stringify({ ...native, id: "../escape" }), { mode: 0o600 });
		await symlink(join(paths.registry, `${native.id}.json`), join(paths.registry, "linked.json"));
		expect((await visibleNativePeers(native.id)).map((record) => record.id)).toEqual([native.id]);
		expect(await readFile(corrupt, "utf8")).toBe("not-json");
	});

	it("does not recreate a missing native inbox", async () => {
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		await gateway.register("test", "outside");
		await rm(join(paths.registry, native.id), { recursive: true });
		await expect(gateway.send("test", native.id, "synthetic", "missing-inbox")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
		await expect(readFile(join(paths.registry, native.id, "inbox", "new"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
