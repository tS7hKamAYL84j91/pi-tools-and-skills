#!/usr/bin/env node
/** Read-only projection of lib/agent-registry.ts AgentRecord. No Hub lifecycle readers:
 * those reap records, change modes, and update counters. No session/transcript IO.
 */
import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	opendirSync,
	readSync,
	readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const MAX_RECORD = 64 * 1024;
const MAX_FILES = 4096;

export function safeText(value) {
	if (typeof value !== "string") return "unavailable";
	return stripVTControlCharacters(value.slice(0, 1024)).replace(
		/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
		" ",
	);
}

// Conservative width: non-ASCII occupies at most two cells; combining marks zero.
export function clip(value, width) {
	let result = "",
		cells = 0;
	for (const char of safeText(value)) {
		const size = /\p{Mark}/u.test(char) ? 0 : char.codePointAt(0) > 127 ? 2 : 1;
		if (cells + size > width) break;
		result += char;
		cells += size;
	}
	return result;
}

function recordFile(path) {
	let fd;
	try {
		fd = openSync(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_RECORD) return null;
		const buffer = Buffer.alloc(stat.size + 1);
		const count = readSync(fd, buffer, 0, buffer.length, 0);
		if (count > MAX_RECORD) return null;
		const value = JSON.parse(buffer.subarray(0, count).toString("utf8"));
		return value &&
			typeof value.id === "string" &&
			Number.isSafeInteger(value.pid) &&
			value.pid > 0
			? value
			: null;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/** Linux exposes starttime in USER_HZ (100 ticks/sec), not kernel CONFIG_HZ.
 * No kill(0), subprocess, environment, or process command line access.
 */
export function processState(
	record,
	read = (path) => readFileSync(path, "utf8"),
) {
	try {
		const boot = /^btime (\d+)$/m.exec(read("/proc/stat"));
		if (!boot) return "unknown";
		let stat;
		try {
			stat = read(`/proc/${record.pid}/stat`);
		} catch (error) {
			return error.code === "ENOENT" ? "stale" : "unknown";
		}
		// comm can contain spaces and parentheses; field 3 follows the LAST ')'.
		const fields = stat
			.slice(stat.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		if (["Z", "X", "x"].includes(fields[0])) return "stale";
		const ticks = Number(fields[19]);
		if (!Number.isFinite(ticks) || !Number.isFinite(record.startedAt))
			return "unknown";
		const started = Number(boot[1]) * 1000 + ticks * 10;
		// One-sided PID-reuse guard: registration may lag exec without an upper bound.
		const skew = started - record.startedAt;
		return skew > 120_000 ? "stale" : "live";
	} catch {
		return "unknown";
	}
}

function sessionId(record) {
	if (typeof record.sessionFile !== "string") return null;
	// Pi's documented <timestamp>_<session-id>.jsonl; do not guess from agent ID.
	return (
		/^\d{4}-\d{2}-\d{2}T[^_]+_(.+)\.jsonl$/.exec(
			basename(record.sessionFile),
		)?.[1] ?? null
	);
}

export function snapshot(registry, scope, state) {
	let procStat;
	const readProc = (path) => {
		if (path !== "/proc/stat") return readFileSync(path, "utf8");
		procStat ??= readFileSync(path, "utf8");
		return procStat;
	};
	const getState = state ?? ((record) => processState(record, readProc));
	let dir;
	const records = [];
	let skipped = 0,
		truncated = false;
	try {
		dir = opendirSync(registry);
		let count = 0;
		for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
			if (++count > MAX_FILES) {
				truncated = true;
				break;
			}
			if (
				!entry.isFile() ||
				!entry.name.endsWith(".json") ||
				entry.name === "namespace-owners.json"
			)
				continue;
			const record = recordFile(join(registry, entry.name));
			if (!record || `${record.id}.json` !== entry.name) {
				skipped++;
				continue;
			}
			if (record.kind === "external") continue;
			const lead =
				record.namespace == null &&
				(record.declared_name == null
					? record.name === scope
					: record.declared_name === scope);
			if (!lead && record.namespace !== scope) continue;
			records.push({
				id: safeText(record.id),
				name: safeText(record.name),
				lead,
				pid: record.pid,
				state: getState(record),
				status: safeText(record.status),
				model: safeText(record.model),
				heartbeat:
					Number.isFinite(record.heartbeat) && record.heartbeat >= 0
						? record.heartbeat
						: null,
				pendingMessages:
					Number.isSafeInteger(record.pendingMessages) &&
					record.pendingMessages >= 0
						? record.pendingMessages
						: null,
				sessionId:
					sessionId(record) === null ? null : safeText(sessionId(record)),
				sessionTitle: null,
			});
		}
	} catch {
		return { error: "registry unreadable", path: safeText(registry) };
	} finally {
		if (dir) dir.closeSync();
	}
	records.sort(
		(a, b) =>
			Number(b.lead) - Number(a.lead) ||
			(a.name < b.name ? -1 : a.name > b.name ? 1 : a.id.localeCompare(b.id)),
	);
	const leads = records.filter((row) => row.lead).length;
	return {
		scope: safeText(scope),
		leadState:
			leads > 1
				? "ambiguous"
				: leads === 0 || records[0].state === "stale"
					? "unavailable"
					: records[0].state === "live"
						? "resolved"
						: "unknown",
		records,
		skipped,
		truncated,
	};
}

export function render(view, width = 28, height = 40, now = Date.now()) {
	const lines = [];
	if (view.error) lines.push(`${view.error}: ${view.path}`);
	else {
		lines.push(`${view.scope} / Agent Hub`, `lead: ${view.leadState}`);
		for (const row of view.records) {
			const age =
				row.heartbeat !== null && row.heartbeat <= now
					? now - row.heartbeat
					: null;
			const seconds = age === null ? null : Math.floor(age / 1000);
			const elapsed =
				seconds === null
					? "?"
					: seconds < 60
						? `${seconds}s`
						: seconds < 3600
							? `${Math.floor(seconds / 60)}m`
							: seconds < 86400
								? `${Math.floor(seconds / 3600)}h`
								: `${Math.floor(seconds / 86400)}d`;
			lines.push(
				`${row.lead ? "*" : "-"} ${row.name}`,
				`  ${row.status} / ${row.state}`,
				`  pid ${row.pid} msg ${row.pendingMessages ?? "?"}`,
				`  seen ${elapsed} / ${age === null ? "unknown" : age > 30_000 ? "old" : "fresh"}`,
				`  model ${row.model}`,
				`  session ${row.sessionId ?? "unavailable"}`,
			);
		}
		if (view.skipped || view.truncated)
			lines.push(
				`skipped ${view.skipped}${view.truncated ? " / scan capped" : ""}`,
			);
	}
	const available = Math.max(1, height - 1);
	const shown = lines.slice(0, available);
	if (lines.length > available)
		shown[available - 1] = `... ${lines.length - available + 1} lines hidden`;
	shown.push("read-only / q quit");
	return `${shown
		.slice(0, height)
		.map((line) => clip(line, width))
		.join("\n")}\n`;
}

const USAGE =
	"pi-agents-pane --scope <lead> [--registry <dir>] [--interval <seconds>] [--once] [--json] [--no-color]\n";
export function parseArgs(args) {
	const options = {
		registry: join(homedir(), ".pi", "agents"),
		interval: 2,
		once: false,
		json: false,
	};
	const seen = new Set();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (seen.has(arg)) throw new Error("duplicate option");
		seen.add(arg);
		if (arg === "--help") return { help: true };
		if (arg === "--once") options.once = true;
		else if (arg === "--json") {
			options.json = true;
			options.once = true;
		} else if (arg === "--no-color") {
			/* monochrome by design */
		} else if (["--scope", "--registry", "--interval"].includes(arg)) {
			const value = args[++i];
			if (!value || value.startsWith("--"))
				throw new Error("missing option value");
			options[arg.slice(2)] = arg === "--interval" ? Number(value) : value;
		} else throw new Error("unknown option");
	}
	if (
		!options.scope ||
		!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.scope)
	)
		throw new Error("invalid scope");
	if (
		!Number.isFinite(options.interval) ||
		options.interval < 0.25 ||
		options.interval > 3600
	)
		throw new Error("interval must be 0.25–3600 seconds");
	return options;
}

