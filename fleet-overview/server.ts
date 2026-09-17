import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type AgentRecord,
	isPidAlive,
	REGISTRY_DIR,
} from "../lib/agent-registry.js";
import { writeFileAtomic } from "../lib/file-persistence.js";
import {
	AuditWriteError,
	type Control,
	ControlError,
	createControl,
} from "./control.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC = join(ROOT, "static");
const DIRECTIVES = join(ROOT, "directives");
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
async function fleet(): Promise<{ updatedAt: string; agents: unknown[] }> {
	let names: string[] = [];
	try {
		names = (await readdir(REGISTRY_DIR)).filter((n) => n.endsWith(".json"));
	} catch {
		/* no registry */
	}
	const agents: unknown[] = [];
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
		if (path === "/api/fleet") return json(res, await fleet());
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
			return json(res, {
				updatedAt: now(),
				events: [],
				agents: {},
				schedules: [],
				lines: [],
				projection: { columns: {} },
			});
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
