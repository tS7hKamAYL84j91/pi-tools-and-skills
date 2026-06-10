/**
 * Shared TUI destructive confirmation helpers.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";

export type DestructiveConfirmationSeverity = "warning" | "error";

export interface DestructiveConfirmationView {
	title: string;
	subject: string;
	details?: string[];
	severity?: DestructiveConfirmationSeverity;
}

/** Return the standard confirmation result for a keypress, if handled. */
export function destructiveConfirmationInputResult(data: string): boolean | undefined {
	if (data === "y" || data === "Y") {
		return true;
	}
	if (data === "n" || data === "N" || matchesKey(data, "escape")) {
		return false;
	}
	return undefined;
}

function severityColor(severity: DestructiveConfirmationSeverity | undefined): "warning" | "error" {
	return severity ?? "warning";
}

function boundedLine(text: string, width: number): string {
	return `  ${truncateToWidth(text, Math.max(8, width - 4), "…", true)}`;
}

/** Render the standard destructive-action confirmation overlay. */
export function renderDestructiveConfirmationOverlay(
	view: DestructiveConfirmationView,
	width: number,
	theme: Theme,
): string[] {
	const color = severityColor(view.severity);
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => theme.fg(color, s));
	container.addChild(border());
	container.addChild(new Text(theme.fg(color, boundedLine(theme.bold(view.title), width)), 1, 0));
	container.addChild(new Text(theme.fg("text", boundedLine(view.subject, width)), 1, 0));
	for (const detail of view.details ?? []) {
		container.addChild(new Text(theme.fg("dim", boundedLine(detail, width)), 1, 0));
	}
	container.addChild(new Text(theme.fg("dim", boundedLine("[y] confirm · [esc/n] cancel", width)), 1, 0));
	container.addChild(border());
	return container.render(width);
}

/** Open the standard destructive-action confirmation overlay. */
export async function confirmDestructiveAction(
	ctx: ExtensionContext,
	view: DestructiveConfirmationView,
): Promise<boolean> {
	return ctx.ui.custom<boolean>((_tui, theme, _kb, done) => ({
		render: (width: number) => renderDestructiveConfirmationOverlay(view, width, theme),
		invalidate: () => undefined,
		handleInput: (data: string) => {
			const result = destructiveConfirmationInputResult(data);
			if (result !== undefined) {
				done(result);
			}
		},
	}), {
		overlay: true,
		overlayOptions: {
			width: "50%",
			minWidth: 40,
			maxHeight: "40%",
			anchor: "center",
			margin: 2,
		},
	});
}
