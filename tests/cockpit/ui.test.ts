/**
 * Cockpit UI tests: width-bounded text, header/status honesty about
 * disconnect and uncertain commands, and transcript viewport scrolling.
 */
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { CockpitTranscript } from "../../pi-cockpit/conversation.ts";
import {
	type ConnectionState,
	headerLines,
	statusLines,
	TranscriptView,
	wrapPlainText,
} from "../../pi-cockpit/ui.ts";

function expectBounded(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

function seededTranscript(): CockpitTranscript {
	const transcript = new CockpitTranscript();
	transcript.apply({ type: "message_start", message: { role: "user", content: "first question" } });
	transcript.apply({ type: "message_end", message: { role: "user", content: "first question" } });
	transcript.apply({ type: "message_start", message: { role: "assistant", content: [] } });
	transcript.apply({
		type: "message_update",
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "first answer" },
	});
	transcript.apply({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
	});
	return transcript;
}

describe("wrapPlainText", () => {
	it("wraps on spaces and hard-breaks long tokens", () => {
		expect(wrapPlainText("one two three", 7)).toEqual(["one two", "three"]);
		expect(wrapPlainText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("preserves explicit blank lines and returns nothing for zero width", () => {
		expect(wrapPlainText("a\n\nb", 10)).toEqual(["a", "", "b"]);
		expect(wrapPlainText("anything", 0)).toEqual([]);
	});
});

describe("header and status honesty", () => {
	for (const width of [80, 40]) {
		it(`stays width-bounded at ${width} columns when connected`, () => {
			const transcript = seededTranscript();
			const connection: ConnectionState = { kind: "connected" };
			const header = headerLines(
				{ workspace: "/tmp/a-deliberately/long/workspace/path", connection, transcript },
				width,
			);
			expect(header.join("\n")).toContain("connected");
			expectBounded(header, width);
			expectBounded(statusLines({ workspace: "/tmp/ws", connection, transcript }, width), width);
		});
	}

	it("shows the disconnect reason and the uncertain-command warning", () => {
		const transcript = seededTranscript();
		const connection: ConnectionState = {
			kind: "disconnected",
			cause: "exit",
			fault: true,
			reason: "agent exited (code 3)",
			uncertainIds: ["risky-1", "risky-2"],
		};
		const header = headerLines({ workspace: "/tmp/ws", connection, transcript }, 80);
		expect(header.join("\n")).toContain("disconnected (2 uncertain)");

		const status = statusLines({ workspace: "/tmp/ws", connection, transcript }, 80);
		// Compare visible text: styled line wraps legitimately split the sentence.
		const body = stripTerminalSequences(status.join(" "));
		expect(body).toContain("agent exited (code 3)");
		expect(body).toContain("not retried automatically");
	});

	it("does not warn about an intentional cockpit stop", () => {
		const transcript = seededTranscript();
		const connection: ConnectionState = {
			kind: "disconnected",
			cause: "client-stop",
			fault: false,
			reason: "stopped by cockpit",
			uncertainIds: [],
		};
		const header = headerLines({ workspace: "/tmp/ws", connection, transcript }, 80);
		expect(header.join("\n")).toContain("disconnected");
		const body = stripTerminalSequences(
			statusLines({ workspace: "/tmp/ws", connection, transcript }, 80).join(" "),
		);
		expect(body).not.toContain("stopped by cockpit");
	});

	it("shows the last error and a streaming-aware hint", () => {
		const transcript = seededTranscript();
		transcript.noteError("provider exploded");
		const connection: ConnectionState = { kind: "connected" };
		const idle = statusLines({ workspace: "/tmp/ws", connection, transcript }, 100).join("\n");
		expect(idle).toContain("provider exploded");
		expect(idle).toContain("enter send");

		transcript.apply({ type: "agent_start" });
		const streaming = statusLines({ workspace: "/tmp/ws", connection, transcript }, 100).join("\n");
		expect(streaming).toContain("esc abort");
	});
});

describe("TranscriptView viewport", () => {
	it("follows the tail and scrolls a bounded window", () => {
		const transcript = seededTranscript();
		for (let index = 0; index < 20; index += 1) {
			transcript.noteSystem(`note ${index}`);
		}
		const view = new TranscriptView(transcript);
		const tail = view.viewport(60, 5);
		expect(tail).toHaveLength(5);
		expect(tail.at(-1)).toContain("note 19");
		expect(view.followingTail).toBe(true);

		view.scrollUp(10);
		const scrolled = view.viewport(60, 5);
		expect(scrolled).toHaveLength(5);
		expect(scrolled.join("\n")).not.toContain("note 19");
		expect(view.followingTail).toBe(false);

		view.followTail();
		expect(view.viewport(60, 5).at(-1)).toContain("note 19");
	});

	it("renders a placeholder for an empty transcript", () => {
		const view = new TranscriptView(new CockpitTranscript());
		expect(view.viewport(60, 3).join("\n")).toContain("no messages yet");
	});

	it("never exceeds the requested width", () => {
		const transcript = seededTranscript();
		transcript.noteSystem("x".repeat(300));
		const view = new TranscriptView(transcript);
		for (const width of [80, 40, 20]) {
			expectBounded(view.viewport(width, 10), width);
		}
	});
});