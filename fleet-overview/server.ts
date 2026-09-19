import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type AgentRecord,
	isPidAlive,
	REGISTRY_DIR,
} from "../lib/agent-registry.js";
import { writeFileAtomic } from "../lib/file-persistence.js";
import { boardProjection } from "./board.js";
import { FLEET_HOME } from "./config.js";
import {
	AuditWriteError,
	type Control,
	ControlError,
	createControl,
} from "./control.js";
import { allEvents, brief, ledgerEvents, schedules } from "./events.js";
import { collectUsage } from "./usage.js";

const STATIC = join(FLEET_HOME, "static");
const DIRECTIVES = join(FLEET_HOME, "directives");
const INBOX = join(DIRECTIVES, "inbox");
const REPLIES = join(DIRECTIVES, "replies");
const MAX_TEXT = 4000;

type Directive = {
	id: string;
	ts: string;
	from: string;
	re?: string;
	text: string;
};

function now(): string {
	return new Date().toISOString().replace(".000Z", "Z");
}
function json(res: ServerResponse, value: unknown, status = 200): void {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(body);
}
async function body(req: IncomingMessage): Promise<string> {
	let result = "";
	for await (const chunk of req) {
		result += chunk.toString();
		if (result.length > 100_000) throw new Error("request too large");
	}
	return result;
}
function cleanText(value: unknown): string {
	if (typeof value !== "string") throw new Error("text must be a string");
	const text = Array.from(value)
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return !(code <= 8 || (code >= 11 && code <= 31) || code === 127);
		})
		.join("")
		.trim()
		.slice(0, MAX_TEXT);
	if (!text) throw new Error("empty directive");
	return text;
}
async function readItems(dir: string): Promise<Directive[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const items: Directive[] = [];
	for (const name of names.filter((n) => /\.(json|txt|md)$/.test(n))) {
		try {
			const path = join(dir, name);
			const raw = await readFile(path, "utf8");
			const parsed: unknown = name.endsWith(".json")
				? JSON.parse(raw)
				: undefined;
			if (parsed && typeof parsed === "object") {
				const data = parsed as Partial<Directive>;
				items.push({
					id: String(data.id ?? name),
					ts: String(data.ts ?? ""),
					from: String(data.from ?? ""),
					re: data.re,
					text: String(data.text ?? ""),
				});
			} else
				items.push({
					id: name.replace(/\.[^.]+$/, ""),
					ts: "",
					from: "gravitas",
					text: raw,
				});
		} catch {
			/* skip malformed runtime files */
		}
	}
	return items
		.sort((a, b) => (b.ts || b.id).localeCompare(a.ts || a.id))
		.slice(0, 50);
}
async function directives(): Promise<{
	inbox: Directive[];
	replies: Directive[];
}> {
	return { inbox: await readItems(INBOX), replies: await readItems(REPLIES) };
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
	try {
		names = (await readdir(REGISTRY_DIR)).filter((n) => n.endsWith(".json"));
	} catch {
		/* no registry */
	}
	const agents: FleetAgent[] = [];
	for (const name of names) {
		try {
			const record = JSON.parse(
				await readFile(join(REGISTRY_DIR, name), "utf8"),
			) as AgentRecord;
			agents.push({
				key: record.name,
				display: record.name,
				model: record.model,
				status: isPidAlive(record.pid) ? record.status : "down",
				detail: record.task || "",
				role: record.kind || "agent",
				lastActivity: new Date(record.heartbeat).toISOString(),
			});
		} catch {
			/* best effort */
		}
	}
	return { updatedAt: now(), agents };
}
export interface FleetOverviewDeps {
	/** Gated control instance; defaults to the real coas-backed one. */
	readonly control?: Control;
}

