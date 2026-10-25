/**
 * Adversarial acceptance: Fleet MCP send metadata + idempotency compatibility.
 * Real filesystem and real Maildir; no mocks.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFleetConfig, type FleetConfig } from "../../fleet-mcp/config.js";
import { FleetGateway } from "../../fleet-mcp/gateway.js";
import { createMaildirTransport } from "../../lib/transports/maildir.js";

const dirs: string[] = [];

async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "adv-fleet-"));
	dirs.push(root);
	return {
		root,
		config(principal: string): FleetConfig {
			return parseFleetConfig({
				workspaceAlias: "test",
				workspaceRoot: join(root, "workspace"),
				mailboxRoot: join(root, "mail"),
				stateDir: join(root, `state-${principal}`),
				transport: "stdio",
				principal,
			});
		},
	};
}

async function gateway(config: FleetConfig): Promise<FleetGateway> {
	const fleet = new FleetGateway(config);
	await fleet.init();
	return fleet;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("fleet metadata acceptance", () => {
	it("persists metadata into the recipient's external mailbox", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");

		const receipt = await alpha.send("test", b.agent_id, "hi", "k-ext", "corr-1", "notification", "001.json");
		const [message] = createMaildirTransport().receive(b.agent_id, join(shared.root, "mail", b.agent_id, "inbox"));

		expect(message).toMatchObject({
			id: receipt.message_id,
			from: "alpha",
			type: "notification",
			inReplyTo: "001.json",
			correlationId: "corr-1",
		});
	});

	it("treats a metadata-only change under one idempotency key as a conflict", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");

		await alpha.send("test", b.agent_id, "hello", "k1", "corr", "request", "001.json");
		await expect(
			alpha.send("test", b.agent_id, "hello", "k1", "corr", "reply", "001.json"),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("replays a pre-upgrade receipt stored with the legacy three-tuple fingerprint", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		const original = await alpha.send("test", b.agent_id, "legacy text", "k-legacy", "corr-legacy");

		// Rewrite the fingerprint to exactly what the pre-metadata release wrote.
		const statePath = join(shared.root, "state-alpha", "state.json");
		const state = JSON.parse(await readFile(statePath, "utf8")) as {
			idempotency: Array<{ fingerprint: string }>;
		};
		for (const entry of state.idempotency) {
			entry.fingerprint = JSON.stringify([b.agent_id, "legacy text", "corr-legacy"]);
		}
		await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

		const restarted = await gateway(shared.config("alpha"));
		const replay = await restarted.send("test", b.agent_id, "legacy text", "k-legacy", "corr-legacy");
		expect(replay.message_id).toBe(original.message_id);
	});
});
