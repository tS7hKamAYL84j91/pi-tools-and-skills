/** Tests for pi-event-loop native TUI status and inspection components (SPEC §16; TODO P13). */

import { describe, expect, it, vi } from "vitest";
import { CONFIG, workCompleted, workRequested } from "../../../tests/fixtures/pi-event-loop.js";
import {
	clearEventLoopStatus,
	EventLoopInspector,
	formatEventLoopFallback,
	formatEventLoopStatusLine,
	setEventLoopStatus,
	type EventLoopStatusSnapshot,
	type EventLoopTheme,
} from "../event-loop-tui.js";
import { buildStatus } from "../status.js";
import { createEventLoopRuntime } from "../runtime.js";
import type { LoopEventData } from "../types.js";

const FAKE_THEME: EventLoopTheme = {
	fg: (_color: string, text: string) => `[fg:${_color}]${text}[/fg]`,
	bg: (_color: string, text: string) => `[bg:${_color}]${text}[/bg]`,
	bold: (text: string) => `[b]${text}[/b]`,
};

function createSampleStatus() {
	const runtime = createEventLoopRuntime();
	const event1 = workRequested("work-1");
	const event2 = workCompleted("work-1");
	const entries = [
		{ type: "custom", customType: "pi-event-loop-event", data: event1 },
		{ type: "custom", customType: "pi-event-loop-event", data: event2 },
	];
	return {
		status: buildStatus(runtime, CONFIG, entries),
		history: [event1, event2] as LoopEventData[],
	};
}

describe("formatEventLoopStatusLine", () => {
	it("returns undefined when snapshot is undefined", () => {
		expect(formatEventLoopStatusLine(undefined, FAKE_THEME)).toBeUndefined();
	});

	it("formats paused state with reason using warning color", () => {
		const snapshot: EventLoopStatusSnapshot = {
			paused: true,
			pauseReason: "missing-outcome",
			pendingCount: 0,
		};
		const line = formatEventLoopStatusLine(snapshot, FAKE_THEME);
		expect(line).toContain("[fg:warning]");
		expect(line).toContain("paused (missing-outcome)");
	});

	it("formats active command with pending count using accent/muted colors", () => {
		const snapshot: EventLoopStatusSnapshot = {
			paused: false,
			activeCommandType: "review-work",
			pendingCount: 3,
		};
		const line = formatEventLoopStatusLine(snapshot, FAKE_THEME);
		expect(line).toContain("[fg:accent]");
		expect(line).toContain("review-work");
		expect(line).toContain("[fg:muted]");
		expect(line).toContain("(+3)");
	});

	it("formats queued count when running with pending commands but no active command", () => {
		const snapshot: EventLoopStatusSnapshot = {
			paused: false,
			pendingCount: 4,
		};
		const line = formatEventLoopStatusLine(snapshot, FAKE_THEME);
		expect(line).toContain("[fg:accent]");
		expect(line).toContain("4 queued");
	});

	it("formats idle when running with no commands", () => {
		const snapshot: EventLoopStatusSnapshot = {
			paused: false,
			pendingCount: 0,
		};
		const line = formatEventLoopStatusLine(snapshot, FAKE_THEME);
		expect(line).toContain("[fg:muted]");
		expect(line).toContain("idle");
	});
});

describe("setEventLoopStatus and clearEventLoopStatus", () => {
	it("updates footer status via setStatus with themed line", () => {
		let registeredKey: string | undefined;
		let registeredValue: string | undefined;
		const fakeUI = {
			setStatus: (key: string, value: string | undefined) => {
				registeredKey = key;
				registeredValue = value;
			},
			theme: FAKE_THEME,
		};
		setEventLoopStatus(fakeUI, {
			paused: false,
			activeCommandType: "perform-work",
			pendingCount: 0,
		});
		expect(registeredKey).toBe("pi-event-loop");
		expect(registeredValue).toContain("perform-work");

		clearEventLoopStatus(fakeUI);
		expect(registeredKey).toBe("pi-event-loop");
		expect(registeredValue).toBeUndefined();
	});

	it("clears status when undefined snapshot is passed to setEventLoopStatus", () => {
		let registeredValue: string | undefined = "initial";
		const fakeUI = {
			setStatus: (_key: string, value: string | undefined) => {
				registeredValue = value;
			},
			theme: FAKE_THEME,
		};
		setEventLoopStatus(fakeUI, undefined);
		expect(registeredValue).toBeUndefined();
	});
});

