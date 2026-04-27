/**
 * Agent panopticon overlay and detail view.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Text,
	SelectList,
	type SelectItem,
	matchesKey,
} from "@mariozechner/pi-tui";
import { readSessionLog } from "../../lib/session-log.js";
import type { AgentListModeStore } from "./list-mode.js";
import { formatAge, sortRecords, STATUS_SYMBOL } from "./registry.js";
import type { Registry } from "./types.js";
import { filterAgentList, visibleRecords } from "./visibility.js";
import {
	buildPowerlineSegments,
	PL_SEP,
	type ThemeColor,
} from "./ui-format.js";

export async function openAgentOverlay(
	ctx: ExtensionContext,
	selfId: string,
	registry: Registry,
	listMode: AgentListModeStore,
): Promise<void> {
	const self = registry.getRecord();
	const records = filterAgentList(self, registry.readAllPeers(), listMode.get(self));
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

	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		container.addChild(border());
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(" Agent Panopticon")) +
					theme.fg("dim", ` - ${records.length} agent${records.length !== 1 ? "s" : ""}`),
				1,
				0,
			),
		);
		container.addChild(new Text(` ${buildPowerlineSegments(sorted, selfId, theme).join(theme.fg("dim", ` ${PL_SEP} `))}`, 1, 1));
		container.addChild(new Text(theme.fg("dim", " ─────────────────────────────────────────────────────"), 1, 0));
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
		container.addChild(new Text(theme.fg("dim", "  ↑↓ navigate • enter view detail • esc close"), 1, 0));
		container.addChild(border());

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	if (!selected) return;
	await showAgentDetail(ctx, selfId, selected, registry);
}

async function showAgentDetail(
	ctx: ExtensionContext,
	selfId: string,
	agentName: string,
	registry: Registry,
): Promise<void> {
	const self = registry.getRecord();
	const records = visibleRecords(self, registry.readAllPeers());
	const rec = records.find((r) => r.name.toLowerCase() === agentName.toLowerCase());
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === selfId;
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		const add = (s: string) => container.addChild(new Text(s, 1, 0));
		const row = (label: string, value: string) =>
			add(`  ${theme.fg("dim", label.padEnd(12))} ${theme.fg("text", value)}`);

		container.addChild(border());
		add(`  ${STATUS_SYMBOL[rec.status]} ${theme.fg("accent", theme.bold(rec.name))}${isSelf ? theme.fg("dim", " (you)") : ""}  ${theme.fg("muted", rec.status)}`);

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

		add(`\n  ${theme.fg("accent", theme.bold("Recent Activity"))} ${theme.fg("dim", `(${sessionEvents.length} events)`)}`);
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
					.map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
					.join(" ");
				add(`  ${theme.fg("dim", ts)} ${theme.fg(col, event)}${extra ? theme.fg("muted", ` ${extra}`) : ""}`);
			}
		}

		add(`\n  ${theme.fg("dim", ["esc back", ...(!isSelf ? ["m send message"] : [])].join(" • "))}`);
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
