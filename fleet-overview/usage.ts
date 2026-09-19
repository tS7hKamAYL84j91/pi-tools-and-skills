/** Incremental session-log parsing -> per-agent usage series.
 *
 * Session files are append-only JSONL under ~/.pi/agent/sessions/<dir>/*.jsonl.
 * Each assistant message record carries message.usage (tokens; cost when the
 * provider reports it) and a timestamp; aggregated per agent per UTC day.
 * Mirror of eo_fleet/usage.py.
 *
 * Parsing is incremental: per-file aggregates are cached keyed by
 * (path, size, mtime) in a small JSON cache (writeFileAtomic); only new or
 * changed files re-parse. A fast pre-scan ("usage" substring) skips lines
 * cheaply; huge historical files are parsed once and then cached.
 *
 * Read-only discipline: sessions are never written; the only write is this
 * host's own cache file. */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../lib/file-persistence.js";
import {
	AGENTS,
	type AgentSpec,
	FLEET_HOME,
	HISTORICAL,
	SESSIONS_ROOT,
} from "./config.js";

const CACHE_VERSION = 1;
// runtime data; the host's own cache dir (gitignored), survives rebuilds
const CACHE_PATH = join(FLEET_HOME, "cache", "usage_cache.json");
const MAX_FILE_BYTES = 400 * 1024 * 1024; // skip absurdly large files defensively

const DAY_RE = /^(\d{4}-\d{2}-\d{2})/;

export interface DayAggregate {
	in: number;
	out: number;
	cacheRead: number;
	reasoning: number;
	total: number;
	cost: number;
	msgs: number;
}

function emptyDay(): DayAggregate {
	return {
		in: 0,
		out: 0,
		cacheRead: 0,
		reasoning: 0,
		total: 0,
		cost: 0,
		msgs: 0,
	};
}

export interface FileAggregate {
	days: Record<string, DayAggregate>;
	lastTs: string;
	lastModel: string;
	firstTs: string;
	sessions: number;
}

export interface AgentUsage extends FileAggregate {}

export interface UsageOptions {
	readonly sessionsRoot?: string;
	readonly specs?: readonly AgentSpec[];
	readonly cachePath?: string;
}

function dayOf(ts: string): string {
	const match = DAY_RE.exec(ts ?? "");
	return match?.[1] ?? "";
}

/** Extract usage/day aggregates from one session file. */
export async function parseSessionFile(path: string): Promise<FileAggregate> {
	const agg: FileAggregate = {
		days: {},
		lastTs: "",
		lastModel: "",
		firstTs: "",
		sessions: 0,
	};
	let raw: string;
	try {
		const info = await stat(path);
		if (info.size > MAX_FILE_BYTES) return agg;
		raw = await readFile(path, "utf8");
	} catch {
		return agg; // file vanished or unreadable: empty aggregates
	}
	for (const line of raw.split("\n")) {
		if (!line.includes('"usage"')) {
			// still track session header timestamps for activity
			if (!agg.firstTs && line.includes('"type":"session"')) {
				try {
					const data = JSON.parse(line) as { timestamp?: unknown };
					if (typeof data.timestamp === "string") {
						agg.firstTs = data.timestamp;
						agg.sessions = 1;
					}
				} catch {
					// malformed header line
				}
			}
			continue;
		}
		let record: {
			timestamp?: unknown;
			message?: unknown;
		};
		try {
			record = JSON.parse(line) as typeof record;
		} catch {
			continue;
		}
		const message =
			typeof record.message === "object" && record.message !== null
				? (record.message as {
						role?: unknown;
						usage?: unknown;
						model?: unknown;
						timestamp?: unknown;
					})
				: {};
		if (message.role !== "assistant") continue;
		const ts =
			typeof record.timestamp === "string"
				? record.timestamp
				: typeof message.timestamp === "string"
					? message.timestamp
					: "";
		const usage =
			typeof message.usage === "object" && message.usage !== null
				? (message.usage as {
						input?: unknown;
						output?: unknown;
						cacheRead?: unknown;
						reasoning?: unknown;
						totalTokens?: unknown;
						cost?: unknown;
					})
				: {};
		const costTotal = (() => {
			const cost = usage.cost;
			if (typeof cost === "object" && cost !== null) {
				const total = (cost as { total?: unknown }).total;
				return typeof total === "number" ? total : 0;
			}
			return 0;
		})();
		const day = dayOf(ts);
		if (day) {
			const d = agg.days[day] ?? emptyDay();
			d.in += typeof usage.input === "number" ? usage.input : 0;
			d.out += typeof usage.output === "number" ? usage.output : 0;
			d.cacheRead += typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
			d.reasoning += typeof usage.reasoning === "number" ? usage.reasoning : 0;
			d.total += typeof usage.totalTokens === "number" ? usage.totalTokens : 0;
			d.cost += costTotal;
			d.msgs += 1;
			agg.days[day] = d;
		}
		if (ts && ts > agg.lastTs) {
			agg.lastTs = ts;
			agg.lastModel =
				typeof message.model === "string" ? message.model : agg.lastModel;
		}
		if (ts && !agg.firstTs) agg.firstTs = ts;
	}
	return agg;
}