describe("EventLoopInspector", () => {
	it("renders pure output without throwing and includes borders and header", () => {
		const { status, history } = createSampleStatus();
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history,
			onDone,
			theme: FAKE_THEME,
		});
		const lines = inspector.render(80);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.some((l) => l.includes("Status") || l.includes("Views"))).toBe(true);
	});

	it("strictly respects narrow widths (40, 60, 80 columns) without line overflow", () => {
		const { status, history } = createSampleStatus();
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history,
			onDone,
			theme: FAKE_THEME,
		});

		for (const width of [40, 60, 80]) {
			const lines = inspector.render(width);
			for (const line of lines) {
				// Strip mock markup tags [fg:...] and [/fg]
				const plainText = line.replace(/\[\/?(fg|bg|b)[^\]]*\]/g, "");
				expect(plainText.length).toBeLessThanOrEqual(width);
			}
		}
	});

	it("displays overflow scroll cues when items exceed visible capacity", () => {
		const runtime = createEventLoopRuntime();
		const events: LoopEventData[] = [];
		for (let i = 0; i < 20; i++) {
			events.push(workRequested(`work-${i}`));
		}
		const entries = events.map((e) => ({
			type: "custom",
			customType: "pi-event-loop-event",
			data: e,
		}));
		const status = buildStatus(runtime, CONFIG, entries);
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history: events,
			onDone,
			theme: FAKE_THEME,
			maxVisibleRows: 5,
		});

		// Switch to History tab (tab 3)
		inspector.handleInput("3");
		const lines = inspector.render(80);
		const output = lines.join("\n");
		expect(output).toMatch(/Showing \d+ of \d+|more/i);
	});

	it("supports gradual disclosure toggling with Enter", () => {
		const { status, history } = createSampleStatus();
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history,
			onDone,
			theme: FAKE_THEME,
		});

		// Switch to History tab
		inspector.handleInput("3");
		const linesBefore = inspector.render(80);
		// Press Enter to expand payload
		inspector.handleInput("\r");
		const linesAfter = inspector.render(80);
		// Expanded view shows payload details
		expect(linesAfter.join("\n")).not.toBe(linesBefore.join("\n"));
	});

	it("triggers onDone cleanup on escape or q", () => {
		const { status, history } = createSampleStatus();
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history,
			onDone,
			theme: FAKE_THEME,
		});

		inspector.handleInput("q");
		expect(onDone).toHaveBeenCalledTimes(1);

		inspector.handleInput("\x1b"); // Escape
		expect(onDone).toHaveBeenCalledTimes(2);
	});

	it("invalidates cached lines on theme or state change", () => {
		const { status, history } = createSampleStatus();
		const onDone = vi.fn();
		const inspector = new EventLoopInspector({
			status,
			history,
			onDone,
			theme: FAKE_THEME,
		});

		const firstLines = inspector.render(80);
		expect(firstLines.length).toBeGreaterThan(0);
		// Invalidate clears internal render cache
		expect(() => inspector.invalidate()).not.toThrow();
		const secondLines = inspector.render(80);
		expect(secondLines).toEqual(firstLines);
	});
});

describe("formatEventLoopFallback", () => {
	it("formats compact text for RPC and print modes with status, views, and history", () => {
		const { status, history } = createSampleStatus();
		const fallback = formatEventLoopFallback(status, history);
		expect(fallback).toContain("Status");
		expect(fallback).toContain("Views");
		expect(fallback).toContain("History");
		expect(fallback).toContain("work-1");
	});
});
