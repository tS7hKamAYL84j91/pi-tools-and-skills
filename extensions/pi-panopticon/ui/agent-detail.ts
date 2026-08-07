/**
 * Agent detail overlay component.
 */
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, matchesKey } from "@earendil-works/pi-tui";
import { readSessionLog, type SessionEvent } from "../../../lib/session-log.js";
import { visibleRecords } from "../registry/visibility.js";
import { agentDisplayName, findAgentByDisplayName } from "./display-name.js";
import { formatAge, STATUS_SYMBOL } from "../registry/registry.js";
import type { AgentRecord } from "../types.js";
import type { ThemeColor } from "./ui-format.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import { confirmDestructiveAction, type DestructiveConfirmationView } from "../../../lib/tui-confirmation.js";
import { projectWorkSummary } from "./summary-projection.js";
import { renderSummarySection } from "./agent-summary-render.js";


interface RenderAgentDetailOverlayArgs {
	record: AgentRecord;
	selfId: string;
	sessionEvents: SessionEvent[];
	theme: Theme;
	width: number;
}

function agentDetailRows(record: AgentRecord): [string, string][] {
	const rows: [string, string][] = [
		["Model", record.model || "unknown"],
		["CWD", record.cwd],
		["PID", String(record.pid)],
		["Messages", `msg:${record.pendingMessages ?? 0}`],
		["Uptime", formatAge(record.startedAt)],
	];
	if (record.task) {
		rows.push(["Task", record.task.slice(0, 60)]);
	}
	return rows;
}

function activityColor(event: string): ThemeColor {
	if (event.includes("error")) {
		return "error";
	}
	if (event.includes("start")) {
		return "success";
	}
	if (event.includes("end")) {
		return "warning";
	}
	return "dim";
}

function activityExtra(entry: SessionEvent): string {
	return Object.entries(entry)
		.filter(([key]) => key !== "ts" && key !== "event")
		.map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
		.join(" ");
}

interface ActivityWindow {
	visibleEvents: SessionEvent[];
	hiddenCount: number;
}

function activityWindow(events: readonly SessionEvent[]): ActivityWindow {
	const visibleEvents = events.slice(-15);
	return { visibleEvents, hiddenCount: events.length - visibleEvents.length };
}

/** @internal Return true for detail-view keys that navigate back to the agent list. */
export function isAgentDetailBackInput(data: string): boolean {
	return matchesKey(data, "backspace") || matchesKey(data, "left");
}

export function renderAgentDetailOverlay(args: RenderAgentDetailOverlayArgs): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	const add = (s: string) => container.addChild(new Text(s, 1, 0));
	const row = (label: string, value: string) =>
		add(`  ${args.theme.fg("dim", label.padEnd(12))} ${args.theme.fg("text", value)}`);
	const isSelf = args.record.id === args.selfId;

	container.addChild(border());
	add(`  ${STATUS_SYMBOL[args.record.status]} ${args.theme.fg("accent", args.theme.bold(args.record.name))}${isSelf ? args.theme.fg("dim", " (you)") : ""}  ${args.theme.fg("muted", args.record.status)}`);

	for (const [label, value] of agentDetailRows(args.record)) {
		row(label, value);
	}

	add(`\n  ${args.theme.fg("accent", args.theme.bold("Recent Activity"))} ${args.theme.fg("dim", `(${args.sessionEvents.length} events)`)}`);
	if (args.sessionEvents.length === 0) {
		add(`  ${args.theme.fg("dim", "(no activity recorded)")}`);
	} else {
		const { visibleEvents, hiddenCount } = activityWindow(args.sessionEvents);
		if (hiddenCount > 0) {
			add(`  ${args.theme.fg("dim", `... ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"} omitted`)}`);
		}
		for (const entry of visibleEvents) {
			const ts = new Date(entry.ts).toISOString().slice(11, 19);
			const event = String(entry.event ?? "?");
			const extra = activityExtra(entry);
			add(`  ${args.theme.fg("dim", ts)} ${args.theme.fg(activityColor(event), event)}${extra ? args.theme.fg("muted", ` ${extra}`) : ""}`);
		}
	}

	const summary = projectWorkSummary(args.record, args.sessionEvents);
	for (const line of renderSummarySection(summary, args.theme)) {
		add(line);
	}

	add(`\n  ${args.theme.fg("dim", ["backspace/← list", "esc close", ...(!isSelf ? ["c direct message", "m send message", "s stop", "k kill"] : [])].join(" · "))}`);
	container.addChild(border());
	return container.render(args.width);
}

/** @internal Build the standardized stop/kill confirmation view. */
export function agentStopConfirmationView(record: AgentRecord, force: boolean): DestructiveConfirmationView {
	return {
		title: force ? "Confirm KILL agent" : "Confirm stop agent",
		subject: `${record.name} (pid ${record.pid})`,
		details: [force ? "Sends SIGKILL immediately." : "Requests graceful SIGTERM."],
		severity: force ? "error" : "warning",
	};
}

async function confirmAgentStop(
	ctx: ExtensionContext,
	record: AgentRecord,
	force: boolean,
): Promise<boolean> {
	return confirmDestructiveAction(ctx, agentStopConfirmationView(record, force));
}

async function confirmAndStopAgent(
	ctx: ExtensionContext,
	record: AgentRecord,
	deps: AgentOverlayDeps,
	force: boolean,
): Promise<void> {
	if (!(await confirmAgentStop(ctx, record, force))) return;
	const result = await deps.stopAgent(record, force);
	if (result.accepted) {
		ctx.ui.notify(`Sent ${result.method ?? (force ? "SIGKILL" : "SIGTERM")} to ${record.name} (pid ${result.pid ?? record.pid})`, "info");
	} else {
		ctx.ui.notify(result.error ?? `Failed to stop ${record.name}`, "error");
	}
}

type AgentDetailAction = "back" | "close" | "message" | "compose" | "stop" | "kill";

export async function showAgentDetail(
	ctx: ExtensionContext,
	agentName: string,
	deps: AgentOverlayDeps,
): Promise<AgentDetailAction> {
	const self = deps.registry.getRecord();
	const records = visibleRecords(self, deps.registry.readAllPeers());
	const rec = findAgentByDisplayName(records, agentName);
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return "close";
	}

	const isSelf = rec.id === deps.selfId;
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];
	let action: AgentDetailAction | undefined;

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		return {
			render: (w: number) => renderAgentDetailOverlay({
				record: rec,
				selfId: deps.selfId,
				sessionEvents,
				theme,
				width: w,
			}),
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (isAgentDetailBackInput(data)) {
					action = "back";
					done();
				} else if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "c" || data === "C")) {
					action = "message";
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					action = "compose";
					done();
				} else if (!isSelf && (data === "s" || data === "S")) {
					action = "stop";
					done();
				} else if (!isSelf && (data === "k" || data === "K")) {
					action = "kill";
					done();
				}
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			width: "70%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});

	if (action === "compose") {
		ctx.ui.setEditorText(`/send ${agentDisplayName(rec, records)} `);
	} else if (action === "message") {
		await (await import("./agent-message-overlay.js")).openAgentMessageOverlay(ctx, agentName, rec, deps);
	} else if (action === "stop" || action === "kill") {
		await confirmAndStopAgent(ctx, rec, deps, action === "kill");
	}
	return action ?? "close";
}
