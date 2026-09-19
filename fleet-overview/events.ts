/** Event feed: ledger tails, kanban board activity, schedules, brief content.
 * Mirror of eo_fleet/events.py. All sources are read-only. */

import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AWAITING_PATH, KANBAN_DIR, LEDGERS, SCHEDULE_DIRS } from "./config.js";

const BOARD_LOG = join(KANBAN_DIR, "board.log");
const BOARD_LINE = /^(\S+) (\w+) (T-\d+)(?: (\S+))?(?: duration=(\S+))?.*$/;
const LEDGER_TAIL_BYTES = 400_000;

// kanban agent-name normalization -> fleet keys
const BOARD_AGENT_MAP: readonly (readonly [string, string])[] = [
	["gravitas", "gravitas"],
	["coas", "coas"],
	["q", "coas"],
	["pi-tools", "pi-tools-and-skills"],
	["tools-and-skills", "pi-tools-and-skills"],
	["compact", "pi-tools-and-skills"],
	["lead", "titanic-gm"],
	["kaggle-enveda", "casmi-gm"],
	["casmi", "casmi-gm"],
];
const LEDGER_AGENT: Readonly<Record<string, string>> = {
	casmi26: "casmi-gm",
	titanic: "titanic-gm",
};

export interface FleetEvent {
	readonly agent: string;
	readonly type: string;
	readonly ts: string;
	readonly summary: string;
	readonly detail: string;
}

export interface LedgerEvent {
	readonly source: string;
	readonly type: string;
	readonly ts: string;
	readonly summary: string;
	readonly detail: string;
}

export interface BoardActivity {
	readonly ts: string;
	readonly type: string;
	readonly task: string;
	readonly agent: string;
	readonly duration: string;
}

export interface ScheduleEntry {
	readonly repo: string;
	readonly task: string;
	readonly CRON_EXPR?: string;
	readonly ENABLED?: string;
	readonly ROOM_ID?: string;
	readonly WORKSPACE_ID?: string;
}

export interface AwaitingItem {
	readonly label?: string;
	readonly detail?: string;
	readonly status?: string;
}

export interface EventSources {
	readonly ledgers?: readonly (readonly [string, string])[];
	readonly boardLog?: string;
	readonly scheduleDirs?: Readonly<Record<string, string>>;
	readonly awaitingPath?: string;
}

export function boardAgent(raw: string): string {
	const lowered = (raw || "").toLowerCase();
	for (const [needle, key] of BOARD_AGENT_MAP) {
		if (lowered.includes(needle)) return key;
	}
	return "other";
}

async function tailLines(path: string, bytes: number): Promise<string[]> {
	let handle;
	try {
		handle = await open(path, "r");
	} catch {
		return []; // ledger missing: skip
	}
	try {
		const size = (await handle.stat()).size;
		const start = Math.max(0, size - bytes);
		const buffer = Buffer.alloc(size - start);
		await handle.read(buffer, 0, buffer.length, start);
		return buffer
			.toString("utf8")
			.split("\n")
			.filter((line) => line.trimStart().startsWith("{"));
	} catch {
		return [];
	} finally {
		await handle.close();
	}
}

function detailFor(type: string, payload: Record<string, unknown>): string {
	const get = (key: string): string => {
		const value = payload[key];
		return value === undefined || value === null ? "" : String(value);
	};
	if (type === "submission.reconciled") {
		return `public score ${get("publicScore")} (receipt ${get("receipt")})`;
	}
	if (type === "submission.dispatched") {
		return `receipt ${get("receipt")} pending`;
	}
	if (type === "localrun.resolved") {
		const bits = ["mrr25", "hit@25", "status"]
			.filter((key) => key in payload)
			.map((key) => `${key}=${get(key)}`);
		return bits.join(" ");
	}
	if (type === "localrun.launched") {
		return `id ${get("id")}`;
	}
	return "";
}

