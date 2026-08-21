/** Default model runner executing one-shot pi CLI child processes for cognitive deliberation. */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnRuntimeChildProcess } from "../../../lib/runtime-child-process.js";
import type {
	CognitiveModelRunner,
	CognitiveModelRunnerInput,
	CognitiveModelRunnerResult,
} from "./cognitive-types.js";

/** Locate the pi CLI binary on the current system. */
function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) {
		return candidate;
	}
	const allowedDirs = [
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
		join(homedir(), ".local", "bin"),
	];
	for (const dir of allowedDirs) {
		const resolved = join(dir, "pi");
		if (existsSync(resolved)) {
			return resolved;
		}
	}
	return "pi";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function assistantTextFromMessage(value: unknown): string | undefined {
	const message = asRecord(value);
	if (message?.role !== "assistant") {
		return undefined;
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const parts = content
		.map((entry) => {
			const item = asRecord(entry);
			return item?.type === "text" && typeof item.text === "string"
				? item.text
				: undefined;
		})
		.filter((part): part is string => part !== undefined);
	return parts.length > 0 ? parts.join("\n") : undefined;
}

function finalAssistantTextFromEvent(value: unknown): string | undefined {
	const event = asRecord(value);
	if (!event) {
		return undefined;
	}
	if (event.type === "agent_end" && Array.isArray(event.messages)) {
		for (const message of [...event.messages].reverse()) {
			const text = assistantTextFromMessage(message);
			if (text !== undefined) {
				return text;
			}
		}
	}
	if (
		(event.type === "message_end" || event.type === "turn_end") &&
		"message" in event
	) {
		return assistantTextFromMessage(event.message);
	}
	return assistantTextFromMessage(event);
}

/** Extract final assistant text from JSONL or raw stdout emitted by `pi --print`. */
export function extractPiPrintOutput(stdout: string): string {
	let finalAssistantText: string | undefined;
	let sawJsonEvent = false;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
			continue;
		}
		try {
			const text = finalAssistantTextFromEvent(JSON.parse(trimmed));
			if (text !== undefined) {
				finalAssistantText = text;
				sawJsonEvent = true;
			}
		} catch {
			// Non-JSON stdout falls through to text mode.
		}
	}
	return (sawJsonEvent ? (finalAssistantText ?? "") : stdout).trim();
}

/** Default CognitiveModelRunner that runs stateless `pi --print` child processes. */
export const defaultCognitiveModelRunner: CognitiveModelRunner = async (
	input: CognitiveModelRunnerInput,
): Promise<CognitiveModelRunnerResult> => {
	const args = [
		"--print",
		"--model",
		input.model,
		"--no-tools",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-session",
		"--system-prompt",
		input.systemPrompt,
	];

	const controller = new AbortController();
	const timeout = input.timeoutMs
		? setTimeout(() => controller.abort(), input.timeoutMs)
		: undefined;
	const onSignalAbort = () => controller.abort();
	input.signal?.addEventListener("abort", onSignalAbort, { once: true });
	if (input.signal?.aborted) {
		controller.abort();
	}

	try {
		const result = await spawnRuntimeChildProcess({
			label: `cognitive boost query: ${input.model}`,
			command: resolvePiBinary(),
			args,
			cwd: input.cwd ?? process.cwd(),
			stdin: input.prompt,
			signal: controller.signal,
			env: {
				COAS_PI_LOCKFILE_CONTINUE: "1",
			},
		});
		const output = extractPiPrintOutput(result.stdout);
		const stderr = result.stderr.trim();
		if (result.ok && !output.trim()) {
			return {
				ok: false,
				output: "",
				durationMs: result.durationMs,
				error: stderr
					? `pi model process produced empty output; stderr: ${stderr}`
					: "pi model process produced empty output",
			};
		}
		return {
			ok: result.ok,
			output,
			durationMs: result.durationMs,
			...(result.ok ? {} : { error: stderr || result.error }),
		};
	} catch (err) {
		const message =
			controller.signal.aborted && !input.signal?.aborted
				? "timeout"
				: err instanceof Error
					? err.message
					: String(err);
		return {
			ok: false,
			output: "",
			durationMs: 0,
			error: message,
		};
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		input.signal?.removeEventListener("abort", onSignalAbort);
	}
};
