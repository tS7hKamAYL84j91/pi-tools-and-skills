/**
 * Agent detail overlay component.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, matchesKey } from "@earendil-works/pi-tui";
import { readSessionLog, type SessionEvent } from "../../../lib/session-log.js";
import { visibleRecords } from "../registry/visibility.js";
import { agentDisplayName, findAgentByDisplayName } from "./display-name.js";
import { formatAge, STATUS_SYMBOL } from "../registry/record-utils.js";
import type { AgentRecord } from "../types.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import { confirmDestructiveAction, type DestructiveConfirmationView } from "../../../lib/tui-confirmation.js";
import { projectWorkSummary } from "./summary-projection.js";
import { renderSummarySection } from "./agent-summary-render.js";
import { accentBorder } from "./ui-format.js";
import {
	buildAgentDetailRows,
	formatActivityExtra,
	getActivityColor,
	getActivityWindow,
} from "./agent-detail-model.js";
import {
	approveAgentApproval,
	deferAgentApproval,
	isPrincipal,
	listAgentApprovals,
	rejectAgentApproval,
	type PendingApproval,
} from "../../pi-coas/lib/coas-approval-inbox.js";

interface RenderAgentDetailOverlayArgs {
	record: AgentRecord;
	selfId: string;
	sessionEvents: SessionEvent[];
	theme: Theme;
	width: number;
	pendingApprovals?: PendingApproval[];
	selectedApprovalIndex?: number;
}

/** @internal Return true for detail-view keys that navigate back to the agent list. */
export function isAgentDetailBackInput(data: string): boolean {
	return matchesKey(data, "backspace") || matchesKey(data, "left");
}

export function renderAgentDetailOverlay(args: RenderAgentDetailOverlayArgs): string[] {
	const container = new Container();
	const add = (s: string) => container.addChild(new Text(s, 1, 0));
	const row = (label: string, value: string) =>
		add(`  ${args.theme.fg("dim", label.padEnd(12))} ${args.theme.fg("text", value)}`);
	const isSelf = args.record.id === args.selfId;

	container.addChild(accentBorder(args.theme));
	add(`  ${STATUS_SYMBOL[args.record.status]} ${args.theme.fg("accent", args.theme.bold(args.record.name))}${isSelf ? args.theme.fg("dim", " (you)") : ""}  ${args.theme.fg("muted", args.record.status)}`);

	for (const detailRow of buildAgentDetailRows(args.record, formatAge(args.record.startedAt))) {
		row(detailRow.label, detailRow.value);
	}

	add(`\n  ${args.theme.fg("accent", args.theme.bold("Recent Activity"))} ${args.theme.fg("dim", `(${args.sessionEvents.length} events)`)}`);
	if (args.sessionEvents.length === 0) {
		add(`  ${args.theme.fg("dim", "(no activity recorded)")}`);
	} else {
		const { visibleEvents, hiddenCount } = getActivityWindow(args.sessionEvents);
		if (hiddenCount > 0) {
			add(`  ${args.theme.fg("dim", `... ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"} omitted`)}`);
		}
		for (const entry of visibleEvents) {
			const ts = new Date(entry.ts).toISOString().slice(11, 19);
			const event = String(entry.event ?? "?");
			const extra = formatActivityExtra(entry);
			add(`  ${args.theme.fg("dim", ts)} ${args.theme.fg(getActivityColor(event), event)}${extra ? args.theme.fg("muted", ` ${extra}`) : ""}`);
		}
	}

	const summary = projectWorkSummary(args.record, args.sessionEvents);
	for (const line of renderSummarySection(summary, args.theme)) {
		add(line);
	}

	const pendingApprovals = args.pendingApprovals ?? [];
	const selectedIndex = Math.max(0, Math.min(args.selectedApprovalIndex ?? 0, pendingApprovals.length - 1));
	if (pendingApprovals.length > 0) {
		add(`\n  ${args.theme.fg("accent", args.theme.bold("Pending Approvals"))} ${args.theme.fg("dim", `(${pendingApprovals.length})`)}`);
		for (let index = 0; index < pendingApprovals.length; index++) {
			const approval = pendingApprovals[index];
			if (!approval) continue;
			const marker = index === selectedIndex ? "> " : "  ";
			add(`  ${marker}${approval.taskId.slice(0, 24)} · ${approval.runId.slice(0, 24)} · ${approval.prompt.slice(0, 80)} · ${approval.createdAt}`);
		}
	}

	const hints = ["backspace/← list", "esc close"];
	if (!isSelf) {
		hints.push("c direct message", "m send message", "s stop", "k kill");
	}
	if (pendingApprovals.length > 0) {
		hints.push(isPrincipal() ? "a approve · r reject · d defer" : "Principal authority required for approvals");
	}
	add(`\n  ${args.theme.fg("dim", hints.join(" · "))}`);
	container.addChild(accentBorder(args.theme));
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

export type AgentDetailAction = "back" | "close" | "message" | "compose" | "stop" | "kill";

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
	const config = deps.getCoasConfig?.(ctx);
	const approvals = config ? await listAgentApprovals(config, rec, deps.selfId) : [];
	const pendingApprovals: PendingApproval[] = [...approvals];
	let selectedApprovalIndex = 0;
	let action: AgentDetailAction | undefined;

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const applyDecision = async (decision: "approve" | "reject" | "defer"): Promise<void> => {
			if (!config) return;
			const approval = pendingApprovals[selectedApprovalIndex];
			if (!approval) return;
			try {
				if (decision === "approve") {
					await approveAgentApproval(config, approval.requestId);
					if (deps.resumeApprovedRun) {
						const resumed = await deps.resumeApprovedRun(config, approval.requestId);
						if (!resumed) {
							ctx.ui.notify(`Approval recorded but scheduled run could not be resumed: ${approval.requestId}`, "warning");
						}
					}
				} else if (decision === "reject") {
					await rejectAgentApproval(config, approval.requestId);
				} else {
					await deferAgentApproval(config, approval.requestId);
				}
				pendingApprovals.splice(selectedApprovalIndex, 1);
				selectedApprovalIndex = Math.max(0, Math.min(selectedApprovalIndex, pendingApprovals.length - 1));
				tui.requestRender();
			} catch (err) {
				ctx.ui.notify(String(err), "error");
			}
		};

		return {
			render: (w: number) => renderAgentDetailOverlay({
				record: rec,
				selfId: deps.selfId,
				sessionEvents,
				theme,
				width: w,
				pendingApprovals,
				selectedApprovalIndex,
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
				} else if (pendingApprovals.length > 0) {
					if (matchesKey(data, "up")) {
						selectedApprovalIndex = Math.max(0, selectedApprovalIndex - 1);
						tui.requestRender();
					} else if (matchesKey(data, "down")) {
						selectedApprovalIndex = Math.min(pendingApprovals.length - 1, selectedApprovalIndex + 1);
						tui.requestRender();
					} else if ((data === "a" || data === "A") && isPrincipal()) {
						void applyDecision("approve");
					} else if ((data === "r" || data === "R") && isPrincipal()) {
						void applyDecision("reject");
					} else if ((data === "d" || data === "D") && isPrincipal()) {
						void applyDecision("defer");
					} else if (data === "a" || data === "A" || data === "r" || data === "R" || data === "d" || data === "D") {
						ctx.ui.notify("Approval decisions require principal authority", "warning");
					}
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
