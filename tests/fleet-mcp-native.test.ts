/** Host-native registry fixtures never touch the live Agent Hub registry. */
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
import { createMessaging } from "../extensions/pi-agent-hub/messaging/messaging.js";
import { setupExternalPeerSource } from "../extensions/pi-agent-hub/registry/external-peer-source.js";
import { listExternalAgents } from "../extensions/pi-agent-hub/registry/external-registrar.js";
import { registerChannel, unregisterChannel } from "../lib/message-transport.js";
import type { AgentRecord } from "../lib/agent-registry.js";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";
import { visibleNativePeers } from "../fleet-mcp/native-peers.js";
import { createMaildirTransport } from "../lib/transports/maildir.js";
import { makeAgentRecord, makeMockExtensionApi, asExtensionApi, makeRegistry, toolText } from "./agent-hub/helpers.js";

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
	native = makeAgentRecord({ id: "native-root", name: "internal-root", pid: process.pid, sessionFile: join(root, "session.jsonl"), kind: "pi", visibility: "global", status: "waiting" });
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

/** The gateway projects agents as an untyped payload; tests only need the ids. */
function agentIds(agents: readonly unknown[]): string[] {
	return agents.map((agent) => (agent as { readonly agent_id: string }).agent_id);
}

function sessionBinding() {
	if (!native.sessionFile) throw new Error("native sessionFile required for binding");
	return { pid: native.pid, sessionFile: native.sessionFile, cwd: native.cwd, visibility: "global" as const };
}