/** Ledger events with source label, newest-first, limit per ledger. */
export async function ledgerEvents(
	options: EventSources = {},
	limitPerLedger = 40,
): Promise<LedgerEvent[]> {
	const ledgers = options.ledgers ?? LEDGERS;
	const events: LedgerEvent[] = [];
	for (const [label, path] of ledgers) {
		const lines = await tailLines(path, LEDGER_TAIL_BYTES);
		for (const line of lines.slice(-limitPerLedger)) {
			try {
				const data = JSON.parse(line) as {
					type?: unknown;
					occurredAt?: unknown;
					payload?: unknown;
				};
				const payload =
					typeof data.payload === "object" && data.payload !== null
						? (data.payload as Record<string, unknown>)
						: {};
				const summary =
					(payload.subject as string | undefined) ??
					(payload.note as string | undefined) ??
					(payload.id as string | undefined) ??
					(payload.receipt as string | undefined) ??
					"";
				events.push({
					source: label,
					type: typeof data.type === "string" ? data.type : "",
					ts: typeof data.occurredAt === "string" ? data.occurredAt : "",
					summary: String(summary).slice(0, 220),
					detail: detailFor(
						typeof data.type === "string" ? data.type : "",
						payload,
					),
				});
			} catch {
				// skip malformed ledger line
			}
		}
	}
	return events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** Merged ledger + board events, each tagged with a fleet agent key. */
export async function allEvents(
	options: EventSources = {},
): Promise<FleetEvent[]> {
	const events: FleetEvent[] = [];
	for (const ledgerEvent of await ledgerEvents(options)) {
		events.push({
			agent: LEDGER_AGENT[ledgerEvent.source] ?? "other",
			type: ledgerEvent.type,
			ts: ledgerEvent.ts,
			summary: ledgerEvent.summary.slice(0, 140),
			detail: ledgerEvent.detail,
		});
	}
	for (const activity of await boardActivity(options, 60)) {
		events.push({
			agent: boardAgent(activity.agent),
			type: `board.${activity.type}`,
			ts: activity.ts,
			summary: `${activity.task} ${activity.type}`,
			detail: activity.duration,
		});
	}
	return events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export async function boardActivity(
	options: EventSources = {},
	limit = 25,
): Promise<BoardActivity[]> {
	const boardLog = options.boardLog ?? BOARD_LOG;
	let raw: string;
	try {
		raw = await readFile(boardLog, "utf8");
	} catch {
		return [];
	}
	const out: BoardActivity[] = [];
	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	for (const line of lines.slice(-limit)) {
		const match = BOARD_LINE.exec(line.trim());
		if (!match) continue;
		const [, ts, type, task, agent, duration] = match;
		if (!ts || !type || !task) continue;
		out.push({
			ts,
			type,
			task,
			agent: agent ?? "",
			duration: duration ?? "",
		});
	}
	return out;
}

export async function schedules(
	options: EventSources = {},
): Promise<ScheduleEntry[]> {
	const scheduleDirs = options.scheduleDirs ?? SCHEDULE_DIRS;
	const out: ScheduleEntry[] = [];
	for (const [repo, dir] of Object.entries(scheduleDirs)) {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			continue; // repo has no schedules dir
		}
		for (const name of names) {
			if (!name.endsWith(".env")) continue;
			const entry: Record<string, string> = { repo, task: name.slice(0, -4) };
			try {
				const raw = await readFile(join(dir, name), "utf8");
				for (const line of raw.split("\n")) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("#") && trimmed.includes("=")) {
						const eq = trimmed.indexOf("=");
						const key = trimmed.slice(0, eq);
						const value = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
						if (
							["CRON_EXPR", "ENABLED", "ROOM_ID", "WORKSPACE_ID"].includes(key)
						) {
							entry[key] = value;
						}
					}
				}
			} catch {
				continue;
			}
			out.push(entry as unknown as ScheduleEntry);
		}
	}
	return out.sort((a, b) =>
		`${a.repo}/${a.task}` < `${b.repo}/${b.task}` ? -1 : 1,
	);
}

export async function awaitingJim(
	options: EventSources = {},
): Promise<AwaitingItem[]> {
	try {
		const data = JSON.parse(
			await readFile(options.awaitingPath ?? AWAITING_PATH, "utf8"),
		) as { items?: unknown };
		if (!Array.isArray(data.items)) return [];
		return data.items.filter(
			(item): item is AwaitingItem =>
				typeof item === "object" &&
				item !== null &&
				(item as AwaitingItem).status === "open",
		);
	} catch {
		return []; // missing or unreadable: no open approvals, never an error page
	}
}

export interface BriefFleet {
	readonly updatedAt: string;
	readonly agents: readonly { key: string; status: string }[];
}

export interface DayTotals {
	readonly total: number;
}

export interface Brief {
	readonly generatedAt: string;
	readonly lines: string[];
	readonly awaiting: AwaitingItem[];
}

/** Auto-digest: answers the recurring questions before they are asked. */
export async function brief(
	fleet: BriefFleet,
	usage: Record<string, { days: Record<string, DayTotals> }>,
	ledger: LedgerEvent[],
	options: EventSources = {},
): Promise<Brief> {
	const lines: string[] = [];
	const working = fleet.agents.filter((a) =>
		["active", "working"].includes(a.status),
	);
	const down = fleet.agents.filter((a) =>
		["down", "terminated", "stood-down"].includes(a.status),
	);
	if (working.length) {
		lines.push(`Working now: ${working.map((a) => a.key).join(", ")}.`);
	} else {
		lines.push("No agent is mid-turn right now.");
	}
	if (down.length) {
		lines.push(`Down/stood-down: ${down.map((a) => a.key).join(", ")}.`);
	}
	const scored = ledger.filter((e) => e.type === "submission.reconciled");
	const first = scored[0];
	if (first) {
		lines.push(
			`Latest ${first.source} submission: ${first.detail} (${first.ts.slice(0, 10)}).`,
		);
	}
	const casmi = ledger.find((e) => e.source === "casmi26");
	if (casmi) {
		lines.push(
			`casmi26 latest: ${casmi.type} — ${casmi.summary.slice(0, 120)}`,
		);
	}
	if (
		ledger.some((e) => e.source === "titanic" && e.type.includes("stood_down"))
	) {
		lines.push(
			"titanic: stood down 2026-09-16; best 0.82768 preserved; rolling-window resubmit due ~Nov 4 if resumed.",
		);
	}
	const today = new Date().toISOString().slice(0, 10);
	let totalToday = 0;
	for (const aggregate of Object.values(usage)) {
		totalToday += aggregate.days[today]?.total ?? 0;
	}
	lines.push(
		`Fleet token usage today (UTC): ${totalToday.toLocaleString("en-US")}.`,
	);
	return {
		generatedAt: fleet.updatedAt,
		lines,
		awaiting: await awaitingJim(options),
	};
}
