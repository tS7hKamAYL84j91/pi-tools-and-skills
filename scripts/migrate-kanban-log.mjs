#!/usr/bin/env node
/**
 * One-time migration: legacy text `board.log` -> typed `board.events.jsonl`.
 *
 * The extension no longer reads the legacy text format. Run this once per
 * board, then the old log is archived under `archive/`. KISS: no back-compat
 * shim, no dual-write, no merge.
 *
 * Usage:
 *   node scripts/migrate-kanban-log.mjs [kanbanDir] [--dry-run] [--force]
 *
 * kanbanDir defaults to $KANBAN_DIR, else ./pi-kanban.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const KANBAN_EVENT_VERSION = 1;
const TASK_ID = /^T-\d+$/;

function fail(message) {
	console.error(`migrate-kanban-log: ${message}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const dirArg = args.find((arg) => !arg.startsWith("--"));
const dir = resolve(dirArg || process.env.KANBAN_DIR || join(process.cwd(), "pi-kanban"));
const legacyPath = join(dir, "board.log");
const targetPath = join(dir, "board.events.jsonl");

// ── Legacy text parsing (verbatim semantics) ───────────────────

function parseKV(fields) {
	const kv = {};
	let i = 0;
	while (i < fields.length) {
		const field = fields[i] ?? "";
		const eq = field.indexOf("=");
		if (eq <= 0) {
			i++;
			continue;
		}
		const key = field.slice(0, eq);
		let val = field.slice(eq + 1);
		if (val.startsWith('"')) {
			val = val.slice(1);
			while (!val.endsWith('"') && i + 1 < fields.length) {
				i++;
				val += ` ${fields[i] ?? ""}`;
			}
			if (val.endsWith('"')) val = val.slice(0, -1);
		}
		kv[key] = val;
		i++;
	}
	return kv;
}

function parseChecks(raw) {
	try {
		const parsed = JSON.parse(raw.replace(/'/g, '"'));
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((c) => c !== null && typeof c === "object")
			.map((c) => ({
				command: typeof c.command === "string" ? c.command : "",
				result: typeof c.result === "string" ? c.result : "",
				exit_code:
					typeof c.exit_code === "number"
						? c.exit_code
						: typeof c.exitCode === "number"
							? c.exitCode
							: -1,
			}))
			.filter((c) => c.command || c.result);
	} catch {
		return [];
	}
}

function sanitiseAgent(value) {
	return value.replace(/[^a-z0-9-]/g, "").slice(0, 64) || "unknown";
}

function toEvent(ts, kind, task_id, agent, payload) {
	const base = {
		v: KANBAN_EVENT_VERSION,
		ts,
		task_id,
		agent: sanitiseAgent(agent),
	};
	switch (kind) {
		case "CREATE":
			return {
				...base,
				type: "create",
				...(payload.title !== undefined ? { title: payload.title } : {}),
				...(payload.priority !== undefined ? { priority: payload.priority } : {}),
				...(payload.tags !== undefined ? { tags: payload.tags } : {}),
				...(payload.description ? { description: payload.description } : {}),
			};
		case "MOVE":
			return { ...base, type: "move", from: payload.from ?? "", to: payload.to ?? "" };
		case "CLAIM":
			return {
				...base,
				type: "claim",
				...(payload.model ? { model: payload.model } : {}),
				...(payload.expires ? { expires: payload.expires } : {}),
			};
		case "UNCLAIM":
			return { ...base, type: "unclaim" };
		case "EXPIRE":
			return { ...base, type: "expire" };
		case "COMPLETE": {
			const checks = payload.checks ? parseChecks(payload.checks) : [];
			return {
				...base,
				type: "complete",
				...(payload.duration ? { duration: payload.duration } : {}),
				...(payload.verification_required === "true" ? { verification_required: true } : {}),
				...(checks.length > 0 ? { checks } : {}),
			};
		}
		case "BLOCK":
			return { ...base, type: "block", ...(payload.reason ? { reason: payload.reason } : {}) };
		case "UNBLOCK":
			return { ...base, type: "unblock", ...(payload.resolution ? { resolution: payload.resolution } : {}) };
		case "NOTE":
			return { ...base, type: "note", text: payload.text ?? "" };
		case "DELETE":
			return { ...base, type: "delete", ...(payload.reason ? { reason: payload.reason } : {}) };
		case "EDIT":
			return {
				...base,
				type: "edit",
				...(payload.title !== undefined ? { title: payload.title } : {}),
				...(payload.priority !== undefined ? { priority: payload.priority } : {}),
				...(payload.tags !== undefined ? { tags: payload.tags } : {}),
				...(payload.description !== undefined ? { description: payload.description } : {}),
			};
		default:
			return undefined;
	}
}

// ── Migrate ────────────────────────────────────────────────────

if (!existsSync(legacyPath)) fail(`no legacy log at ${legacyPath}`);
if (existsSync(targetPath) && !force)
	fail(`${targetPath} already exists; pass --force to overwrite`);

const raw = readFileSync(legacyPath, "utf-8");
const lines = raw.split("\n").filter((line) => line.trim());
const events = [];
let skipped = 0;

for (const line of lines) {
	const parts = line.split(/\s+/);
	const ts = parts[0] ?? "";
	const kind = parts[1] ?? "";
	const taskId = parts[2] ?? "";
	const agent = parts[3] ?? "";
	if (!TASK_ID.test(taskId)) {
		skipped++;
		continue;
	}
	const event = toEvent(ts, kind, taskId, agent, parseKV(parts.slice(4)));
	if (!event) {
		skipped++;
		continue;
	}
	events.push(event);
}

const output = events.length > 0 ? `${events.map((e) => JSON.stringify(e)).join("\n")}\n` : "";

if (dryRun) {
	console.log(
		`[dry-run] ${lines.length} legacy line(s): ${events.length} event(s), ${skipped} skipped\n` +
			`          target: ${targetPath}`,
	);
	process.exit(0);
}

mkdirSync(dirname(targetPath), { recursive: true });

let installed = false;
try {
	const temporaryPath = `${targetPath}.${process.pid}.tmp`;
	writeFileSync(temporaryPath, output, { encoding: "utf-8", mode: 0o600 });
	renameSync(temporaryPath, targetPath);
	installed = true;
} catch (error) {
	fail(`failed to write ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
}

// Archive the legacy log so it is never read again.
const archiveDir = join(dir, "archive");
mkdirSync(archiveDir, { recursive: true });
const archivedLegacy = join(
	archiveDir,
	`board.log.migrated.${new Date().toISOString().replace(/:/g, "-")}`,
);
try {
	renameSync(legacyPath, archivedLegacy);
} catch (error) {
	if (installed) {
		try {
			unlinkSync(targetPath);
		} catch {
			/* best-effort rollback */
		}
	}
	fail(`failed to archive ${legacyPath}: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(
	`Migrated ${events.length} event(s) from ${lines.length} legacy line(s) (${skipped} skipped).\n` +
		`  target:  ${targetPath}\n` +
		`  archive: ${archivedLegacy}`,
);