describe("Fleet native discovery and delivery", () => {
	it("keeps external discovery available while a native reference is missing or reloading", async () => {
		const peer = { ...native, id: "scoped-peer", sessionFile: join(root, "peer.jsonl"), visibility: "scoped" as const, parentId: "parent" };
		await saveNative(peer);
		const settings = parseFleetConfig({ ...config(), nativeSession: sessionBinding() });
		const gateway = new FleetGateway(settings);
		await gateway.init();
		const own = await gateway.register("test", "external-test");
		const before = await gateway.agents("test");
		// Native authority is denied while the reference is gone: no native peers,
		// but the external agent this process serves stays reachable.
		await rm(join(paths.registry, `${native.id}.json`));
		const denied = await gateway.agents("test");
		expect(agentIds(denied)).toEqual([own.agent_id]);
		expect((await gateway.status("test") as { native: string }).native).toBe("unavailable");
		// A same-process reload replaces the registry ID; authority is not
		// transferred to a new process, only re-resolved for this exact session.
		const reloaded = { ...native, id: "reloaded-root" };
		await saveNative(reloaded);
		const after = await gateway.agents("test");
		expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ agent_id: native.id }), expect.objectContaining({ agent_id: peer.id })]));
		expect(after).toEqual(expect.arrayContaining([expect.objectContaining({ agent_id: reloaded.id }), expect.objectContaining({ agent_id: peer.id })]));
		expect((await gateway.status("test") as { native: string }).native).toBe("available");
		// Duplicate matches fail closed: ambiguous identity denies native access
		// rather than picking one of the candidates.
		await saveNative(native);
		expect(agentIds(await gateway.agents("test"))).toEqual([own.agent_id]);
		expect((await gateway.status("test") as { native: string }).native).toBe("unavailable");
		await rm(join(paths.registry, `${native.id}.json`));
		await expect(gateway.agents("test")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ agent_id: reloaded.id }), expect.objectContaining({ agent_id: peer.id })]));
	});

	it("reports ready and degraded native status while a reference is missing", async () => {
		const settings = { ...config(), nativeSession: sessionBinding(), transport: "http" as const, bearerToken: randomBytes(24).toString("hex"), listenPort: 0 };
		const gateway = new FleetGateway(settings);
		await gateway.init();
		await gateway.register("test", "external-test");
		const server = await startHttp(settings, gateway);
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`;
		try {
			expect((await fetch(url)).status).toBe(200);
			await rm(join(paths.registry, `${native.id}.json`));
			// A stale native grant no longer takes the external service down; the
			// cause is reported through fleet_status and native peers stay denied.
			expect((await fetch(url)).status).toBe(200);
			expect((await gateway.status("test") as { native: string }).native).toBe("unavailable");
			await saveNative({ ...native, id: "after-reload" });
			expect((await fetch(url)).status).toBe(200);
			expect((await gateway.status("test") as { native: string }).native).toBe("available");
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		}
	});

	it.each([
		{ sessionFile: "/wrong/session.jsonl" }, { cwd: "/wrong/workspace" }, { pid: 2147483647 },
		{ visibility: "scoped" as const }, { visibility: undefined }, { parentId: "parent" },
		{ heartbeat: Date.now() - 60_000 }, { status: "done" as const }, { status: "terminated" as const },
	])("rejects mismatched or unavailable session references: %j", async (change) => {
		const binding = sessionBinding();
		await saveNative({ ...native, ...change });
		await expect(visibleNativePeers(undefined, binding)).rejects.toThrow("reference unavailable");
	});

	it("does not transfer authority to a same-name session", async () => {
		const binding = sessionBinding();
		await rm(join(paths.registry, `${native.id}.json`));
		await saveNative({ ...native, id: "name-collision", sessionFile: join(root, "different.jsonl") });
		await expect(visibleNativePeers(undefined, binding)).rejects.toThrow("reference unavailable");
	});

	it("validates operator bindings and rejects ambiguous or scoped configuration", () => {
		expect(() => parseFleetConfig({ ...config(native.id), nativeSession: sessionBinding() })).toThrow("Ambiguous");
		for (const change of [{ pid: undefined }, { pid: 0 }, { sessionFile: "relative" }, { cwd: "relative" }, { visibility: "scoped" }, { name: native.name }]) {
			expect(() => parseFleetConfig({ ...config(), nativeSession: { ...sessionBinding(), ...change } })).toThrow();
		}
	});
	it.each(["sdk", ...(process.env.PI_FLEET_MCP_MCPORTER_SMOKE === "1" ? ["mcporter"] : [])])("closes a %s HTTP → native tools → inbox/ack loop", async (clientKind) => {
		const settings = { ...config(), nativeSession: sessionBinding(), transport: "http" as const, bearerToken: randomBytes(24).toString("hex"), listenPort: 0 };
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
					// biome-ignore lint/suspicious/noTemplateCurlyInString: mcporter expands this from env
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

	it("persists descriptive send metadata into the Maildir envelope and inbox", async () => {
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		const external = await gateway.register("test", "outside");
		const receipt = await gateway.send("test", native.id, "synthetic request", "meta-1", "interaction-456", "request", "001.json");
		const transport = createMaildirTransport();
		expect(transport.receive(native.id)).toEqual([
			expect.objectContaining({
				id: receipt.message_id,
				from: "outside",
				senderId: external.agent_id,
				text: "synthetic request",
				type: "request",
				inReplyTo: "001.json",
				correlationId: "interaction-456",
			}),
		]);
		transport.ack(native.id, receipt.message_id);
		const externalRecord = (await listExternalAgents(config())).find((agent) => agent.id === external.agent_id);
		expect(externalRecord).toBeDefined();
		if (!externalRecord) throw new Error("externalRecord required");
		await transport.send(externalRecord, native.name, "synthetic reply", native.id, {
			type: "reply",
			inReplyTo: receipt.message_id,
			correlationId: "interaction-456",
		});
		expect(await gateway.inbox("test")).toEqual([
			expect.objectContaining({
				sender_label: native.name,
				type: "reply",
				in_reply_to: receipt.message_id,
				correlation_id: "interaction-456",
			}),
		]);
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

	it("rejects native name collisions and denies a stale reference without failing the service", async () => {
		const gateway = new FleetGateway(config(native.id));
		await gateway.init();
		await expect(gateway.register("test", native.name)).rejects.toMatchObject({ code: "CONFLICT" });
		const own = await gateway.register("test", "external-test");
		await saveNative({ ...native, heartbeat: Date.now() - 60_000 });
		// A stale reference is a denied grant, not a backend outage.
		expect(agentIds(await gateway.agents("test"))).toEqual([own.agent_id]);
		expect((await gateway.status("test") as { native: string }).native).toBe("unavailable");
		expect(await gateway.ready()).toBe(true);
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
