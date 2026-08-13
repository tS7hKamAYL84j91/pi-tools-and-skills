import { spawn } from "node:child_process";

const MAX_CAPTURED_OUTPUT_BYTES = 256 * 1024;
const KILL_GRACE_MS = 250;
const TASKKILL_TIMEOUT_MS = 500;
const OUTPUT_TRUNCATION_MARKER = Buffer.from("\n[output truncated]\n");
const MAX_CAPTURED_CONTENT_BYTES = MAX_CAPTURED_OUTPUT_BYTES - OUTPUT_TRUNCATION_MARKER.length;

export interface RuntimeEntityRef { readonly id: string; readonly kind: "agent" | "team_run" | "child_process"; }

export interface RuntimeChildProcessRequest {
	readonly parent?: RuntimeEntityRef;
	readonly label: string;
	readonly command: string;
	readonly args: string[];
	readonly cwd: string;
	readonly env?: Record<string, string>;
	readonly stdin?: string;
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

interface BoundedOutput { readonly chunks: Buffer[]; bytes: number; truncated: boolean; }

function appendOutput(output: BoundedOutput, chunk: Buffer): void {
	const remaining = MAX_CAPTURED_CONTENT_BYTES - output.bytes;
	if (remaining > 0) {
		const captured = chunk.subarray(0, remaining);
		output.chunks.push(captured);
		output.bytes += captured.length;
	}
	if (chunk.length > remaining) output.truncated = true;
}

function renderOutput(output: BoundedOutput): string {
	const content = Buffer.concat(output.chunks, output.bytes);
	return output.truncated
		? Buffer.concat([content, OUTPUT_TRUNCATION_MARKER], MAX_CAPTURED_OUTPUT_BYTES).toString("utf8")
		: content.toString("utf8");
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function killDirectChild(child: ReturnType<typeof spawn>): void {
	try {
		child.kill("SIGKILL");
	} catch {
		// Best effort: the direct child may already have exited.
	}
}

function terminateWindowsProcessTree(child: ReturnType<typeof spawn>, pid: number): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		let timeout: NodeJS.Timeout | undefined;
		const finish = (fallback: boolean) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (fallback) killDirectChild(child);
			resolve();
		};
		let killer: ReturnType<typeof spawn>;
		try {
			killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} catch {
			finish(true);
			return;
		}
		timeout = setTimeout(() => {
			killDirectChild(killer);
			finish(true);
		}, TASKKILL_TIMEOUT_MS);
		killer.once("error", () => finish(true));
		killer.once("close", (code) => finish(code !== 0));
	});
}

async function terminatePosixProcessTree(pid: number): Promise<void> {
	try {
		process.kill(-pid, "SIGTERM");
	} catch (error) {
		if (hasErrorCode(error, "ESRCH")) return;
	}
	await new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS));
	try {
		// The process group id remains valid while any original descendant survives.
		process.kill(-pid, "SIGKILL");
	} catch {
		// Best effort: the process group may have exited during the grace period.
	}
}

function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
	const pid = child.pid;
	if (pid === undefined) return Promise.resolve();
	return process.platform === "win32"
		? terminateWindowsProcessTree(child, pid)
		: terminatePosixProcessTree(pid);
}

function immediateResult(startedAt: number, error: string): RuntimeChildProcessResult {
	return { stdout: "", stderr: "", durationMs: Date.now() - startedAt, exitCode: null, ok: false, error };
}

/** Spawn a bounded child process under the Panopticon runtime substrate. */
export function spawnRuntimeChildProcess(
	request: RuntimeChildProcessRequest,
): Promise<RuntimeChildProcessResult> {
	const startedAt = Date.now();
	if (request.signal?.aborted) return Promise.resolve(immediateResult(startedAt, "cancelled"));

	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(request.command, request.args, {
				cwd: request.cwd,
				detached: process.platform !== "win32",
				stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
				env: {
					...process.env,
					...request.env,
				},
			});
		} catch (error) {
			resolve(immediateResult(startedAt, (error as Error).message));
			return;
		}

		const stdout: BoundedOutput = { chunks: [], bytes: 0, truncated: false };
		const stderr: BoundedOutput = { chunks: [], bytes: 0, truncated: false };
		let settled = false;
		let cancelled = false;
		const finish = (ok: boolean, exitCode: number | null, error?: string) => {
			if (settled) return;
			settled = true;
			request.signal?.removeEventListener("abort", abort);
			resolve({
				stdout: renderOutput(stdout),
				stderr: renderOutput(stderr),
				durationMs: Date.now() - startedAt,
				exitCode,
				ok,
				...(error ? { error } : {}),
			});
		};
		const abort = () => {
			if (cancelled || settled) return;
			cancelled = true;
			terminateProcessTree(child).then(
				() => finish(false, null, "cancelled"),
				() => {
					killDirectChild(child);
					finish(false, null, "cancelled");
				},
			);
		};

		child.stdout?.on("data", (chunk: Buffer) => appendOutput(stdout, chunk));
		child.stderr?.on("data", (chunk: Buffer) => appendOutput(stderr, chunk));
		child.on("error", (error) => {
			if (!cancelled) {
				finish(false, null, error.message);
			} else if (child.pid === undefined) {
				// A failed spawn has no child close to await.
				finish(false, null, "cancelled");
			}
		});
		child.on("close", (code) => {
			if (!cancelled) {
				finish(code === 0, code, code === 0 ? undefined : `${request.label} exited with code ${code}`);
			}
		});
		request.signal?.addEventListener("abort", abort, { once: true });
		if (request.signal?.aborted) abort();
		if (request.stdin !== undefined) child.stdin?.end(request.stdin);
	});
}
