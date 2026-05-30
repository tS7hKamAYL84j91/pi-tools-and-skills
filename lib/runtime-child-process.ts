/** Shared runtime child-process substrate for Panopticon-owned execution. */

import { spawn } from "node:child_process";

export interface RuntimeEntityRef {
	readonly id: string;
	readonly kind: "agent" | "team_run" | "child_process";
}

export interface RuntimeChildProcessRequest {
	readonly parent?: RuntimeEntityRef;
	readonly label: string;
	readonly command: string;
	readonly args: string[];
	readonly cwd: string;
	readonly env?: Record<string, string>;
	readonly signal?: AbortSignal;
}

export interface RuntimeChildProcessResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly durationMs: number;
	readonly exitCode: number | null;
	readonly ok: boolean;
	readonly error?: string;
}

/**
 * Spawn a bounded child process under the Panopticon runtime substrate.
 *
 * This is intentionally narrow: it centralizes spawn/abort/kill behavior without
 * importing team protocol semantics into Panopticon.
 */
export function spawnRuntimeChildProcess(
	request: RuntimeChildProcessRequest,
): Promise<RuntimeChildProcessResult> {
	const startedAt = Date.now();

	return new Promise((resolve) => {
		const child = spawn(request.command, request.args, {
			cwd: request.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				...request.env,
			},
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (ok: boolean, exitCode: number | null, error?: string) => {
			if (settled) return;
			settled = true;
			request.signal?.removeEventListener("abort", abort);
			resolve({
				stdout,
				stderr,
				durationMs: Date.now() - startedAt,
				exitCode,
				ok,
				...(error ? { error } : {}),
			});
		};
		const abort = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				// Best effort: the child may already have exited.
			}
			finish(false, null, "cancelled");
		};

		request.signal?.addEventListener("abort", abort, { once: true });
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => finish(false, null, error.message));
		child.on("close", (code) => {
			finish(code === 0, code, code === 0 ? undefined : `${request.label} exited with code ${code}`);
		});
	});
}