interface CacheShape {
	version: number;
	files: Record<string, { state: [number, number]; agg: FileAggregate }>;
}

async function loadCache(cachePath: string): Promise<CacheShape> {
	try {
		const data = JSON.parse(await readFile(cachePath, "utf8")) as CacheShape;
		if (data && typeof data === "object" && data.version === CACHE_VERSION) {
			return data;
		}
	} catch {
		// unreadable or corrupt cache: fall back to a fresh one
	}
	return { version: CACHE_VERSION, files: {} };
}

async function fileState(path: string): Promise<[number, number] | null> {
	try {
		const info = await stat(path);
		return [info.size, Math.floor(info.mtimeMs / 1000)];
	} catch {
		return null;
	}
}

/** Return per-agent aggregates: {agentKey: {days, lastTs, firstTs, sessions}} */
export async function collectUsage(
	options: UsageOptions = {},
): Promise<Record<string, AgentUsage>> {
	const sessionsRoot = options.sessionsRoot ?? SESSIONS_ROOT;
	const specs = options.specs ?? [...AGENTS, ...HISTORICAL];
	const cachePath = options.cachePath ?? CACHE_PATH;
	const cache = await loadCache(cachePath);
	const result: Record<string, AgentUsage> = {};
	for (const spec of specs) {
		const usage: AgentUsage = {
			days: {},
			lastTs: "",
			lastModel: "",
			firstTs: "",
			sessions: 0,
		};
		const dir = spec.sessionDir ? join(sessionsRoot, spec.sessionDir) : "";
		if (dir) {
			let names: string[];
			try {
				names = await readdir(dir);
			} catch {
				names = []; // session dir vanished or unreadable mid-scan
			}
			for (const name of names) {
				if (!name.endsWith(".jsonl")) continue;
				const path = join(dir, name);
				const state = await fileState(path);
				if (!state) continue;
				const cached = cache.files[path];
				if (
					!cached ||
					cached.state[0] !== state[0] ||
					cached.state[1] !== state[1]
				) {
					const parsed = await parseSessionFile(path);
					cache.files[path] = { state, agg: parsed };
				}
				const fagg = (cache.files[path]?.agg as FileAggregate | undefined) ?? {
					days: {},
					lastTs: "",
					lastModel: "",
					firstTs: "",
					sessions: 0,
				};
				for (const [day, dv] of Object.entries(fagg.days)) {
					const t = usage.days[day] ?? emptyDay();
					t.in += dv.in;
					t.out += dv.out;
					t.cacheRead += dv.cacheRead;
					t.reasoning += dv.reasoning;
					t.total += dv.total;
					t.cost += dv.cost;
					t.msgs += dv.msgs;
					usage.days[day] = t;
				}
				if (fagg.lastTs && fagg.lastTs > usage.lastTs) {
					usage.lastTs = fagg.lastTs;
					usage.lastModel = fagg.lastModel || usage.lastModel;
				}
				if (fagg.firstTs && (!usage.firstTs || fagg.firstTs < usage.firstTs)) {
					usage.firstTs = fagg.firstTs;
				}
				usage.sessions += fagg.sessions ?? 0;
			}
		}
		result[spec.key] = usage;
	}
	try {
		await writeFileAtomic(cachePath, JSON.stringify(cache));
	} catch {
		// cache write failed: usage still served; next collect re-parses.
		// (the Python host treats a cache-write failure as fatal; here the
		// read-only data contract matters more than the cache)
	}
	return result;
}
