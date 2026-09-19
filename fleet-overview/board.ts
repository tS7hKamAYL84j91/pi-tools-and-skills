/** Kanban board projection: replay board.log events into current card state.
 * Mirror of eo_fleet/board.py (board-as-projection, per Jim). */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KANBAN_DIR } from "./config.js";

export const BOARD_LOG = join(KANBAN_DIR, "board.log");
export const COLUMNS = [
	"backlog",
	"todo",
	"in-progress",
	"blocked",
	"done",
] as const;
type Column = (typeof COLUMNS)[number];

const HEAD_RE = /^(\S+)\s+(\w+)\s+(T-\d+)(?:\s+(\S+))?/;
const FIELD_RE = /(\w+)="((?:[^"\\]|\\.)*)"/g;

export interface BoardCard {
	readonly id: string;
	readonly title: string;
	readonly priority: string;
	readonly tags: string;
	readonly agent: string;
	readonly lastTs: string;
	readonly blockedReason: string;
	readonly duration: string;
}

export interface BoardProjection {
	readonly columns: Record<string, BoardCard[]>;
	readonly doneTotal: number;
	readonly asOf: string;
}

interface ReplayCard {
	id: string;
	col: Column;
	title: string;
	priority: string;
	tags: string;
	agent: string;
	createdTs: string;
	lastTs: string;
	blockedReason: string;
	duration: string;
}

function fields(line: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const match of line.matchAll(FIELD_RE)) {
		const key = match[1];
		if (key) out[key] = match[2] ?? "";
	}
	return out;
}

async function lines(boardLog: string): Promise<string[]> {
	let raw: string;
	try {
		raw = await readFile(boardLog, "utf8");
	} catch {
		return []; // no board yet: empty projection, not an error
	}
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** Replay the append-only board log into the current board state. */
export async function boardProjection(
	options: { boardLog?: string; maxDone?: number } = {},
): Promise<BoardProjection> {
	const boardLog = options.boardLog ?? BOARD_LOG;
	const maxDone = options.maxDone ?? 12;
	const cards = new Map<string, ReplayCard>();
	const order: string[] = []; // creation order
	for (const line of await lines(boardLog)) {
		const match = HEAD_RE.exec(line);
		if (!match) continue;
		const [, ts, etype, task, agentRaw] = match;
		if (!ts || !etype || !task) continue;
		const agent = agentRaw ?? "";
		const f = fields(line);
		let card = cards.get(task);
		if (!card) {
			card = {
				id: task,
				col: "backlog",
				title: task,
				priority: "",
				tags: "",
				agent,
				createdTs: ts,
				lastTs: ts,
				blockedReason: "",
				duration: "",
			};
			cards.set(task, card);
			order.push(task);
		}
		card.lastTs = ts;
		if (
			agent &&
			agent !== "compact" &&
			["CREATE", "CLAIM", "COMPLETE", "NOTE", "MOVE"].includes(etype)
		) {
			card.agent = agent;
		}
		if (etype === "CREATE") {
			if (f.title) card.title = f.title;
			if (f.priority !== undefined) card.priority = f.priority;
			if (f.tags !== undefined) card.tags = f.tags;
		} else if (etype === "CLAIM") {
			card.col = "in-progress";
		} else if (etype === "MOVE") {
			const to = f.to ?? "";
			if ((COLUMNS as readonly string[]).includes(to)) {
				card.col = to as Column;
			}
		} else if (etype === "BLOCK") {
			card.col = "blocked";
			card.blockedReason = f.reason ?? "";
		} else if (etype === "UNBLOCK") {
			card.col = "todo";
		} else if (etype === "COMPLETE") {
			card.col = "done";
			card.duration = f.duration ?? "";
		}
	}
	const columns: Record<string, BoardCard[]> = {};
	for (const col of COLUMNS) columns[col] = [];
	for (const id of order) {
		const card = cards.get(id);
		if (!card) continue;
		if (card.col === "done") continue; // done handled separately (recent-only)
		columns[card.col]?.push(toCard(card));
	}
	const doneCards = order
		.map((id) => cards.get(id))
		.filter((card): card is ReplayCard => !!card && card.col === "done")
		.sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
		.slice(0, maxDone);
	columns.done = doneCards.map(toCard);
	const doneTotal = order.filter((id) => cards.get(id)?.col === "done").length;
	const last = order.length
		? cards.get(order[order.length - 1] ?? "")?.lastTs
		: "";
	return { columns, doneTotal, asOf: last ?? "" };
}

function toCard(card: ReplayCard): BoardCard {
	return {
		id: card.id,
		title: card.title,
		priority: card.priority,
		tags: card.tags,
		agent: card.agent,
		lastTs: card.lastTs,
		blockedReason: card.blockedReason,
		duration: card.duration,
	};
}