export function main(args = process.argv.slice(2)) {
	let outputBroken = false;
	let cleanup = () => {};
	process.stdout.on("error", (error) => {
		outputBroken = true;
		cleanup();
		process.exitCode = error.code === "EPIPE" ? 0 : 1;
	});
	let options;
	try {
		options = parseArgs(args);
	} catch {
		process.stderr.write(USAGE);
		process.exitCode = 2;
		return;
	}
	if (options.help) {
		process.stdout.write(USAGE);
		return;
	}
	const frame = () => snapshot(options.registry, options.scope);
	if (options.once) {
		const view = frame();
		process.stdout.write(
			options.json
				? `${JSON.stringify(view)}\n`
				: render(view, process.stdout.columns || 80, 10000),
		);
		process.exitCode = view.error ? 3 : 0;
		return;
	}
	const tty = Boolean(process.stdout.isTTY);
	const input = Boolean(tty && process.stdin.isTTY);
	const wasRaw = process.stdin.isRaw;
	let timer,
		stopped = false;
	const draw = () => {
		if (stopped || outputBroken || process.stdout.writableNeedDrain) return;
		if (tty) process.stdout.write("\x1b[H\x1b[2J");
		process.stdout.write(
			render(
				frame(),
				Math.max(1, (process.stdout.columns || 80) - 1),
				Math.max(1, (process.stdout.rows || 40) - 1),
			),
		);
	};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		process.off("exit", stop);
		process.stdout.off("resize", draw);
		if (input) {
			process.stdin.off("data", key);
			try {
				process.stdin.setRawMode(Boolean(wasRaw));
			} catch {
				/* terminal disconnected */
			}
			process.stdin.pause();
		}
		if (tty && !outputBroken) process.stdout.write("\x1b[?25h");
	};
	cleanup = stop;
	const key = (data) => {
		if (data.toString().includes("q") || data.includes(3)) stop();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	process.on("exit", stop);
	process.stdout.on("resize", draw);
	if (input) {
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", key);
	}
	if (tty) process.stdout.write("\x1b[?25l");
	draw();
	timer = setInterval(draw, options.interval * 1000);
}
