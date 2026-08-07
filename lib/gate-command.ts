/**
 * Shared autonomous gate runner.
 *
 * The gate runs a user-supplied command and returns a bounded result so the
 * caller can surface an actionable error without leaking full unbounded output.
 */
import { spawnRuntimeChildProcess } from "./runtime-child-process.js";

const MAX_OUTPUT_CHARS = 2_000;

export interface GateResult {
	readonly passed: boolean;
	readonly command: string;
	readonly exitCode: number;
	readonly stdoutSummary: string;
	readonly stderrSummary: string;
}

function boundedSummary(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	const head = text.slice(0, MAX_OUTPUT_CHARS / 2);
	const tail = text.slice(-MAX_OUTPUT_CHARS / 2);
	return `${head}\n... [${text.length - MAX_OUTPUT_CHARS} chars truncated] ...\n${tail}`;
}

export async function runGateCommand(command: string, cwd: string, signal?: AbortSignal): Promise<GateResult> {
	if (!command.trim()) {
		return {
			passed: false,
			command,
			exitCode: -1,
			stdoutSummary: "",
			stderrSummary: "gate_command must be a non-empty string",
		};
	}
	const result = await spawnRuntimeChildProcess({
		label: "autonomous gate",
		command: process.platform === "win32" ? "cmd" : "sh",
		args: process.platform === "win32" ? ["/c", command] : ["-c", command],
		cwd,
		signal,
	});
	return {
		passed: result.ok && result.exitCode === 0,
		command,
		exitCode: result.exitCode ?? -1,
		stdoutSummary: boundedSummary(result.stdout),
		stderrSummary: boundedSummary(result.stderr),
	};
}
