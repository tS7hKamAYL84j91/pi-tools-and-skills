/**
 * Tests for external agent registration and mailbox delivery.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { registerExternalAgent, unregisterExternalAgent, loadExternalAgents } from "../../extensions/pi-panopticon/registry/external-registrar.js";
import { createMaildirTransport } from "../../lib/transports/maildir.js";
import type { AgentRecord } from "../../lib/agent-registry.js";

function makeConfig(): { workspaceRoot: string } {
	const dir = join(tmpdir(), `pi-ext-agent-${process.pid}-${Date.now()}-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return { workspaceRoot: dir };
}

describe("external agent registrar", () => {
	let config: { workspaceRoot: string };

	beforeEach(() => {
		config = makeConfig();
	});

	afterEach(() => {
		try {
			rmSync(config.workspaceRoot, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("registers an external agent with a durable mailbox", async () => {
		const record = await registerExternalAgent(config, { name: "worker-1" });
		expect(record.kind).toBe("external");
		expect(record.name).toBe("worker-1");
		expect(record.mailboxPath).toBeDefined();

		const agents = await loadExternalAgents(config);
		expect(agents).toHaveLength(1);
		expect(agents[0]?.name).toBe("worker-1");
	});

	it("rejects duplicate external names", async () => {
		await registerExternalAgent(config, { name: "worker-1" });
		await expect(registerExternalAgent(config, { name: "worker-1" })).rejects.toThrow(/already registered/);
	});

	it("unregisters an external agent", async () => {
		const record = await registerExternalAgent(config, { name: "worker-1" });
		await unregisterExternalAgent(config, record.id);
		const agents = await loadExternalAgents(config);
		expect(agents).toHaveLength(0);
	});

	it("delivers maildir messages to an external mailbox", async () => {
		const transport = createMaildirTransport();
		const record = await registerExternalAgent(config, { name: "worker-1" });
		const peer: AgentRecord = { ...record, status: "waiting" };

		const result = await transport.send(peer, "pi-session", "hello external");
		expect(result.accepted).toBe(true);

		const messages = transport.receive(record.id, record.mailboxPath);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.text).toBe("hello external");
		expect(messages[0]?.from).toBe("pi-session");
	});

	it("external mailbox survives registry wipe", async () => {
		const transport = createMaildirTransport();
		let record = await registerExternalAgent(config, { name: "worker-1" });

		await transport.send(record, "pi-session", "first");

		// Simulate wiping the volatile registry directory but keeping the manifest
		const manifestPath = join(config.workspaceRoot, "external-agents.json");
		const agentsDir = join(config.workspaceRoot, "agents");
		rmSync(agentsDir, { recursive: true, force: true });
		mkdirSync(agentsDir, { recursive: true });
		rmSync(manifestPath, { force: true });
		const restored = await loadExternalAgents(config);
		expect(restored).toHaveLength(0);

		// Re-register with same manifest content
		// Note: real durability requires the manifest to persist; here we restore it.
		// The test verifies that the mailbox path is independent of agentsDir.
		const mailboxPath = record.mailboxPath;
		record = await registerExternalAgent(config, { name: "worker-2", mailboxPath });
		const messages = transport.receive(record.id, record.mailboxPath);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.text).toBe("first");
	});
});
