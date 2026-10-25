/**
 * Cockpit transcript reducer tests: delta reconstruction, authoritative
 * replacements, tool lifecycle, queue/retry state, and error visibility.
 */
import { describe, expect, it } from "vitest";

import { CockpitTranscript, projectMessageContent } from "../../pi-cockpit/conversation.ts";

describe("projectMessageContent", () => {
	it("joins text and thinking blocks", () => {
		expect(
			projectMessageContent([
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "answer" },
				{ type: "image", data: "x", mimeType: "image/png" },
			]),
		).toEqual({ text: "answer", thinking: "hmm" });
	});

	it("passes a plain string through", () => {
		expect(projectMessageContent("hi")).toEqual({ text: "hi", thinking: "" });
	});

	it("ignores malformed content", () => {
		expect(projectMessageContent(null)).toEqual({ text: "", thinking: "" });
	});
});

describe("cockpit transcript", () => {
	it("reconstructs streamed text and replaces it with the authoritative message", () => {
		const transcript = new CockpitTranscript();
		transcript.apply({ type: "agent_start" });
		transcript.apply({ type: "message_start", message: { role: "assistant", content: [] } });
		transcript.apply({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
		});
		transcript.apply({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo" },
		});
		expect(transcript.rowsView[0]?.text).toBe("Hello");
		expect(transcript.rowsView[0]?.streaming).toBe(true);

		transcript.apply({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
		});
		expect(transcript.rowsView[0]?.text).toBe("Hello!");
		expect(transcript.rowsView[0]?.streaming).toBe(false);
	});

	it("tracks tool execution by toolCallId", () => {
		const transcript = new CockpitTranscript();
		transcript.apply({
			type: "tool_execution_start",
			toolCallId: "call-9",
			toolName: "bash",
			args: { command: "ls" },
		});
		const row = transcript.rowsView.find((entry) => entry.tool?.toolCallId === "call-9");
		expect(row?.tool?.status).toBe("running");

		transcript.apply({
			type: "tool_execution_end",
			toolCallId: "call-9",
			result: { content: [{ type: "text", text: "file.txt" }] },
			isError: true,
			durationMs: 40,
		});
		expect(row?.tool?.status).toBe("error");
		expect(row?.tool?.durationMs).toBe(40);
		expect(row?.text).toBe("file.txt");
	});

	it("adds a tool row from toolcall_end when no execution event arrived yet", () => {
		const transcript = new CockpitTranscript();
		transcript.apply({ type: "message_start", message: { role: "assistant", content: [] } });
		transcript.apply({
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { id: "call-2", name: "read", arguments: { path: "a.ts" } },
			},
		});
		const row = transcript.rowsView.find((entry) => entry.tool?.toolCallId === "call-2");
		expect(row?.tool?.name).toBe("read");
		expect(row?.tool?.args).toContain("a.ts");
	});

	it("records queued inputs, retry, compaction, and session name", () => {
		const transcript = new CockpitTranscript();
		transcript.apply({ type: "queue_update", steering: ["s1"], followUp: ["f1", "f2"] });
		transcript.apply({ type: "auto_retry_start", attempt: 1 });
		transcript.apply({ type: "compaction_start", reason: "threshold" });
		transcript.apply({ type: "session_info_changed", name: "named" });

		const state = transcript.runState;
		expect(state.queued).toEqual({ steering: ["s1"], followUp: ["f1", "f2"] });
		expect(state.retrying).toBe(true);
		expect(state.compacting).toBe(true);
		expect(state.sessionName).toBe("named");

		transcript.apply({ type: "auto_retry_end", success: false, finalError: "529" });
		transcript.apply({ type: "compaction_end", aborted: true });
		expect(transcript.runState.retrying).toBe(false);
		expect(transcript.runState.compacting).toBe(false);
		expect(transcript.runState.lastError).toBe("529");
	});

	it("clears streaming on agent_settled and ignores unknown records", () => {
		const transcript = new CockpitTranscript();
		transcript.apply({ type: "agent_start" });
		expect(transcript.runState.streaming).toBe(true);
		transcript.apply({ type: "agent_settled", aborted: false });
		expect(transcript.runState.streaming).toBe(false);

		const before = transcript.rowsView.length;
		transcript.apply({ type: "totally_unknown_event" });
		expect(transcript.rowsView.length).toBe(before);
	});

	it("surfaces errors as visible rows", () => {
		const transcript = new CockpitTranscript();
		transcript.noteError("protocol parse error");
		expect(transcript.runState.lastError).toBe("protocol parse error");
		expect(transcript.rowsView.at(-1)?.role).toBe("error");
	});
});