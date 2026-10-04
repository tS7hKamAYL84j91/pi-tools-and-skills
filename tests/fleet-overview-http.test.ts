import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp, MAX_REQUEST_BYTES, readRequestBody } from "../fleet-overview/server.js";
import { createDirectiveStore } from "../fleet-overview/directives.js";

async function* chunks(...values: Uint8Array[]) { yield* values; }
async function withApp(app: ReturnType<typeof createApp>, test: (url: string) => Promise<void>) {
	const server = createServer((req, res) => { void app(req, res).catch(() => { res.writeHead(500); res.end(); }); });
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
	finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe("overview HTTP snapshots and input", () => {
	it("admits exact byte limits, rejects excess and decodes split multibyte text", async () => {
		expect((await readRequestBody(chunks(Buffer.alloc(MAX_REQUEST_BYTES)))).length).toBe(MAX_REQUEST_BYTES);
		await expect(readRequestBody(chunks(Buffer.alloc(MAX_REQUEST_BYTES), Buffer.from("x")))).rejects.toThrow("request too large");
		const unicode = Buffer.from("é🙂");
		expect(await readRequestBody(chunks(unicode.subarray(0, 1), unicode.subarray(1, 4), unicode.subarray(4)))).toBe("é🙂");
		await expect(readRequestBody(chunks(Buffer.from("é".repeat(MAX_REQUEST_BYTES / 2 + 1))))).rejects.toThrow();
	});
	it("shares in-flight Fleet, Usage and Ledger snapshots across endpoints and Brief", async () => {
		const fleet = vi.fn(async () => ({ updatedAt: "fixture", agents: [] }));
		const usage = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20)); return {}; });
		const ledger = vi.fn(async () => []);
		const events = vi.fn(async (_options, snapshot) => { expect(snapshot).toEqual([]); return []; });
		const brief = vi.fn(async () => ({ generatedAt: "fixture", awaiting: [], lines: [] }));
		await withApp(createApp({ data: { fleet, usage, ledger, events, brief } }), async url => {
			const paths = ["fleet", "usage", "usage", "events", "brief"];
			expect((await Promise.all(paths.map(path => fetch(`${url}/api/${path}`)))).every(r => r.ok)).toBe(true);
		});
		expect(fleet).toHaveBeenCalledTimes(1);
		expect(usage).toHaveBeenCalledTimes(1);
		expect(ledger).toHaveBeenCalledTimes(1);
		expect(brief).toHaveBeenCalledTimes(1);
	});
	it("clears failed pending reads so the next request retries", async () => {
		const fleet = vi.fn().mockRejectedValueOnce(new Error("fixture failure")).mockResolvedValue({ updatedAt: "fixture", agents: [] });
		await withApp(createApp({ data: { fleet } }), async url => {
			expect((await fetch(`${url}/api/fleet`)).status).toBe(500);
			expect((await fetch(`${url}/api/fleet`)).status).toBe(200);
		});
		expect(fleet).toHaveBeenCalledTimes(2);
	});
	it("handles methods and malformed JSON without storing a directive", async () => {
		const root = await mkdtemp(join(tmpdir(), "overview-directives-"));
		const directives = createDirectiveStore(root);
		try {
			await withApp(createApp({ directives }), async url => {
				expect((await fetch(`${url}/api/fleet`, { method: "POST" })).status).toBe(405);
				expect((await fetch(`${url}/api/directives`, { method: "DELETE" })).status).toBe(405);
				expect((await fetch(`${url}/api/directives`, { method: "POST", body: "{" })).status).toBe(400);
				expect((await directives.read()).inbox).toEqual([]);
				const resp = await fetch(`${url}/api/directives`, { method: "POST", body: JSON.stringify({ text: "fixture é🙂" }) });
				expect(resp.status).toBe(200);
				expect((await directives.read()).inbox[0]?.text).toBe("fixture é🙂");
			});
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
