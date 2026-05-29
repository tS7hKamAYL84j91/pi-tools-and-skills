import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { agentStopConfirmationView } from "../extensions/pi-panopticon/agent-overlay.js";
import { teamDeleteConfirmationView } from "../extensions/pi-teams/team-commands.js";
import type { AgentRecord } from "../extensions/pi-panopticon/types.js";
import {
	destructiveConfirmationInputResult,
	renderDestructiveConfirmationOverlay,
} from "../lib/tui-confirmation.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

function expectWidthBounded(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

function record(): AgentRecord {
	return {
		id: "worker-one",
		name: "worker-one",
		pid: 1234,
		cwd: "/tmp/worker-one",
		model: "example/model",
		startedAt: Date.now(),
		heartbeat: Date.now(),
		status: "waiting",
		pendingMessages: 0,
	};
}

describe("destructive confirmation overlay", () => {
	it("maps standard confirmation inputs", () => {
		expect(destructiveConfirmationInputResult("y")).toBe(true);
		expect(destructiveConfirmationInputResult("Y")).toBe(true);
		expect(destructiveConfirmationInputResult("n")).toBe(false);
		expect(destructiveConfirmationInputResult("N")).toBe(false);
		expect(destructiveConfirmationInputResult("\x1b")).toBe(false);
		expect(destructiveConfirmationInputResult("x")).toBeUndefined();
	});

	it("renders the standard key hints and bounded content", () => {
		const width = 42;
		const lines = renderDestructiveConfirmationOverlay({
			title: "Confirm destructive action",
			subject: "a very long object name that should be truncated before it can overflow the overlay width",
			details: ["This action cannot be completed without explicit confirmation."],
			severity: "error",
		}, width, fakeTheme);

		const body = lines.join("\n");
		expect(body).toContain("Confirm destructive action");
		expect(body).toContain("y confirm · esc/n cancel");
		expectWidthBounded(lines, width);
	});

	it("uses warning for graceful stop and error for force kill", () => {
		expect(agentStopConfirmationView(record(), false)).toMatchObject({
			title: "Confirm stop agent",
			severity: "warning",
		});
		expect(agentStopConfirmationView(record(), true)).toMatchObject({
			title: "Confirm KILL agent",
			severity: "error",
		});
	});

	it("uses the standard delete view for team deletion", () => {
		expect(teamDeleteConfirmationView("navigator")).toMatchObject({
			title: "Delete team?",
			subject: "Delete/dissolve team \"navigator\"?",
			severity: "warning",
		});
	});
});
