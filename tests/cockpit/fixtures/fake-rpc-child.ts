#!/usr/bin/env node
/**
 * Deterministic fake Pi RPC child for cockpit transport tests.
 *
 * Speaks the documented JSONL protocol on stdout and never writes anything
 * else there. Behaviour is selected by argv[2]:
 *
 *   stream     (default) answer get_state, then stream one full agent run
 *   framing    emit CRLF-terminated and U+2028-containing records
 *   slow       answer get_state, then never respond to anything else
 *   die-on-prompt  answer get_state, then exit without answering a prompt
 *   stdout-close   answer get_state, then close stdout (keeping the process alive)
 *   stderr-close   answer get_state, then close stderr only and keep serving
 *   trap-sigterm   ignore SIGTERM and stdin EOF, so shutdown must escalate to SIGKILL
 *   noisy      write diagnostics to stderr alongside one valid record
 *   broken     emit a malformed JSON line before a valid record
 *   exit-early exit immediately without reading stdin
 */
import { closeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const mode = process.argv[2] ?? "stream";

function write(record: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(record)}\n`);
}

if (mode === "exit-early") {
	process.exit(0);
}

write({ type: "response", id: "boot", command: "get_state", success: true, data: { sessionName: "cockpit-test", isStreaming: false } });

const decoder = new StringDecoder("utf8");
let buffer = "";

function streamRun(promptText: string): void {
	write({ type: "agent_start" });
	write({ type: "turn_start" });
	write({ type: "message_start", message: { role: "user", content: promptText, timestamp: Date.now() } });
	write({ type: "message_end", message: { role: "user", content: promptText, timestamp: Date.now() } });
	write({ type: "message_start", message: { role: "assistant", content: [], stopReason: "pending" } });
	for (const delta of ["Hello", " from", " the", " fake", " agent"]) {
		write({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
	}
	write({
		type: "tool_execution_start",
		toolCallId: "call-1",
		toolName: "bash",
		args: { command: "echo hi" },
	});
	write({
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "bash",
		result: { content: [{ type: "text", text: "hi" }] },
		isError: false,
		durationMs: 12,
	});
	write({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Hello from the fake agent" }],
			stopReason: "stop",
		},
	});
	write({ type: "turn_end", message: { role: "assistant" }, toolResults: [] });
	write({ type: "agent_end", messages: [], willRetry: false });
	write({ type: "agent_settled", aborted: false });
}

function handleLine(line: string): void {
	let command: Record<string, unknown>;
	try {
		command = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return;
	}
	const id = typeof command.id === "string" ? command.id : undefined;
	const type = command.type;

	if (type === "get_state") {
		write({
			type: "response",
			...(id === undefined ? {} : { id }),
			command: "get_state",
			success: true,
			data: { sessionName: "cockpit-test", isStreaming: false },
		});
		return;
	}
	if (type === "prompt" && mode === "die-on-prompt") {
		process.exit(3);
	}
	if (type === "prompt" && mode === "stdout-close") {
		// Close the protocol channel but keep the process alive, so the client
		// sees stdout 'end' with no `exit` event.
		setTimeout(() => closeSync(1), 20);
		return;
	}
	if (type === "prompt" && mode !== "slow") {
		write({
			type: "response",
			...(id === undefined ? {} : { id }),
			command: "prompt",
			success: true,
			data: { disposition: "started" },
		});
		streamRun(typeof command.message === "string" ? command.message : "");
		return;
	}
	if (type === "extension_ui_response") {
		write({ type: "session_info_changed", name: `reply:${String(command.value ?? command.confirmed ?? "cancelled")}` });
		return;
	}
}

if (mode === "stderr-close") {
	closeSync(2);
}

if (mode === "trap-sigterm") {
	// A misbehaving child: ignore the polite shutdown request entirely. The
	// interval is what keeps the process alive after stdin EOF (a signal
	// listener alone does not hold the event loop open).
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1000);
}

if (mode === "noisy") {
	process.stderr.write("diagnostic that must never be parsed as protocol\n");
	write({ type: "session_info_changed", name: "after-noise" });
}

if (mode === "framing") {
	// LF framing must tolerate CRLF and must not split on U+2028/U+2029.
	process.stdout.write(
		`${JSON.stringify({ type: "session_info_changed", name: "line\u2028separator" })}\r\n`,
	);
	process.stdout.write(`${JSON.stringify({ type: "session_info_changed", name: "after-framing" })}\n`);
}

if (mode === "broken") {
	process.stdout.write("{not json}\n");
	write({ type: "session_info_changed", name: "after-broken" });
}

process.stdin.on("data", (chunk: Buffer) => {
	buffer += decoder.write(chunk);
	let newline = buffer.indexOf("\n");
	while (newline !== -1) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
		newline = buffer.indexOf("\n");
	}
});

process.stdin.on("end", () => {
	// trap-sigterm keeps running so the client must escalate to SIGKILL.
	if (mode !== "trap-sigterm") process.exit(0);
});