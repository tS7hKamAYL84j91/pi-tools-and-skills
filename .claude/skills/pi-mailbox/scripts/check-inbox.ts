/**
 * Check the pi mailbox for new messages.
 * With --quiet: only output if messages exist (for hook use).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_DIR } from "../../../../lib/agent-registry.js";
import { createMaildirTransport } from "../../../../lib/transports/maildir.js";

const SESSION_FILE = join(process.cwd(), ".pi", "mailbox-session.json");
const quiet = process.argv.includes("--quiet");
const RECENT_DELIVERED_LIMIT = 10;

// ── Guard: not registered? ──────────────────────────────────────

if (!existsSync(SESSION_FILE)) {
	if (!quiet) console.log("Not registered. Run register first.");
	process.exit(0);
}

let agentId: string;
try {
	const session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
	agentId = session.agentId;
} catch {
	if (!quiet) console.log("Invalid session file.");
	process.exit(0);
}

// ── Check for messages ──────────────────────────────────────────

const transport = createMaildirTransport();
const messages = transport.receive(agentId);

if (messages.length === 0) {
	if (!quiet) {
		console.log("No new messages.");
		showRecentDelivered(agentId);
	}
	process.exit(0);
}

// ── Deliver messages ────────────────────────────────────────────

console.log(`--- ${messages.length} new message(s) ---`);
for (const msg of messages) {
	const time = msg.ts
		? new Date(msg.ts).toLocaleTimeString("en-GB", { hour12: false })
		: "??:??:??";

	console.log("");
	console.log(`From: ${msg.from}  Time: ${time}`);
	console.log(msg.text);

	transport.ack(agentId, msg.id);
}
console.log("");
console.log("--- end messages ---");

// Prune old acknowledged messages
transport.prune(agentId);

// Update pending count in agent record
const recordPath = join(REGISTRY_DIR, `${agentId}.json`);
if (existsSync(recordPath)) {
	try {
		const rec = JSON.parse(readFileSync(recordPath, "utf-8"));
		rec.pendingMessages = transport.pendingCount(agentId);
		writeFileSync(recordPath, JSON.stringify(rec, null, 2), "utf-8");
	} catch {
		/* best-effort */
	}
}

// ── Recent already-delivered messages ──────────────────────────
// In manual mode, surface the last N entries from inbox/cur/ so the
// caller can see what the auto-check hook already drained.

interface DeliveredEntry {
	ts: number;
	from: string;
	text: string;
}

function showRecentDelivered(id: string): void {
	const curDir = join(REGISTRY_DIR, id, "inbox", "cur");
	let files: string[];
	try {
		files = readdirSync(curDir)
			.filter((f) => f.endsWith(".json"))
			.sort();
	} catch {
		return;
	}
	const recent = files.slice(-RECENT_DELIVERED_LIMIT);
	if (recent.length === 0) return;

	console.log("");
	console.log(`--- ${recent.length} recent delivered (already read) ---`);
	for (const f of recent) {
		try {
			const entry = JSON.parse(
				readFileSync(join(curDir, f), "utf-8"),
			) as DeliveredEntry;
			const time = entry.ts
				? new Date(entry.ts).toLocaleTimeString("en-GB", { hour12: false })
				: "??:??:??";
			console.log("");
			console.log(`From: ${entry.from}  Time: ${time}`);
			console.log(entry.text);
		} catch {
			/* skip unreadable */
		}
	}
	console.log("");
	console.log("--- end delivered ---");
}
