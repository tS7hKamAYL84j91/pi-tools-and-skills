/** Tests for the ported data surfaces: board projection, events, schedules,
 * awaiting, brief, and the incremental usage ETL. All fixtures are tmpdirs —
 * no test touches the real repos, sessions, or ledgers. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boardProjection } from "../fleet-overview/board.js";
import {
	allEvents,
	awaitingJim,
	boardActivity,
	boardAgent,
	brief,
	ledgerEvents,
	schedules,
} from "../fleet-overview/events.js";
import { collectUsage, parseSessionFile } from "../fleet-overview/usage.js";

const dirs: string[] = [];

async function workdir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "fleet-overview-data-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});

function sessionLines(records: unknown[]): string {
	return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

describe("usage ETL", () => {
	it("aggregates assistant usage per day", async () => {
		const dir = await workdir();
		const path = join(dir, "s.jsonl");
		await writeFile(
			path,
			sessionLines([
				{
					type: "session",
					version: 3,
					id: "x",
					timestamp: "2026-09-16T07:00:00.000Z",
					cwd: "/repo",
				},
				{
					type: "message",
					id: "a",
					timestamp: "2026-09-16T07:01:00.000Z",
					message: { role: "user", content: [{ type: "text", text: "hi" }] },
				},
				{
					type: "message",
					id: "b",
					timestamp: "2026-09-16T07:02:00.000Z",
					message: {
						role: "assistant",
						model: "m1",
						usage: {
							input: 100,
							output: 50,
							cacheRead: 10,
							reasoning: 5,
							totalTokens: 165,
							cost: { total: 0.01 },
						},
					},
				},
			]),
		);
		const agg = await parseSessionFile(path);
		const day = agg.days["2026-09-16"];
		expect(day?.total).toBe(165);
		expect(day?.in).toBe(100);
		expect(day?.msgs).toBe(1);
		expect(day?.cost).toBeCloseTo(0.01);
		expect(agg.lastTs).toBe("2026-09-16T07:02:00.000Z");
		expect(agg.lastModel).toBe("m1");
		expect(agg.firstTs).toBe("2026-09-16T07:00:00.000Z");
		expect(agg.sessions).toBe(1);
	});

	it("ignores non-assistant lines that merely contain 'usage'", async () => {
		const dir = await workdir();
		const path = join(dir, "s.jsonl");
		await writeFile(
			path,
			sessionLines([
				{
					type: "message",
					id: "c",
					timestamp: "2026-09-16T07:03:00.000Z",
					message: { role: "toolResult", content: "usage report" },
				},
			]),
		);
		const agg = await parseSessionFile(path);
		expect(agg.days).toEqual({});
	});

	it("collects per agent and caches incrementally", async () => {
		const dir = await workdir();
		const sessionsRoot = dir;
		const cachePath = join(dir, "usage_cache.json");
		await mkdir(join(sessionsRoot, "sess"));
		const path = join(sessionsRoot, "sess", "s.jsonl");
		await writeFile(
			path,
			sessionLines([
				{
					type: "message",
					id: "b",
					timestamp: "2026-09-17T09:00:00.000Z",
					message: {
						role: "assistant",
						model: "m",
						usage: { input: 10, output: 5, totalTokens: 15 },
					},
				},
			]),
		);
		const spec = {
			key: "t-agent",
			display: "T",
			sessionDir: "sess",
			statusNote: "",
		};
		const first = await collectUsage({
			sessionsRoot,
			specs: [spec],
			cachePath,
		});
		expect(first["t-agent"]?.days["2026-09-17"]?.total).toBe(15);
		// second collect: same answer, cache file written, no re-parse needed
		const second = await collectUsage({
			sessionsRoot,
			specs: [spec],
			cachePath,
		});
		expect(second["t-agent"]?.days["2026-09-17"]?.total).toBe(15);
		const cache = JSON.parse(
			await (await import("node:fs/promises")).readFile(cachePath, "utf8"),
		) as {
			files: Record<string, unknown>;
		};
		expect(Object.keys(cache.files)).toHaveLength(1);
		// appending to the session file invalidates the entry and re-parses
		await (await import("node:fs/promises")).appendFile(
			path,
			sessionLines([
				{
					type: "message",
					id: "d",
					timestamp: "2026-09-17T10:00:00.000Z",
					message: {
						role: "assistant",
						model: "m",
						usage: { input: 1, output: 1, totalTokens: 2 },
					},
				},
			]),
		);
		const third = await collectUsage({
			sessionsRoot,
			specs: [spec],
			cachePath,
		});
		expect(third["t-agent"]?.days["2026-09-17"]?.total).toBe(17);
	});
});

describe("board projection", () => {
	it("replays the board log into current card state", async () => {
		const dir = await workdir();
		const boardLog = join(dir, "board.log");
		await writeFile(
			boardLog,
			[
				'2026-03-31T20:56:19.068Z CREATE T-001 compact title="Fix refresh" priority=high tags="ui"',
				"2026-03-31T21:00:00.000Z CLAIM T-001 gravitas",
				'2026-03-31T21:10:00.000Z BLOCK T-001 coas reason="waiting on vendor"',
				"2026-03-31T21:20:00.000Z UNBLOCK T-001 coas",
				'2026-03-31T21:51:21.416Z COMPLETE T-001 tools-and-skills duration="25m"',
				'2026-03-31T22:00:00.000Z CREATE T-002 kaggle-enveda title="Kernel v3"',
				"2026-03-31T22:05:00.000Z CLAIM T-002 kaggle-enveda",
				'2026-03-31T22:06:00.000Z MOVE T-002 kaggle-enveda to="blocked"',
				"",
			].join("\n"),
		);
		const projection = await boardProjection({ boardLog, maxDone: 12 });
		// T-001 was claimed/blocked/unblocked and completed; final state done
		expect(projection.doneTotal).toBe(1);
		expect(projection.columns.done?.[0]?.id).toBe("T-001");
		expect(projection.columns.done?.[0]?.duration).toBe("25m");
		// T-002 was moved to blocked via MOVE to=...
		expect(projection.columns["in-progress"]?.map((c) => c.id)).toEqual([]);
		expect(projection.columns.blocked?.map((c) => c.id)).toEqual(["T-002"]);
		expect(projection.asOf).toBe("2026-03-31T22:06:00.000Z");
		// replay: agent attribution sticks to the last known actor
		expect(projection.columns.done?.[0]?.agent).toBe("tools-and-skills");
	});

	it("keeps only the recent done tail but counts all", async () => {
		const dir = await workdir();
		const boardLog = join(dir, "board.log");
		const lines: string[] = [];
		for (let i = 1; i <= 15; i += 1) {
			lines.push(
				`2026-04-01T0${i % 10}:00:00.000Z CREATE T-0${String(i).padStart(2, "0")} title="t${i}"`,
			);
			lines.push(
				`2026-04-01T0${i % 10}:30:00.000Z COMPLETE T-0${String(i).padStart(2, "0")}`,
			);
		}
		await writeFile(boardLog, `${lines.join("\n")}\n`);
		const projection = await boardProjection({ boardLog, maxDone: 3 });
		expect(projection.doneTotal).toBe(15);
		expect(projection.columns.done).toHaveLength(3);
	});

	it("missing board log projects empty, not an error", async () => {
		const projection = await boardProjection({
			boardLog: "/nonexistent/board.log",
		});
		expect(projection.doneTotal).toBe(0);
		expect(projection.columns.backlog).toEqual([]);
	});
});

describe("events, schedules, awaiting, brief", () => {
	it("maps board agents to fleet keys", () => {
		expect(boardAgent("kaggle-enveda-gm")).toBe("casmi-gm");
		expect(boardAgent("tools-and-skills")).toBe("pi-tools-and-skills");
		expect(boardAgent("Q")).toBe("coas");
		expect(boardAgent("someone-new")).toBe("other");
	});

	it("reads ledger tails with detail mapping", async () => {
		const dir = await workdir();
		const ledger = join(dir, "ledger.jsonl");
		await writeFile(
			ledger,
			[
				JSON.stringify({
					type: "submission.reconciled",
					occurredAt: "2026-09-16T10:00:00Z",
					payload: { receipt: "r1", publicScore: "0.82768", subject: "Sub A" },
				}),
				JSON.stringify({
					type: "localrun.resolved",
					occurredAt: "2026-09-16T11:00:00Z",
					payload: { id: "run9", mrr25: "0.31", status: "ok" },
				}),
				"{corrupt line",
			].join("\n") + "\n",
		);
		const events = await ledgerEvents({ ledgers: [["casmi26", ledger]] });
		expect(events).toHaveLength(2);
		expect(events[0]?.type).toBe("localrun.resolved"); // newest first
		expect(events[0]?.detail).toBe("mrr25=0.31 status=ok");
		expect(events[1]?.detail).toBe("public score 0.82768 (receipt r1)");
	});

	it("merges ledger and board activity with fleet keys, newest first", async () => {
		const dir = await workdir();
		const ledger = join(dir, "ledger.jsonl");
		const boardLog = join(dir, "board.log");
		await writeFile(
			ledger,
			JSON.stringify({
				type: "submission.dispatched",
				occurredAt: "2026-09-16T09:00:00Z",
				payload: { receipt: "r0", subject: "Sub 0" },
			}) + "\n",
		);
		await writeFile(
			boardLog,
			"2026-09-16T12:00:00.000Z COMPLETE T-009 kaggle-enveda duration=25m\n",
		);
		const events = await allEvents({
			ledgers: [["casmi26", ledger]],
			boardLog,
		});
		expect(events).toHaveLength(2);
		expect(events[0]?.agent).toBe("casmi-gm");
		expect(events[0]?.type).toBe("board.COMPLETE");
		expect(events[1]?.agent).toBe("casmi-gm");
		expect(events[1]?.type).toBe("submission.dispatched");
		const activity = await boardActivity({ boardLog });
		expect(activity[0]?.task).toBe("T-009");
	});

	it("parses schedule .env files", async () => {
		const dir = await workdir();
		await writeFile(
			join(dir, "nightly.env"),
			[
				"# nightly report",
				"CRON_EXPR='0 7 * * *'",
				'ENABLED="1"',
				"ROOM_ID='!room:example'",
				"PROMPT=not surfaced",
				"",
			].join("\n"),
		);
		await writeFile(
			join(dir, "disabled.env"),
			"CRON_EXPR=0 9 * * *\nENABLED=0\n",
		);
		const entries = await schedules({ scheduleDirs: { repoA: dir } });
		expect(entries).toHaveLength(2);
		const nightly = entries.find((e) => e.task === "nightly");
		expect(nightly?.repo).toBe("repoA");
		expect(nightly?.CRON_EXPR).toBe("0 7 * * *");
		expect(nightly?.ENABLED).toBe("1");
		expect(nightly?.ROOM_ID).toBe("!room:example");
		expect(entries[0]?.task).toBe("disabled"); // sorted repo/task
	});

	it("filters awaiting items to open only", async () => {
		const dir = await workdir();
		const awaitingPath = join(dir, "awaiting.json");
		await writeFile(
			awaitingPath,
			JSON.stringify({
				updated: "now",
				items: [
					{ label: "A", detail: "needs Jim", status: "open" },
					{ label: "B", detail: "done", status: "resolved" },
					{ label: "C", detail: "open too", status: "open" },
				],
			}),
		);
		const open = await awaitingJim({ awaitingPath });
		expect(open.map((i) => i.label)).toEqual(["A", "C"]);
	});

	it("brief answers before Jim asks", async () => {
		const dir = await workdir();
		const awaitingPath = join(dir, "awaiting.json");
		await writeFile(
			awaitingPath,
			JSON.stringify({
				updated: "now",
				items: [{ label: "A", detail: "needs Jim", status: "open" }],
			}),
		);
		const fleetSnapshot = {
			updatedAt: "2026-09-17T12:00:00Z",
			agents: [
				{ key: "gravitas", status: "active" },
				{ key: "coas", status: "down" },
			],
		};
		const usage = {
			gravitas: {
				days: { [new Date().toISOString().slice(0, 10)]: { total: 1234 } },
			},
		};
		const ledger = [
			{
				source: "casmi26",
				type: "submission.reconciled",
				ts: "2026-09-16T10:00:00Z",
				summary: "Sub A",
				detail: "public score 0.82768 (receipt r1)",
			},
			{
				source: "titanic",
				type: "agent.stood_down",
				ts: "2026-09-16T11:00:00Z",
				summary: "hold",
				detail: "",
			},
		];
		const digest = await brief(fleetSnapshot, usage, ledger, { awaitingPath });
		expect(digest.lines[0]).toBe("Working now: gravitas.");
		expect(digest.lines[1]).toBe("Down/stood-down: coas.");
		expect(
			digest.lines.some((l) =>
				l.startsWith("Latest casmi26 submission: public score 0.82768"),
			),
		).toBe(true);
		expect(digest.lines.some((l) => l.startsWith("titanic: stood down"))).toBe(
			true,
		);
		expect(
			digest.lines.some((l) =>
				l.includes("Fleet token usage today (UTC): 1,234."),
			),
		).toBe(true);
		expect(digest.awaiting).toHaveLength(1);
		expect(digest.generatedAt).toBe("2026-09-17T12:00:00Z");
	});
});
