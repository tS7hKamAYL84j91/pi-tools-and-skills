/**
 * Render the panopticon work-summary section for the agent detail view.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { WorkSummary } from "./summary-projection.js";

const MAX_BULLETS = 5;
const MAX_CHARS = 55;

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function bulletLines(values: string[], theme: Theme): Array<Text> {
	if (values.length === 0) {
		return [new Text(theme.fg("dim", "    (none recorded)"), 1, 0)];
	}
	return values.slice(0, MAX_BULLETS).map((value) =>
		new Text(theme.fg("text", `    • ${truncate(value, MAX_CHARS)}`), 1, 0),
	);
}

/** Render a work-summary section bounded to fit the detail overlay. */
export function renderSummarySection(summary: WorkSummary, theme: Theme): string[] {
	const container = new Container();
	container.addChild(new Text(theme.fg("accent", theme.bold("\n  Work Summary")), 1, 0));

	if (summary.briefGoal) {
		container.addChild(new Text(theme.fg("text", `  Goal: ${truncate(summary.briefGoal, MAX_CHARS)}`), 1, 0));
	} else {
		container.addChild(new Text(theme.fg("dim", "  Goal: (no task recorded)"), 1, 0));
	}

	container.addChild(new Text(theme.fg("muted", "  Sources:"), 1, 0));
	for (const line of bulletLines(summary.sources, theme)) {
		container.addChild(line);
	}

	container.addChild(new Text(theme.fg("muted", "  Artifacts:"), 1, 0));
	for (const line of bulletLines(summary.artifacts, theme)) {
		container.addChild(line);
	}

	if (summary.lastCheck) {
		const status = summary.lastCheck.ok ? theme.fg("success", "ok") : theme.fg("error", "fail");
		container.addChild(new Text(theme.fg("text", `  Last check: ${truncate(summary.lastCheck.tool, 24)} ${status} ${truncate(summary.lastCheck.summary, MAX_CHARS - 40)}`), 1, 0));
	}

	return container.render(0).filter((line) => line.trim().length > 0);
}
