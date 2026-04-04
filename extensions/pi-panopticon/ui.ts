/**
 * UI module for pi-panopticon extension.
 *
 * Manages:
 * - /alias command (rename your agent)
 * - /agents overlay (view all agents + detail view)
 * - Ctrl+Shift+O shortcut
 * - Powerline widget (compact agent status bar)
 * - Status indicator
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Text,
	type SelectItem,
	SelectList,
	matchesKey,
	truncateToWidth,
} from "@mariozechner/pi-tui";

import { readSessionLog } from "../../lib/session-log.js";
import type { Registry, AgentRecord, AgentStatus } from "./types.js";
import { formatAge, nameTaken, sortRecords, STATUS_SYMBOL } from "./registry.js";

/** Map status → short label shown after the colon in powerline segments. */
const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "active",
	waiting: "idle",
	done: "done",
	blocked: "blocked",
	stalled: "stalled",
	terminated: "dead",
	unknown: "?",
};

type ThemeColor =
	Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0];

/** Map status → theme colour key for the name portion of a segment. */
const STATUS_COLOR: Record<AgentStatus, ThemeColor> = {
	running: "success",
	waiting: "accent",
	done: "dim",
	blocked: "warning",
	stalled: "warning",
	terminated: "error",
	unknown: "muted",
};

const PL_SEP = "\uE0B0"; // ❯ filled right-pointing triangle
const PL_SEP_THIN = "\uE0B1"; // ❯ thin right-pointing triangle

// ── Pure functions (exported for tests) ────────────────────────

/**
 * Build Powerline segments for all agents; self is bold accent, peers use STATUS_COLOR.
 * @internal exported for tests
 */
function buildPowerlineSegments(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
): string[] {
	return sortRecords(records, selfId).map((rec) => {
		const sym = STATUS_SYMBOL[rec.status];
		const label = STATUS_LABEL[rec.status];
		const inbox =
			(rec.pendingMessages ?? 0) > 0
				? theme.fg("warning", `(✉${rec.pendingMessages})`)
				: "";
		if (rec.id === selfId)
			return `${sym} ${theme.fg("accent", theme.bold(rec.name))}${theme.fg("dim", `:${label}`)}${inbox}`;
		return `${sym} ${theme.fg(STATUS_COLOR[rec.status], rec.name)}${theme.fg("dim", `:${label}`)}${inbox}`;
	});
}

/**
 * Render Powerline widget with ellipsis truncation to available width.
 * @internal exported for tests
 */
function renderPowerlineWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const segs = buildPowerlineSegments(records, selfId, theme);
	const separator = theme.fg("dim", ` ${PL_SEP_THIN} `);
	return [truncateToWidth(segs.join(separator), availableWidth)];
}

// ── Overlay helpers ────────────────────────────────────────────

async function openAgentOverlay(
	ctx: ExtensionContext,
	selfId: string,
	registry: Registry,
): Promise<void> {
	const records = registry.readAllPeers();
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		return;
	}

	const sorted = sortRecords(records, selfId);

	const items: SelectItem[] = sorted.map((rec) => ({
		value: rec.name,
		label: `${STATUS_SYMBOL[rec.status]} ${rec.name}${rec.id === selfId ? " (you)" : ""}`,
		description: `${rec.status} │ ${rec.model || "?"} │ up ${formatAge(rec.startedAt)}${rec.task ? ` │ ${rec.task.slice(0, 50)}` : ""}`,
	}));

	const selected = await ctx.ui.custom<string | null>(
		(tui, theme, _kb, done) => {
			const border = () =>
				new DynamicBorder((s: string) =>
					theme.fg("accent", s),
				);
			const container = new Container();
			container.addChild(border());
			container.addChild(
				new Text(
					theme.fg("accent", theme.bold(" Agent Panopticon")) +
						theme.fg(
							"dim",
							` - ${records.length} agent${records.length !== 1 ? "s" : ""}`,
						),
					1,
					0,
				),
			);
			container.addChild(
				new Text(
					` ${buildPowerlineSegments(sorted, selfId, theme).join(theme.fg("dim", ` ${PL_SEP} `))}`,
					1,
					1,
				),
			);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						" ─────────────────────────────────────────────────────",
					),
					1,
					0,
				),
			);
			const selectList = new SelectList(items, Math.min(items.length, 12), {
				selectedPrefix: (t: string) => theme.fg("accent", t),
				selectedText: (t: string) => theme.fg("accent", t),
				description: (t: string) => theme.fg("muted", t),
				scrollInfo: (t: string) => theme.fg("dim", t),
				noMatch: (t: string) => theme.fg("warning", t),
			});
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"  ↑↓ navigate • enter view detail • esc close",
					),
					1,
					0,
				),
			);
			container.addChild(border());

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		},
	);

	if (!selected) return;
	await showAgentDetail(ctx, selfId, selected, registry);
}

