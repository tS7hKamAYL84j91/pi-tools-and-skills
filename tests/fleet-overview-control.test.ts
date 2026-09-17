/** Tests for the gated control port: spec resolution, preview tokens, audit, API.

 * The make runner is faked throughout — these tests never touch the coas repo
 * and never issue APPLY outside control.execute on a confirmed token.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type Control,
	ControlError,
	createControl,
	type MakeRunner,
	PREVIEW_TTL_SECONDS,
} from "../fleet-overview/control.js";
import { createApp } from "../fleet-overview/server.js";

const dirs: string[] = [];

function fakeRunner(): {
	calls: string[][];
	state: { exitCode: number; output: string };
	run: MakeRunner;
} {
	const calls: string[][] = [];
	const state = { exitCode: 0, output: "fake output" };
	const run: MakeRunner = async (args) => {
		calls.push(args);
		return { output: state.output, exitCode: state.exitCode, error: "" };
	};
	return { calls, state, run };
}

async function makeControl(
	run: MakeRunner,
	now?: () => number,
): Promise<{ control: Control; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "fleet-overview-control-"));
	dirs.push(dir);
	return {
		control: createControl({
			coasDir: "/nonexistent",
			controlDir: dir,
			runner: run,
			now,
		}),
		dir,
	};
}

afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});

function requestIdOf(response: Record<string, unknown>): string {
	const id = response.requestId;
	if (typeof id !== "string" || !id) throw new Error("missing requestId");
	return id;
}

describe("gated control", () => {
	it("preview issues a token and never applies", async () => {
		const { calls, run } = fakeRunner();
		const { control } = await makeControl(run);
		const resp = await control.preview("standup", "titanic-gm");
		expect(resp.ok).toBe(true);
		expect(typeof requestIdOf(resp)).toBe("string");
		expect(resp.action).toBe("standup");
		expect(resp.key).toBe("titanic-gm");
		expect(resp.exitCode).toBe(0);
		const args = calls[0];
		if (!args) throw new Error("runner not called");
		expect(args[0]).toBe("eo-agent-add");
		expect(args).toContain("DRY_RUN=1");
		expect(args).not.toContain("APPLY=1");
		expect(
			args.some((a) => a.startsWith("NAME=kaggle-spaceship-titanic-gm")),
		).toBe(true);
		expect(args.some((a) => a.startsWith("DEFAULT_MODEL="))).toBe(true);
	});

	it("preview failure issues no token", async () => {
		const { state, run } = fakeRunner();
		const { control } = await makeControl(run);
		state.exitCode = 2;
		state.output = "policy blocked";
		const resp = await control.preview("standdown", "gravitas");
		expect(resp.ok).toBe(false);
		expect("requestId" in resp).toBe(false);
	});

	it("rejects unknown action or key without touching the runner", async () => {
		const { calls, run } = fakeRunner();
		const { control } = await makeControl(run);
		await expect(control.preview("explode", "gravitas")).rejects.toThrow(
			ControlError,
		);
		await expect(control.preview("standdown", "nope")).rejects.toThrow(
			ControlError,
		);
		await expect(control.preview("standup", "gravitas")).rejects.toThrow(
			ControlError, // live agents have no stand-up spec
		);
		await expect(control.preview("standdown", "titanic-gm")).rejects.toThrow(
			ControlError, // historical has no stand-down target
		);
		expect(calls).toEqual([]);
	});

	it("execute runs APPLY once and audits", async () => {
		const { calls, run } = fakeRunner();
		const { control } = await makeControl(run);
		const token = requestIdOf(await control.preview("standdown", "gravitas"));
		const resp = await control.execute(token, "standdown", "gravitas");
		expect(resp.ok).toBe(true);
		expect(resp.audited).toBe(true);
		const applyArgs = calls[1];
		if (!applyArgs) throw new Error("apply not run");
		expect(applyArgs[0]).toBe("eo-agent-remove");
		expect(applyArgs).toContain("APPLY=1");
		expect(applyArgs).not.toContain("DRY_RUN=1");
		// single-use: a second attempt is refused
		await expect(
			control.execute(token, "standdown", "gravitas"),
		).rejects.toThrow(ControlError);
		const state = await control.controlState();
		expect(state.log).toHaveLength(1);
		const entry = state.log[0];
		if (!entry) throw new Error("missing audit entry");
		expect(entry.action).toBe("standdown");
		expect(entry.key).toBe("gravitas");
		expect(entry.manifest).toBe("gravitas");
		expect(entry.requestId).toBe(token);
		expect(entry.exitCode).toBe(0);
	});

	it("token mismatch does not consume the token", async () => {
		const { run } = fakeRunner();
		const clock = 1_000_000;
		const { control } = await makeControl(run, () => clock);
		const token = requestIdOf(await control.preview("standup", "titanic-gm"));
		await expect(
			control.execute(token, "standdown", "gravitas"),
		).rejects.toThrow(ControlError);
		// still valid with the matching binding
		const resp = await control.execute(token, "standup", "titanic-gm");
		expect(resp.ok).toBe(true);
	});

	it("expired tokens are consumed and refused", async () => {
		const { run } = fakeRunner();
		let clock = 1_000_000;
		const { control } = await makeControl(run, () => clock);
		const token = requestIdOf(await control.preview("standup", "titanic-gm"));
		clock += PREVIEW_TTL_SECONDS + 1;
		await expect(
			control.execute(token, "standup", "titanic-gm"),
		).rejects.toThrow("preview expired — run the preview again");
		// the expired token is gone
		await expect(
			control.execute(token, "standup", "titanic-gm"),
		).rejects.toThrow("unknown or already-used preview");
	});

	it("execute without a token is rejected", async () => {
		const { calls, run } = fakeRunner();
		const { control } = await makeControl(run);
		await expect(
			control.execute("missing", "standdown", "gravitas"),
		).rejects.toThrow(ControlError);
		expect(calls).toEqual([]);
	});

	it("control log is newest-first and skips corruption", async () => {
		const { run } = fakeRunner();
		const { control, dir } = await makeControl(run);
		const lines = [
			JSON.stringify({
				ts: "2026-09-17T10:00:00Z",
				action: "standdown",
				key: "a",
			}),
			JSON.stringify({
				ts: "2026-09-17T11:00:00Z",
				action: "standup",
				key: "b",
			}),
			"{corrupt line",
		].join("\n");
		await writeFile(join(dir, "audit.jsonl"), `${lines}\n`);
		const state = await control.controlState();
		expect(state.log.map((e) => e.key)).toEqual(["b", "a"]);
	});

	it("control state exposes the full controllable set", async () => {
		const { run } = fakeRunner();
		const { control } = await makeControl(run);
		const state = await control.controlState();
		const byKey = new Map(state.specs.map((s) => [s.key, s]));
		expect(byKey.has("gravitas")).toBe(true);
		expect(byKey.has("coas")).toBe(true);
		expect(byKey.has("pi-tools-and-skills")).toBe(true);
		expect(byKey.has("casmi-gm")).toBe(true);
		expect(byKey.has("eo-fleet-overview")).toBe(true);
		const titanic = byKey.get("titanic-gm");
		expect(titanic?.action).toBe("standup");
		expect(titanic?.state).toBe("stood down");
		expect(titanic?.note).toContain("startupPrompt");
		const gravitas = byKey.get("gravitas");
		expect(gravitas?.action).toBe("standdown");
		expect(gravitas?.manifest).toBe("gravitas");
		const self = byKey.get("eo-fleet-overview");
		expect(self?.manifest).toBe("eo-fleet-overview-gm");
	});
});

describe("control API", () => {
	it("preview and execute round-trip through HTTP", async () => {
		const { run } = fakeRunner();
		const { control } = await makeControl(run);
		const app = createApp({ control });
		const server = createHttpServer((req, res) => {
			void app(req, res).catch(() => {
				res.end("internal error");
			});
		});
		try {
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", () => resolve()),
			);
			const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			const post = async (path: string, payload: unknown) =>
				await fetch(`${base}${path}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				});
			const health = await (await fetch(`${base}/api/health`)).json();
			expect(health).toEqual({ ok: true });
			const preview = await post("/api/control/preview", {
				action: "standup",
				key: "titanic-gm",
			});
			expect(preview.status).toBe(200);
			const previewData = (await preview.json()) as {
				ok: boolean;
				requestId: string;
			};
			expect(previewData.ok).toBe(true);
			const before = (await (await fetch(`${base}/api/control`)).json()) as {
				log: unknown[];
			};
			expect(before.log).toEqual([]);
			const execute = await post("/api/control/execute", {
				requestId: previewData.requestId,
				action: "standup",
				key: "titanic-gm",
			});
			expect(execute.status).toBe(200);
			const executeData = (await execute.json()) as {
				ok: boolean;
				audited: boolean;
			};
			expect(executeData.ok).toBe(true);
			expect(executeData.audited).toBe(true);
			const after = (await (await fetch(`${base}/api/control`)).json()) as {
				log: { key: string }[];
			};
			expect(after.log).toHaveLength(1);
			expect(after.log[0]?.key).toBe("titanic-gm");
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("rejects unknown control requests with 400", async () => {
		const { run } = fakeRunner();
		const { control } = await makeControl(run);
		const app = createApp({ control });
		const server = createHttpServer((req, res) => {
			void app(req, res).catch(() => {
				res.end("internal error");
			});
		});
		try {
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", () => resolve()),
			);
			const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			const bad = await fetch(`${base}/api/control/preview`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "explode", key: "gravitas" }),
			});
			expect(bad.status).toBe(400);
			expect(await bad.json()).toMatchObject({ ok: false });
			const noToken = await fetch(`${base}/api/control/execute`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					requestId: "nope",
					action: "standdown",
					key: "gravitas",
				}),
			});
			expect(noToken.status).toBe(400);
			expect(await noToken.json()).toMatchObject({ ok: false });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
