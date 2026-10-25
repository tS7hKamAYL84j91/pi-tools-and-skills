/**
 * Idempotency fingerprints must use the raw caller-supplied correlation.
 *
 * Released receipts were fingerprinted with the raw string. The uncommitted
 * metadata work trimmed it first, so a receipt written by the previous release
 * with a padded value (`"  corr  "`) would CONFLICT instead of replaying. The
 * stored payload stays trimmed; only the fingerprint keeps the raw value.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseFleetConfig, type FleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";

const dirs: string[] = [];

async function workspace(): Promise<{ config(principal: string): FleetConfig }> {
	const root = await mkdtemp(join(tmpdir(), "fleet-raw-corr-"));
	dirs.push(root);
	return {
		config(principal: string) {
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
	const result = new FleetGateway(config);
	await result.init();
	return result;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("fleet idempotency fingerprint correlation", () => {
	it("replays a padded correlation and keeps the stored payload trimmed", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha-client"));
		const beta = await gateway(shared.config("beta-client"));
		await alpha.register("test", "alpha");
		const receiver = await beta.register("test", "beta");

		const first = await alpha.send("test", receiver.agent_id, "padded", "k-raw", "  corr  ");
		expect(first.correlation_id).toBe("corr");

		// Same raw request replays even though the stored value is trimmed.
		const replay = await alpha.send("test", receiver.agent_id, "padded", "k-raw", "  corr  ");
		expect(replay.message_id).toBe(first.message_id);

		// A different raw request under the same key is a conflict, not a replay:
		// proving the fingerprint kept the raw value. A trimmed fingerprint would
		// have treated "corr" as the same request.
		await expect(
			alpha.send("test", receiver.agent_id, "padded", "k-raw", "corr"),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("replays a legacy receipt whose empty correlation was stored as \"\"", async () => {
		const shared = await workspace();
		const alphaConfig = shared.config("alpha-client");
		const alpha = await gateway(alphaConfig);
		const beta = await gateway(shared.config("beta-client"));
		await alpha.register("test", "alpha");
		const receiver = await beta.register("test", "beta");

		const first = await alpha.send("test", receiver.agent_id, "legacy-empty", "k-empty");
		expect(first.correlation_id).toBeUndefined();

		// Rewrite the persisted fingerprint to the previous release's shape: the
		// empty string rather than null (its schema allowed "").
		const statePath = join(alphaConfig.stateDir, "state.json");
		const disk = JSON.parse(await readFile(statePath, "utf8")) as {
			idempotency: Array<{ principalKey: string; fingerprint: string; receipt: unknown }>;
		};
		const entry = disk.idempotency.find((candidate) => candidate.fingerprint === JSON.stringify([receiver.agent_id, "legacy-empty", null]));
		if (entry === undefined) throw new Error("expected the idempotency entry to be persisted");
		entry.fingerprint = JSON.stringify([receiver.agent_id, "legacy-empty", ""]);
		await writeFile(statePath, JSON.stringify(disk), "utf8");

		// A fresh gateway reads that legacy receipt: a blank replay must match.
		const restarted = await gateway(alphaConfig);
		const replay = await restarted.send("test", receiver.agent_id, "legacy-empty", "k-empty", "");
		expect(replay.message_id).toBe(first.message_id);

		// The compatibility branch must not weaken idempotency for real changes.
		await expect(
			restarted.send("test", receiver.agent_id, "different text", "k-empty", ""),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("keeps blank and absent correlations the same request", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha-client"));
		const beta = await gateway(shared.config("beta-client"));
		await alpha.register("test", "alpha");
		const receiver = await beta.register("test", "beta");

		const absent = await alpha.send("test", receiver.agent_id, "blank", "k-blank");
		const blank = await alpha.send("test", receiver.agent_id, "blank", "k-blank", "   ");
		expect(blank.message_id).toBe(absent.message_id);
		expect(blank.correlation_id).toBeUndefined();
	});
});