async function showAgentDetail(
	ctx: ExtensionContext,
	selfId: string,
	agentName: string,
	registry: Registry,
): Promise<void> {
	const records = registry.readAllPeers();
	const rec = records.find(
		(r) => r.name.toLowerCase() === agentName.toLowerCase(),
	);
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === selfId;
	const sessionEvents = rec.sessionFile
		? readSessionLog(rec.sessionFile, 20)
		: [];

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const border = () =>
			new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();

		const add = (s: string) => container.addChild(new Text(s, 1, 0));
		const row = (label: string, value: string) =>
			add(
				`  ${theme.fg("dim", label.padEnd(12))} ${theme.fg("text", value)}`,
			);

		container.addChild(border());
		add(
			`  ${STATUS_SYMBOL[rec.status]} ${theme.fg("accent", theme.bold(rec.name))}${isSelf ? theme.fg("dim", " (you)") : ""}  ${theme.fg("muted", rec.status)}`,
		);

		const pending = rec.pendingMessages ?? 0;
		const details: [string, string][] = [
			["Model", rec.model || "unknown"],
			["CWD", rec.cwd],
			["PID", String(rec.pid)],
			["Messages", `pending: ${pending}`],
			["Uptime", formatAge(rec.startedAt)],
		];
		if (rec.task) details.push(["Task", rec.task.slice(0, 60)]);

		for (const [label, value] of details) row(label, value);

		add(
			`\n  ${theme.fg("accent", theme.bold("Recent Activity"))} ${theme.fg("dim", `(${sessionEvents.length} events)`)}`,
		);
		if (sessionEvents.length === 0) {
			add(`  ${theme.fg("dim", "(no activity recorded)")}`);
		} else {
			for (const entry of sessionEvents.slice(-15)) {
				const ts = new Date(entry.ts).toISOString().slice(11, 19);
				const event = String(entry.event ?? "?");
				const col: ThemeColor = event.includes("error")
					? "error"
					: event.includes("start")
						? "success"
						: event.includes("end")
							? "warning"
							: "dim";
				const extra = Object.entries(entry)
					.filter(([k]) => k !== "ts" && k !== "event")
					.map(
						([k, v]) =>
							`${k}=${String(v).slice(0, 60)}`,
					)
					.join(" ");
				add(
					`  ${theme.fg("dim", ts)} ${theme.fg(col, event)}${extra ? theme.fg("muted", ` ${extra}`) : ""}`,
				);
			}
		}

		add(
			`\n  ${theme.fg("dim", ["esc back", ...(!isSelf ? ["m send message"] : [])].join(" • "))}`,
		);
		container.addChild(border());

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					done();
					ctx.ui.setEditorText(`/send ${rec.name} `);
				}
			},
		};
	});
}

// ── UIModule interface and setup ───────────────────────────────

interface UIModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	refresh(ctx: ExtensionContext): void;
}

