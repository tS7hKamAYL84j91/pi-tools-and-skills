import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type AgentRecord, isPidAlive, REGISTRY_DIR } from "../lib/agent-registry.js";
import { boardProjection } from "./board.js";
import { FLEET_HOME } from "./config.js";
import { AuditWriteError, type Control, ControlError, createControl } from "./control.js";
import { createDirectiveStore } from "./directives.js";
import { allEvents, brief, ledgerEvents, schedules } from "./events.js";
import { collectUsage } from "./usage.js";

const STATIC = join(FLEET_HOME, "static");
export const MAX_REQUEST_BYTES = 100_000;
function now(): string { return new Date().toISOString().replace(".000Z", "Z"); }
function json(res: ServerResponse, value: unknown, status = 200): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}
/** Decode only after byte admission, including split multibyte sequences. */
export async function readRequestBody(req: AsyncIterable<Uint8Array>): Promise<string> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of req) {
		bytes += chunk.byteLength;
		if (bytes > MAX_REQUEST_BYTES) throw new Error("request too large");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks, bytes).toString("utf8");
}
interface FleetAgent {
	readonly key: string;
	readonly display: string;
	readonly model: string;
	readonly status: string;
	readonly detail: string;
	readonly role: string;
	readonly lastActivity: string;
}
async function fleet(): Promise<{ updatedAt: string; agents: FleetAgent[] }> {
	let names: string[] = [];
	try { names = (await readdir(REGISTRY_DIR)).filter(n => n.endsWith(".json")); } catch { /* no registry */ }
	const agents: FleetAgent[] = [];
	for (const name of names) {
		try {
			const record = JSON.parse(await readFile(join(REGISTRY_DIR, name), "utf8")) as AgentRecord;
			agents.push({ key: record.name, display: record.name, model: record.model, status: isPidAlive(record.pid) ? record.status : "down", detail: record.task || "", role: record.kind || "agent", lastActivity: new Date(record.heartbeat).toISOString() });
		} catch { /* best effort observational read, never reap records */ }
	}
	return { updatedAt: now(), agents };
}
export interface FleetOverviewDeps {
	readonly control?: Control;
	readonly directives?: ReturnType<typeof createDirectiveStore>;
	readonly data?: Partial<{
		fleet: typeof fleet;
		usage: typeof collectUsage;
		ledger: typeof ledgerEvents;
		events: typeof allEvents;
		board: typeof boardProjection;
		schedules: typeof schedules;
		brief: typeof brief;
	}>;
}

/** Build the small explicit request handler; tests inject offline providers. */
export function createApp(deps: FleetOverviewDeps = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	const control = deps.control ?? createControl();
	const directives = deps.directives ?? createDirectiveStore();
	const data = { fleet, usage: collectUsage, ledger: ledgerEvents, events: allEvents, board: boardProjection, schedules, brief, ...deps.data };
	// Existing TTLs and browser refresh cadence remain unchanged.
	const TTL: Readonly<Record<string, number>> = { fleet: 20, usage: 300, "usage-view": 300, events: 60, ledger: 60, board: 60, sched: 300, brief: 60 };
	const memo = new Map<string, { at: number; value: unknown }>();
	const pending = new Map<string, Promise<unknown>>();
	async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const hit = memo.get(key);
		if (hit && Date.now() - hit.at < (TTL[key] ?? 60) * 1000) return hit.value as T;
		const active = pending.get(key);
		if (active) return active as Promise<T>;
		const work = Promise.resolve().then(fn).then(value => {
			memo.set(key, { at: Date.now(), value });
			return value;
		}).finally(() => pending.delete(key));
		pending.set(key, work);
		return work;
	}
	const usageSnapshot = () => cached("usage", () => data.usage());
	const ledgerSnapshot = () => cached("ledger", () => data.ledger({}));
	async function buildUsage() {
		const agg = await usageSnapshot();
		const agents = Object.fromEntries(Object.entries(agg).map(([key, a]) => [key, {
			days: Object.fromEntries(Object.keys(a.days).sort().map(day => [day, a.days[day]])),
			lastTs: a.lastTs, firstTs: a.firstTs, sessions: a.sessions,
		}]));
		return { updatedAt: now(), agents };
	}
	async function buildBrief() {
		const [snapshot, usage, ledger] = await Promise.all([cached("fleet", data.fleet), usageSnapshot(), ledgerSnapshot()]);
		return data.brief(snapshot, usage, ledger);
	}
	return async (req, res) => {
		const path = new URL(req.url || "/", "http://localhost").pathname.replace(/^\/fleet/, "") || "/";
		if (path === "/" && req.method === "GET") { res.end(await readFile(join(STATIC, "index.html"))); return; }
		const readPaths = ["/api/health", "/api/fleet", "/api/usage", "/api/events", "/api/board", "/api/schedules", "/api/brief"];
		if (readPaths.includes(path) && req.method !== "GET") return json(res, { ok: false, error: "method not allowed" }, 405);
		if (path === "/api/health") return json(res, { ok: true });
		if (path === "/api/fleet") return json(res, await cached("fleet", data.fleet));
		if (path === "/api/usage") return json(res, await cached("usage-view", buildUsage));
		if (path === "/api/events") return json(res, await cached("events", async () => ({ updatedAt: now(), events: await data.events({}, await ledgerSnapshot()) })));
		if (path === "/api/board") return json(res, await cached("board", async () => ({ projection: await data.board() })));
		if (path === "/api/schedules") return json(res, await cached("sched", async () => ({ schedules: await data.schedules({}) })));
		if (path === "/api/brief") return json(res, await cached("brief", buildBrief));
		if (path === "/api/directives" && req.method === "GET") return json(res, await directives.read());
		if (path === "/api/directives" && req.method === "POST") {
			try {
				const payload = JSON.parse(await readRequestBody(req)) as { text?: unknown };
				return json(res, { ok: true, directive: await directives.send(payload.text) });
			} catch (error) { return json(res, { ok: false, error: error instanceof Error ? error.message : "invalid directive" }, 400); }
		}
		if (path === "/api/control" && req.method === "GET") return json(res, await control.controlState());
		if ((path === "/api/control/preview" || path === "/api/control/execute") && req.method === "POST") {
			try {
				const payload = JSON.parse(await readRequestBody(req)) as { requestId?: unknown; action?: unknown; key?: unknown };
				const action = typeof payload.action === "string" ? payload.action : "";
				const key = typeof payload.key === "string" ? payload.key : "";
				return json(res, path.endsWith("/preview") ? await control.preview(action, key) : await control.execute(typeof payload.requestId === "string" ? payload.requestId : "", action, key));
			} catch (error) {
				if (error instanceof ControlError) return json(res, { ok: false, error: error.message }, 400);
				if (error instanceof AuditWriteError) return json(res, { ok: false, error: `audit write failed: ${error.message}` }, 500);
				return json(res, { ok: false, error: "invalid request" }, 400);
			}
		}
		if (["/api/directives", "/api/control", "/api/control/preview", "/api/control/execute"].includes(path)) return json(res, { ok: false, error: "method not allowed" }, 405);
		if (path.startsWith("/api/")) return json(res, { ok: false, error: "not found" }, 404);
		res.writeHead(404); res.end("not found");
	};
}

const port = Number(process.env.PORT || 8901);
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const handle = createApp();
	createServer((req, res) => { void handle(req, res).catch(() => json(res, { error: "internal error" }, 500)); })
		.listen(port, "127.0.0.1", () => console.log(`EO Fleet listening on 127.0.0.1:${port}`));
}