/** Build the request handler. Exports allow tests to run the app in-process. */
export function createApp(
	deps: FleetOverviewDeps = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	const control = deps.control ?? createControl();

	// TTL memo per data surface (seconds) — mirror of the Python host.
	const TTL: Readonly<Record<string, number>> = {
		fleet: 20,
		usage: 300,
		events: 60,
		board: 60,
		sched: 300,
		brief: 60,
	};
	const memo = new Map<string, { at: number; value: unknown }>();
	async function cached(
		key: string,
		fn: () => Promise<unknown>,
	): Promise<unknown> {
		const hit = memo.get(key);
		const ttl = (TTL[key] ?? 60) * 1000;
		if (hit && Date.now() - hit.at < ttl) return hit.value;
		const value = await fn();
		memo.set(key, { at: Date.now(), value });
		return value;
	}

	async function buildUsage(): Promise<unknown> {
		const agg = await collectUsage();
		const agents: Record<string, unknown> = {};
		for (const [key, a] of Object.entries(agg)) {
			const days: Record<string, unknown> = {};
			for (const day of Object.keys(a.days).sort()) {
				days[day] = a.days[day];
			}
			agents[key] = {
				days,
				lastTs: a.lastTs,
				firstTs: a.firstTs,
				sessions: a.sessions,
			};
		}
		return { updatedAt: now(), agents };
	}

	async function buildBrief(): Promise<unknown> {
		const fleetSnapshot = await fleet();
		const usage = await collectUsage();
		const ledger = await ledgerEvents({});
		return await brief(fleetSnapshot, usage, ledger);
	}

	async function handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		const path =
			new URL(req.url || "/", "http://localhost").pathname.replace(
				/^\/fleet/,
				"",
			) || "/";
		if (path === "/" && req.method === "GET") {
			res.end(await readFile(join(STATIC, "index.html")));
			return;
		}
		if (path === "/api/health") return json(res, { ok: true });
		if (path === "/api/fleet") return json(res, await cached("fleet", fleet));
		if (path === "/api/usage")
			return json(res, await cached("usage", buildUsage));
		if (path === "/api/events")
			return json(
				res,
				await cached("events", async () => ({
					updatedAt: now(),
					events: await allEvents({}),
				})),
			);
		if (path === "/api/board")
			return json(
				res,
				await cached("board", async () => ({
					projection: await boardProjection(),
				})),
			);
		if (path === "/api/schedules")
			return json(
				res,
				await cached("sched", async () => ({
					schedules: await schedules({}),
				})),
			);
		if (path === "/api/brief")
			return json(res, await cached("brief", buildBrief));
		if (path === "/api/directives" && req.method === "GET")
			return json(res, await directives());
		if (path === "/api/directives" && req.method === "POST") {
			try {
				const payload = JSON.parse(await body(req)) as { text?: unknown };
				const item: Directive = {
					id: `d-${Date.now()}-${randomUUID().slice(0, 8)}`,
					ts: now(),
					from: "jim",
					text: cleanText(payload.text),
				};
				await writeFileAtomic(
					join(INBOX, `${item.id}.json`),
					`${JSON.stringify(item, null, 2)}\n`,
				);
				return json(res, { ok: true, directive: item });
			} catch (error) {
				return json(
					res,
					{
						ok: false,
						error: error instanceof Error ? error.message : "invalid directive",
					},
					400,
				);
			}
		}
		if (path === "/api/control" && req.method === "GET")
			return json(res, await control.controlState());
		if (path === "/api/control/preview" && req.method === "POST") {
			try {
				const payload = JSON.parse(await body(req)) as {
					action?: unknown;
					key?: unknown;
				};
				return json(
					res,
					await control.preview(
						typeof payload.action === "string" ? payload.action : "",
						typeof payload.key === "string" ? payload.key : "",
					),
				);
			} catch (error) {
				if (error instanceof ControlError)
					return json(res, { ok: false, error: error.message }, 400);
				return json(res, { ok: false, error: "invalid request" }, 400);
			}
		}
		if (path === "/api/control/execute" && req.method === "POST") {
			try {
				const payload = JSON.parse(await body(req)) as {
					requestId?: unknown;
					action?: unknown;
					key?: unknown;
				};
				return json(
					res,
					await control.execute(
						typeof payload.requestId === "string" ? payload.requestId : "",
						typeof payload.action === "string" ? payload.action : "",
						typeof payload.key === "string" ? payload.key : "",
					),
				);
			} catch (error) {
				if (error instanceof ControlError)
					return json(res, { ok: false, error: error.message }, 400);
				if (error instanceof AuditWriteError)
					return json(
						res,
						{ ok: false, error: `audit write failed: ${error.message}` },
						500,
					);
				return json(res, { ok: false, error: "invalid request" }, 400);
			}
		}
		if (path.startsWith("/api/"))
			return json(res, { ok: false, error: "not found" }, 404);
		res.writeHead(404);
		res.end("not found");
	}

	return handle;
}

const port = Number(process.env.PORT || 8901);
const isMain =
	!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const handle = createApp();
	createServer((req, res) => {
		void handle(req, res).catch(() =>
			json(res, { error: "internal error" }, 500),
		);
	}).listen(port, "127.0.0.1", () =>
		console.log(`EO Fleet listening on 127.0.0.1:${port}`),
	);
}
