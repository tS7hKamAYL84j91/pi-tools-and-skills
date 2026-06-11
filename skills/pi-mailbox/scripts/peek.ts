/**
 * Peek at registered pi agents and their activity logs.
 *
 * Usage:
 *   npx tsx peek.ts              # list all live agents
 *   npx tsx peek.ts <name>       # show activity log for a specific agent
 *   npx tsx peek.ts <name> 100   # show last 100 events (default 50)
 *
 * Read-only — does not modify registry or reap dead agents.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { REGISTRY_DIR, isPidAlive, STALE_MS, type AgentRecord } from "../../../lib/agent-registry.js";
import { readSessionLog, formatSessionLog } from "../../../lib/session-log.js";

// ── Helpers ────────────────────────────────────────────────────

const STATUS_SYMBOL: Record<string, string> = {
	running: "🟢",
	waiting: "🟡",
	done: "✅",
	blocked: "🚧",
	stalled: "🛑",
	terminated: "⚫",
	unknown: "⚪",
};

function formatAge(startedAt: number): string {
	const secs = Math.round((Date.now() - startedAt) / 1000);
	return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}

async function readLiveRecords(): Promise<AgentRecord[]> {
	const now = Date.now();
	const records: AgentRecord[] = [];
	try {
		const files = await readdir(REGISTRY_DIR);
		const parsePromises = files.map(async (f) => {
			if (!f.endsWith(".json")) {
				return null;
			}
			try {
				const content = await readFile(join(REGISTRY_DIR, f), "utf-8");
				const rec: AgentRecord = JSON.parse(content);
				if (!isPidAlive(rec.pid)) {
					return null;
				}
				if (now - rec.heartbeat > STALE_MS) {
					rec.status = "stalled";
				}
				return rec;
			} catch {
				return null; /* skip corrupt */
			}
		});

		const results = await Promise.all(parsePromises);
		for (const r of results) {
			if (r) {
				records.push(r);
			}
		}
	} catch {
		/* empty registry */
	}
	return records.sort((a, b) => a.startedAt - b.startedAt);
}

// ── Main ───────────────────────────────────────────────────────

const target = process.argv[2];
const lineCount = Number(process.argv[3]) || 50;
const records = await readLiveRecords();

if (!target) {
	// List all agents
	if (records.length === 0) {
		console.log("No agents registered.");
		process.exit(0);
	}
	console.log(`${records.length} registered agent(s):\n`);
	for (const r of records) {
		const sym = STATUS_SYMBOL[r.status] ?? "⚪";
		const pending = (r.pendingMessages ?? 0) > 0 ? ` ✉${r.pendingMessages}` : "";
		const task = r.task ? `  "${r.task.slice(0, 50)}"` : "";
		const session = r.sessionFile ? " 📄" : "";
		console.log(
			`  ${sym} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${r.model || "?"} up=${formatAge(
				r.startedAt,
			)}${pending}${session}${task}`,
		);
	}
	process.exit(0);
}

// Peek at a specific agent
const lower = target.toLowerCase();
const peer = records.find((r) => r.name.toLowerCase() === lower);
if (!peer) {
	const names = records.map((r) => r.name);
	console.log(`No agent named "${target}". Known agents: ${names.length ? names.join(", ") : "(none)"}`);
	process.exit(1);
}

if (!peer.sessionFile || !existsSync(peer.sessionFile)) {
	console.log(`Agent "${peer.name}" has no session log available.`);
	console.log(`  Status: ${peer.status}, PID: ${peer.pid}, up=${formatAge(peer.startedAt)}`);
	console.log(`  cwd: ${peer.cwd}`);
	process.exit(0);
}

const events = readSessionLog(peer.sessionFile, lineCount);
console.log(`Agent "${peer.name}" activity (last ${events.length} events):\n`);
console.log(formatSessionLog(events));
