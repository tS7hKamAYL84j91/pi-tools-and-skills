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
import { ownPaneIdentity } from "../extensions/pi-agent-hub/registry/zellij-pane.mjs";
import { createNavigator, inputParser } from "./pi-agents-pane-navigation.mjs";

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

function readBoundedJson(path) {
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
		return JSON.parse(buffer.subarray(0, count).toString("utf8"));
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function recordFile(path) {
	const value = readBoundedJson(path);
	return value &&
		typeof value.id === "string" &&
		Number.isSafeInteger(value.pid) &&
		value.pid > 0
		? value
		: null;
}

// Check all known claims, not just rows shown in this panel. Unknown/incomplete
// scans fail closed; Hub remains authoritative and also enforces name ownership.
export function nameAvailable(registry, name) {
	let dir;
	try {
		dir = opendirSync(registry);
		let count = 0;
		for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
			if (++count > MAX_FILES) return false;
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			if (entry.name === "namespace-owners.json") {
				const journal = readBoundedJson(join(registry, entry.name));
				if (!journal || !Array.isArray(journal.owners)) return false;
				if (
					journal.owners.some(
						(owner) =>
							typeof owner?.name === "string" &&
							owner.name.toLowerCase() === name.toLowerCase(),
					)
				)
					return false;
				continue;
			}
			const row = recordFile(join(registry, entry.name));
			if (!row || `${row.id}.json` !== entry.name) return false;
			if (
				[row.name, row.declared_name, row.spawn_name, row.namespace].some(
					(value) =>
						typeof value === "string" &&
						value.toLowerCase() === name.toLowerCase(),
				)
			)
				return false;
		}
		return true;
	} catch {
		return false;
	} finally {
		if (dir) dir.closeSync();
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

export function snapshot(registry, scope, state, navigation = false) {
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
			// Hub normalizes namespace anchors to lowercase; declared lead names retain case.
			if (!lead && record.namespace !== scope.toLowerCase()) continue;
			records.push({
				id: safeText(record.id),
				name: safeText(record.name),
				lead,
				parentId: record.parentId ? safeText(record.parentId) : null,
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
				...(navigation
					? {
							navigation: {
								cwd: record.cwd,
								startedAt: record.startedAt,
								parentId: record.parentId,
								zellij: record.zellij,
							},
						}
					: {}),
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

export function closeConfirmationMatches(request, row, now = Date.now()) {
	return Boolean(
		request &&
			row &&
			now <= request.expires &&
			row.id === request.id &&
			row.pid === request.pid &&
			row.navigation?.startedAt === request.startedAt &&
			row.name === request.name &&
			row.status === request.status &&
			row.navigation?.zellij?.sessionName === request.session &&
			row.navigation?.zellij?.paneId === request.paneId,
	);
}

// Panel-only designation: no registry or ownership mutation. IDs are bound to
// the current process instance, so a choice never silently transfers on restart.
export function designateLead(view, selectedId) {
	if (!view.records) return view;
	const chosen = selectedId
		? view.records.find((row) => row.id === selectedId)
		: undefined;
	const exact = view.records.filter(
		(row) => row.lead && row.name === view.scope,
	);
	const automatic = exact.length === 1 ? exact[0] : undefined;
	const lead = chosen ?? (selectedId ? undefined : automatic);
	if (!lead) return selectedId ? { ...view, leadState: "unavailable" } : view;
	return {
		...view,
		leadState:
			lead.state === "live"
				? "resolved"
				: lead.state === "stale"
					? "unavailable"
					: "unknown",
		records: [lead, ...view.records.filter((row) => row.id !== lead.id)],
	};
}

// Source of truth: extensions/pi-agent-hub/registry/record-utils.ts STATUS_SYMBOL.
// Kept here so the standalone pane needs neither a TS loader nor the Pi runtime.
const STATUS_SYMBOL = {
	running: "R",
	waiting: "W",
	done: "D",
	blocked: "B",
	stalled: "S",
	terminated: "X",
	unknown: "?",
};

// Hub role mapping: extensions/pi-agent-hub/ui/ui-format.ts STATUS_COLOR.
// RGB values resolved from Pi's built-in dark.json; no runtime theme dependency.
const STATUS_COLOR = {
	running: "success",
	waiting: "accent",
	done: "dim",
	blocked: "warning",
	stalled: "warning",
	terminated: "error",
	unknown: "muted",
};
const DARK_COLORS = {
	accent: [167, 152, 215],
	success: [104, 183, 141],
	warning: [205, 154, 34],
	error: [234, 127, 129],
	dim: [126, 136, 142],
	muted: [157, 165, 169],
};

function compactRow(row, width) {
	const status = safeText(row.status);
	const glyph = Object.hasOwn(STATUS_SYMBOL, status)
		? STATUS_SYMBOL[status]
		: "?";
	const indent = row.parentId ? "  ↳ " : "";
	const prefix = `${indent}${glyph} - `;
	let suffix = ` - ${status}`;
	let room = width - prefix.length - suffix.length;
	if (room < 2) {
		suffix = "";
		room = Math.max(0, width - prefix.length);
	}
	const name = safeText(row.name);
	const clipped = clip(name, room);
	const display =
		clipped === name ? name : room >= 2 ? `${clip(name, room - 2)}…` : clipped;
	return `${prefix}${display}${suffix}`;
}

export function render(
	view,
	width = 28,
	height = 40,
	color = false,
	interaction = {},
) {
	const lines = [];
	const roles = new Map([[0, view.error ? "error" : "accent"]]);
	if (view.error) lines.push(`${view.error}: ${view.path}`);
	else {
		const header = interaction.chosenLeadName
			? `lead: ${safeText(interaction.chosenLeadName)}`
			: `${view.scope} · hub${view.leadState === "resolved" ? "" : ` (${view.leadState})`}`;
		lines.push(
			clip(header, width) === header
				? header
				: view.leadState !== "resolved"
					? `hub (${view.leadState})`
					: `${clip(view.scope, Math.max(0, width - 7))} · hub`,
		);
		for (const row of view.records.slice(interaction.offset ?? 0)) {
			roles.set(
				lines.length,
				Object.hasOwn(STATUS_COLOR, row.status)
					? STATUS_COLOR[row.status]
					: "muted",
			);
			lines.push(compactRow(row, width));
		}
		if (view.skipped || view.truncated)
			lines.push(
				`skipped ${view.skipped}${view.truncated ? " / scan capped" : ""}`,
			);
	}
	const available = Math.max(1, height - 1 - (interaction.notice ? 1 : 0));
	const shown = lines.slice(0, available);
	if (lines.length > available) {
		shown[available - 1] = `... ${lines.length - available + 1} lines hidden`;
		roles.set(available - 1, "dim");
	}
	if (interaction.notice && shown.length < height - 1) {
		roles.set(shown.length, "warning");
		shown.push(safeText(interaction.notice));
	}
	roles.set(shown.length, "dim");
	shown.push(
		interaction.enabled
			? width >= 27
				? "n:new c:close l:lead q:quit"
				: "n+ c- l:lead q:quit"
			: "q:quit",
	);
	return `${shown
		.slice(0, height)
		.map((line, index) => {
			const text = clip(line, width);
			const selected =
				interaction.enabled &&
				index > 0 &&
				index < shown.length - 1 &&
				view.records?.[(interaction.offset ?? 0) + index - 1]?.id ===
					interaction.selectedId &&
				line ===
					compactRow(
						view.records[(interaction.offset ?? 0) + index - 1],
						width,
					);
			const decorated = color
				? `\x1b[38;2;${DARK_COLORS[roles.get(index) ?? "dim"].join(";")}m${text}\x1b[0m`
				: text;
			return selected ? `\x1b[7m${decorated}\x1b[0m` : decorated;
		})
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
			options.noColor = true;
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
				: render(
						view,
						process.stdout.columns || 80,
						10000,
						Boolean(process.stdout.isTTY && !options.noColor),
					),
		);
		process.exitCode = view.error ? 3 : 0;
		return;
	}
	const tty = Boolean(process.stdout.isTTY);
	const input = Boolean(tty && process.stdin.isTTY);
	const wasRaw = process.stdin.isRaw;
	const navigator = createNavigator(
		ownPaneIdentity({
			inside: process.env.ZELLIJ,
			sessionName: process.env.ZELLIJ_SESSION_NAME,
			paneId: process.env.ZELLIJ_PANE_ID,
			interactive: input,
		}),
	);
	const parseInput = inputParser();
	let timer,
		stopped = false,
		enabled = false,
		mouse = false,
		selectedId,
		chosenLeadId,
		newAgentName,
		creation,
		confirmation,
		initialized = false,
		offset = 0,
		notice = "",
		view,
		visibleRows = 0,
		checking = false,
		focusGeneration = 0,
		context = null,
		pendingInput = [];
	const setMouse = (active) => {
		if (active === mouse || !input || outputBroken) return;
		mouse = active;
		process.stdout.write(
			active ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l",
		);
	};
	const draw = () => {
		if (stopped || outputBroken || process.stdout.writableNeedDrain) return;
		enabled = Boolean(context);
		if (
			(newAgentName !== undefined || creation) &&
			context?.own.is_focused !== true
		) {
			newAgentName = undefined;
			creation = undefined;
			notice = "New agent cancelled";
		}
		if (creation && Date.now() > creation.expires) {
			creation = undefined;
			notice = "New agent cancelled";
		}
		if (
			confirmation &&
			(context?.own.is_focused !== true || Date.now() > confirmation.expires)
		) {
			confirmation = undefined;
			notice = "Close cancelled";
		}
		setMouse(enabled && context?.own.is_focused === true);
		view = designateLead(
			snapshot(options.registry, options.scope, undefined, input),
			chosenLeadId,
		);
		const rows = view.records ?? [];
		let index = rows.findIndex((row) => row.id === selectedId);
		if (!initialized && rows.length) {
			index = 0;
			selectedId = rows[0].id;
			initialized = true;
		} else if (index < 0 && initialized) {
			confirmation = undefined;
			notice = "selected agent left the registry";
		} else if (notice === "selected agent left the registry") notice = "";
		index = Math.max(0, index);
		const height = Math.max(1, (process.stdout.rows || 40) - 1);
		const capacity = Math.max(
			0,
			height - 2 - (notice ? 1 : 0) - (view.skipped || view.truncated ? 1 : 0),
		);
		if (index < offset) offset = index;
		if (capacity > 0 && index >= offset + capacity)
			offset = index - capacity + 1;
		const page = rows.slice(offset, offset + capacity);
		visibleRows = page.length;
		if (tty) process.stdout.write("\x1b[H\x1b[2J");
		process.stdout.write(
			render(
				view.error ? view : { ...view, records: page },
				Math.max(1, (process.stdout.columns || 80) - 1),
				height,
				tty && !options.noColor,
				{
					enabled,
					selectedId,
					notice,
					chosenLeadName: chosenLeadId
						? rows.find((row) => row.id === chosenLeadId)?.name
						: undefined,
				},
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
		setMouse(false);
		if (input && !outputBroken) process.stdout.write("\x1b[?2004l");
		if (tty && !outputBroken) process.stdout.write("\x1b[?25h");
	};
	cleanup = stop;
	const key = (data, replay = false) => {
		if (newAgentName !== undefined) {
			const input = data.toString();
			if (input === "\x1b" || input === "\x03") {
				newAgentName = undefined;
				notice = "New agent cancelled";
				draw();
				return;
			}
			if (input === "\x7f" || input === "\b")
				newAgentName = newAgentName.slice(0, -1);
			else if (input === "\r" || input === "\n") {
				const name = newAgentName;
				newAgentName = undefined;
				const fresh = designateLead(
					snapshot(options.registry, options.scope, undefined, true),
					chosenLeadId,
				);
				const lead =
					fresh.leadState === "resolved" ? fresh.records?.[0] : undefined;
				if (
					!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) ||
					name.includes("..")
				)
					notice = "Invalid agent name";
				else if (!lead) notice = "Choose a live lead first";
				else if (!nameAvailable(options.registry, name))
					notice = "Name unavailable or registry unreadable";
				else {
					creation = {
						name,
						leadId: lead.id,
						pid: lead.pid,
						startedAt: lead.navigation?.startedAt,
						pane: JSON.stringify(lead.navigation?.zellij),
						armedAt: Date.now(),
						expires: Date.now() + 10000,
					};
					notice = `Default model? Y/n ${name}`;
				}
				draw();
				return;
			} else if (
				/^[a-zA-Z0-9._-]+$/.test(input) &&
				newAgentName.length + input.length <= 64
			)
				newAgentName += input;
			notice = `Name: ${newAgentName}`;
			draw();
			return;
		}
		if (
			context === null &&
			checking &&
			data.toString() !== "q" &&
			!data.includes(3)
		) {
			if (pendingInput.length < 16) pendingInput.push(data);
			return;
		}
		const events = parseInput(data);
		const raw = data.toString();
		if (
			events.some(
				(event) => event.type === "close" || event.type === "confirm",
			) &&
			raw !== "c" &&
			raw !== "y" &&
			raw !== "Y"
		) {
			confirmation = undefined;
			creation = undefined;
			notice = "Use separate confirmation keys";
			draw();
			return;
		}
		const confirmationAtStart = confirmation;
		for (const event of events) {
			if (
				replay &&
				(event.type === "close" ||
					event.type === "confirm" ||
					event.type === "focus")
			) {
				confirmation = undefined;
				notice = "Repeat c after startup";
				continue;
			}
			if (creation) {
				// The name-entry Enter cannot be immediately repeated to launch.
				if (event.type === "focus" && Date.now() - creation.armedAt < 300) {
					notice = "Wait; Enter confirms";
					draw();
					continue;
				}
				if (
					((event.type === "confirm" && (raw === "y" || raw === "Y")) ||
						(event.type === "focus" && (raw === "\r" || raw === "\n"))) &&
					!replay
				) {
					const request = creation;
					creation = undefined;
					const fresh = designateLead(
						snapshot(options.registry, options.scope, undefined, true),
						chosenLeadId,
					);
					const lead = fresh.records?.find((row) => row.id === request.leadId);
					if (
						Date.now() > request.expires ||
						fresh.leadState !== "resolved" ||
						!lead ||
						lead.pid !== request.pid ||
						lead.navigation?.startedAt !== request.startedAt ||
						JSON.stringify(lead.navigation?.zellij) !== request.pane ||
						!nameAvailable(options.registry, request.name)
					)
						notice = "Create cancelled: state changed";
					else
						notice =
							navigator.create(
								request.name,
								options.scope.toLowerCase(),
								lead,
								fresh.records ?? [],
							) ?? `Requested: ${request.name}`;
					if (notice.startsWith("Requested:")) {
						focusGeneration++;
						if (context)
							context = {
								...context,
								own: { ...context.own, is_focused: false },
							};
						setMouse(false);
					}
				} else {
					creation = undefined;
					notice = "New agent cancelled";
				}
				draw();
				continue;
			}
			if (event.type === "quit") {
				stop();
				return;
			}
			if (!enabled || !view?.records?.length) continue;
			let index = view.records.findIndex((row) => row.id === selectedId);
			if (event.type === "close") {
				const row = view.records.find((item) => item.id === selectedId);
				if (!row) {
					notice = "selected agent left the registry";
					draw();
					continue;
				}
				const hint = row.navigation?.zellij;
				if (
					context?.own.is_focused !== true ||
					!hint ||
					!Number.isSafeInteger(hint.paneId)
				) {
					notice = "No verified pane to close";
					draw();
					continue;
				}
				confirmation = {
					id: row.id,
					pid: row.pid,
					startedAt: row.navigation?.startedAt,
					name: row.name,
					status: row.status,
					session: hint.sessionName,
					paneId: hint.paneId,
					expires: Date.now() + 5000,
				};
				const symbol = Object.hasOwn(STATUS_SYMBOL, row.status)
					? STATUS_SYMBOL[row.status]
					: "?";
				notice = `Close #${hint.paneId} [${symbol}] Y/n ${row.name}`;
				draw();
			} else if (event.type === "cancel") {
				if (confirmation) {
					confirmation = undefined;
					notice = "Close cancelled";
				} else if (
					!replay &&
					data.toString() === "n" &&
					context?.own.is_focused === true
				) {
					newAgentName = "";
					notice = "Name: ";
				}
				draw();
			} else if (
				event.type === "confirm" ||
				(confirmation &&
					event.type === "focus" &&
					(raw === "\r" || raw === "\n"))
			) {
				if (!confirmation) continue;
				if (confirmation !== confirmationAtStart) {
					confirmation = undefined;
					notice = "Press c then y separately";
					draw();
					continue;
				}
				const request = confirmation;
				confirmation = undefined;
				const fresh = snapshot(
					options.registry,
					options.scope,
					undefined,
					true,
				);
				const row = fresh.records?.find((item) => item.id === request.id);
				if (Date.now() > request.expires) {
					notice = "Close cancelled: expired";
				} else if (!closeConfirmationMatches(request, row)) {
					notice = "Close cancelled: agent changed";
				} else {
					notice =
						navigator.close(row, fresh.records ?? []) ??
						`Pane closed: ${row.name}`;
				}
				draw();
			} else if (event.type === "lead") {
				confirmation = undefined;
				const row = view.records.find((item) => item.id === selectedId);
				if (!row) {
					notice = "selected agent left the registry";
					draw();
					continue;
				}
				chosenLeadId = row.id;
				notice = `lead: ${row.name}`;
				draw();
			} else if (event.type === "move") {
				confirmation = undefined;
				index = Math.max(
					0,
					Math.min(view.records.length - 1, index + event.delta),
				);
				selectedId = view.records[index].id;
				notice = "";
				draw();
			} else if (event.type === "focus" || event.type === "click") {
				confirmation = undefined;
				if (event.type === "click") {
					if (
						event.x < 1 ||
						event.x >= (process.stdout.columns || 80) ||
						event.y < 2 ||
						event.y >= 2 + visibleRows
					)
						continue;
					index = offset + event.y - 2;
					selectedId = view.records[index]?.id;
				}
				const fresh = snapshot(
					options.registry,
					options.scope,
					undefined,
					true,
				);
				const row = fresh.records?.find((item) => item.id === selectedId);
				if (!row) {
					notice = "selected agent left the registry";
					draw();
					continue;
				}
				notice = navigator.focus(row, fresh.records ?? []) ?? "";
				if (notice) draw();
				else {
					focusGeneration++;
					if (context)
						context = {
							...context,
							own: { ...context.own, is_focused: false },
						};
					setMouse(false);
				}
			}
		}
	};
	const refresh = () => {
		draw();
		if (checking || stopped) return;
		checking = true;
		const generation = focusGeneration;
		void navigator.inspectAsync().then((result) => {
			checking = false;
			if (!stopped && generation === focusGeneration) {
				context = result;
				draw();
				const queued = pendingInput;
				pendingInput = [];
				for (const data of queued) key(data, true);
			}
		});
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	process.on("exit", stop);
	process.stdout.on("resize", draw);
	if (input) {
		process.stdin.setRawMode(true);
		process.stdout.write("\x1b[?2004h");
		process.stdin.resume();
		process.stdin.on("data", key);
	}
	if (tty) process.stdout.write("\x1b[?25l");
	refresh();
	timer = setInterval(refresh, options.interval * 1000);
}
