/**
 * Adversarial acceptance: Fleet idempotency compatibility with previous releases.
 *
 * Former defect (fixed): the pre-upgrade fingerprint used the raw caller
 * correlation_id while the new one used the trimmed value, so a receipt written
 * by the previous release with a padded correlation ("  corr  ") conflicted
 * instead of replaying. The fingerprint now uses the raw value when it carries
 * content and null when blank, while the stored payload stays trimmed.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFleetConfig, type FleetConfig } from "../../fleet-mcp/config.js";
import { FleetGateway } from "../../fleet-mcp/gateway.js";

const dirs: string[] = [];
async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "adv-fleet-compat-"));
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

describe("fleet idempotency compatibility", () => {
	it("replays a pre-upgrade receipt whose correlation was stored untrimmed", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		await alpha.send("test", b.agent_id, "padded", "k-pad", "  corr  ");

		const statePath = join(shared.root, "state-alpha", "state.json");
		const state = JSON.parse(await readFile(statePath, "utf8")) as {
			idempotency: Array<{ fingerprint: string }>;
		};
		for (const entry of state.idempotency) {
			entry.fingerprint = JSON.stringify([b.agent_id, "padded", "  corr  "]);
		}
		await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

		const restarted = await gateway(shared.config("alpha"));
		const replay = await restarted.send("test", b.agent_id, "padded", "k-pad", "  corr  ");
		expect(replay.message_id).toBeTruthy();

		// The fix must not weaken idempotency: a genuinely different request under
		// the same key still conflicts, including a whitespace-only difference.
		await expect(
			restarted.send("test", b.agent_id, "padded", "k-pad", "corr"),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			restarted.send("test", b.agent_id, "padded-2", "k-pad", "  corr  "),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("replays a pre-upgrade receipt whose correlation was the empty string", async () => {
		// Reachable because the previous release accepted `correlation_id: ""`; a
		// generated client that serialises absent optionals as "" produced these.
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		const original = await alpha.send("test", b.agent_id, "empty-corr", "k-empty", "");

		const statePath = join(shared.root, "state-alpha", "state.json");
		const state = JSON.parse(await readFile(statePath, "utf8")) as { idempotency: Array<{ fingerprint: string }> };
		for (const entry of state.idempotency) entry.fingerprint = JSON.stringify([b.agent_id, "empty-corr", ""]);
		await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

		const restarted = await gateway(shared.config("alpha"));
		const replay = await restarted.send("test", b.agent_id, "empty-corr", "k-empty", "");
		expect(replay.message_id).toBe(original.message_id);
	});

	it("still conflicts when the legacy slot differs for any reason other than \"\" vs null", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		await alpha.send("test", b.agent_id, "strict", "k-strict", "corr");

		const statePath = join(shared.root, "state-alpha", "state.json");
		const state = JSON.parse(await readFile(statePath, "utf8")) as { idempotency: Array<{ fingerprint: string }> };
		for (const entry of state.idempotency) entry.fingerprint = JSON.stringify([b.agent_id, "strict", "different"]);
		await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

		const restarted = await gateway(shared.config("alpha"));
		await expect(restarted.send("test", b.agent_id, "strict", "k-strict", "corr")).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("does not accept a legacy three-tuple for a receipt that now carries metadata", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha"));
		const beta = await gateway(shared.config("beta"));
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		await alpha.send("test", b.agent_id, "with-meta", "k-meta", "corr", "request", "001.json");

		const statePath = join(shared.root, "state-alpha", "state.json");
		const state = JSON.parse(await readFile(statePath, "utf8")) as { idempotency: Array<{ fingerprint: string }> };
		for (const entry of state.idempotency) entry.fingerprint = JSON.stringify([b.agent_id, "with-meta", "corr"]);
		await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

		const restarted = await gateway(shared.config("alpha"));
		// Length differs, so the legacy-empty tolerance must not short-circuit: a
		// replay that omits the metadata is a different request.
		await expect(
			restarted.send("test", b.agent_id, "with-meta", "k-meta", "corr", "request", "001.json"),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});
