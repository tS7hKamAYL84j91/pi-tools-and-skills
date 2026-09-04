/** Native TUI status line and bounded inspection component for pi-event-loop (SPEC §16; TODO P13). */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { type SessionEntryLike, readEventLog } from "./event-log.js";
import {
	EventLoopInspector,
	type EventLoopInspectorDeps,
	type EventLoopTheme,
} from "./event-loop-tui-render.js";
import type { EventLoopRuntime } from "./runtime.js";
import { type EventLoopStatus, buildStatus, formatStatus, formatViews } from "./status.js";
import type { EventLoopConfig, LoopEventData } from "./types.js";

export { EventLoopInspector, type EventLoopInspectorDeps, type EventLoopTheme };

export interface EventLoopStatusSnapshot {
	readonly paused: boolean;
	readonly pauseReason?: string;
	readonly activeCommandType?: string;
	readonly pendingCount: number;
}

export interface InspectorHost {
	readonly hasUI?: boolean;
	readonly mode?: string;
	readonly ui?: Pick<ExtensionUIContext, "custom" | "notify" | "setStatus">;
	readonly notify?: (msg: string, type?: "info" | "error" | "warning") => void;
	readonly custom?: <T>(
		factory: (tui: TUI, theme: EventLoopTheme, keybindings: unknown, done: (value: T) => void) => Component,
		options?: Record<string, unknown>,
	) => Promise<T>;
}

/** Format a compact single-line status indicator for the footer (SPEC §16; Pi TUI Pattern 4). */
export function formatEventLoopStatusLine(
	snapshot: EventLoopStatusSnapshot | undefined,
	theme: EventLoopTheme,
): string | undefined {
	if (snapshot === undefined) {
		return undefined;
	}
	if (snapshot.paused) {
		return theme.fg("warning", `● paused (${snapshot.pauseReason ?? "manual"})`);
	}
	if (snapshot.activeCommandType !== undefined) {
		const base = theme.fg("accent", `● ${snapshot.activeCommandType}`);
		const pending = snapshot.pendingCount > 0 ? theme.fg("muted", ` (+${snapshot.pendingCount})`) : "";
		return `${base}${pending}`;
	}
	if (snapshot.pendingCount > 0) {
		return theme.fg("accent", `● ${snapshot.pendingCount} queued`);
	}
	return theme.fg("muted", "● idle");
}

/** Set or clear the persistent pi-event-loop status in the footer. */
export function setEventLoopStatus(
	ui: { setStatus: (key: string, value: string | undefined) => void; theme: EventLoopTheme },
	snapshot: EventLoopStatusSnapshot | undefined,
): void {
	if (snapshot === undefined) {
		ui.setStatus("pi-event-loop", undefined);
		return;
	}
	ui.setStatus("pi-event-loop", formatEventLoopStatusLine(snapshot, ui.theme));
}

/** Clear the persistent status from the footer. */
export function clearEventLoopStatus(ui: { setStatus: (key: string, value: string | undefined) => void }): void {
	ui.setStatus("pi-event-loop", undefined);
}

/** Non-TUI compact multiline text fallback for RPC and print modes. */
export function formatEventLoopFallback(status: EventLoopStatus, history: readonly LoopEventData[]): string {
	const historyLines =
		history.length === 0
			? "(no events)"
			: history
					.slice(-20)
					.map((evt) => `${evt.occurredAt} [${evt.source}] ${evt.type} [${evt.eventId}] payload=${JSON.stringify(evt.payload)}`)
					.join("\n");

	const sections = [
		"=== Status ===",
		formatStatus(status),
		"",
		"=== Views ===",
		formatViews(status),
		"",
		"=== History ===",
		historyLines,
	];
	return sections.join("\n");
}

/** Open bounded on-demand inspection in TUI overlay or print/RPC fallback. */
export async function openEventLoopInspector(
	host: InspectorHost | ExtensionUIContext,
	deps: {
		readonly runtime: EventLoopRuntime;
		readonly config: EventLoopConfig;
		readonly entries: readonly SessionEntryLike[];
	},
): Promise<void> {
	const status = buildStatus(deps.runtime, deps.config, deps.entries);
	const history = readEventLog(deps.entries);

	const uiTarget = "ui" in host && host.ui !== undefined ? host.ui : (host as ExtensionUIContext);
	const isInteractiveTui =
		("hasUI" in host ? host.hasUI !== false : true) &&
		("mode" in host ? host.mode === "interactive" || host.mode === "tui" || host.mode === undefined : true);

	if (!isInteractiveTui || typeof uiTarget.custom !== "function") {
		uiTarget.notify(formatEventLoopFallback(status, history), "info");
		return;
	}

	await uiTarget.custom<void>(
		(tui, theme, _kb, done) =>
			new EventLoopInspector({
				status,
				history,
				onDone: () => done(),
				theme,
				tui,
			}),
		{
			overlay: true,
			overlayOptions: {
				width: "80%",
				minWidth: 40,
				maxHeight: "80%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}