export function setupUI(
	pi: ExtensionAPI,
	registry: Registry,
	selfId: string,
): UIModule {
	let widgetTimer: ReturnType<typeof setInterval> | null = null;

	// ── /alias command ──────────────────────────────────────────

	pi.registerCommand("alias", {
		description: "Set your agent name. Usage: /alias <name>",
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				const record = registry.getRecord();
				ctx.ui.notify(
					`Current name: ${record?.name ?? "(none)"}`,
					"info",
				);
				return;
			}
			if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
				ctx.ui.notify(
					"Name must start with alphanumeric, then alphanumeric/hyphens/dots/underscores",
					"warning",
				);
				return;
			}
			if (nameTaken(name, registry.readAllPeers(), selfId)) {
				ctx.ui.notify(
					`Name "${name}" is already taken`,
					"warning",
				);
				return;
			}
			registry.setName(name);
			ctx.ui.notify(`You are now "${name}"`, "info");
		},
	});

	// ── /agents overlay ─────────────────────────────────────────

	pi.registerCommand("agents", {
		description:
			"Show compact Powerline status bar for all agents, then open detail overlay",
		handler: async (_args, ctx) => {
			const records = registry.readAllPeers();
			if (records.length === 0) {
				ctx.ui.notify("No agents registered", "info");
				return;
			}
			ctx.ui.notify(
				sortRecords(records, selfId)
					.map(
						(r) =>
							`${STATUS_SYMBOL[r.status]} ${r.name}:${STATUS_LABEL[r.status]}`,
					)
					.join(` ${PL_SEP_THIN} `),
				"info",
			);
			await openAgentOverlay(ctx, selfId, registry);
		},
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Open agent panopticon overlay",
		handler: async (ctx) => {
			await openAgentOverlay(ctx, selfId, registry);
		},
	});

	// ── Widget refresh logic ────────────────────────────────────

	function refreshWidget(ctx: ExtensionContext): void {
		try {
			const records = registry.readAllPeers();
			if (records.length === 0) {
				ctx.ui.setWidget("agent-panopticon", undefined);
				ctx.ui.setStatus(
					"agent-panopticon",
					ctx.ui.theme.fg("dim", "agents: 0"),
				);
				return;
			}

			ctx.ui.setWidget(
				"agent-panopticon",
				(_tui: unknown, theme: ExtensionContext["ui"]["theme"]) => ({
					render(width: number): string[] {
						return renderPowerlineWidget(
							records,
							selfId,
							theme,
							width,
						);
					},
					invalidate(): void {
						/* data refreshed every 5s via refreshWidget timer */
					},
				}),
				{ placement: "belowEditor" },
			);

			const peers = records.filter((r) => r.id !== selfId);
			const running = peers.filter((r) => r.status === "running").length;
			const waiting = peers.filter((r) => r.status === "waiting").length;
			const label =
				peers.length === 0
					? "solo"
					: running > 0 || waiting > 0
						? [[running, "▶"], [waiting, "⏸"]]
							.filter(([n]) => n)
							.map(([n, s]) => `${n}${s}`)
							.join(" ")
						: `${peers.length} peer${peers.length !== 1 ? "s" : ""}`;
			ctx.ui.setStatus(
				"agent-panopticon",
				ctx.ui.theme.fg("accent", `⚡${label}`),
			);
		} catch {
			ctx.ui.setStatus(
				"agent-panopticon",
				ctx.ui.theme.fg("error", "agents: err"),
			);
		}
	}

	// ── Return UIModule ─────────────────────────────────────────

	return {
		start(ctx: ExtensionContext): void {
			refreshWidget(ctx);
			widgetTimer = setInterval(() => refreshWidget(ctx), 5_000);
		},

		stop(): void {
			if (widgetTimer) {
				clearInterval(widgetTimer);
				widgetTimer = null;
			}
		},

		refresh(ctx: ExtensionContext): void {
			refreshWidget(ctx);
		},
	};
}
