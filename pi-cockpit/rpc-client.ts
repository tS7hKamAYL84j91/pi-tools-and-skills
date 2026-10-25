/**
 * Cockpit RPC transport.
 *
 * Speaks Pi's RPC protocol over a child process: strict JSONL framing on
 * stdout (split on LF only — never `readline`, which also splits on U+2028/
 * U+2029), backpressure-honouring writes on stdin, and stderr kept out of
 * protocol parsing.
 *
 * Side-effect safety: a command that was written but not yet answered when
 * the child disconnects is reported `uncertain`. Uncertain commands are never
 * retried automatically — the operator decides. A command attempted while
 * disconnected is refused outright rather than buffered.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** A protocol record from Pi. Kept structurally open; consumers narrow. */
export type RpcRecord = Record<string, unknown> & { type: string };

interface SendResult {
	id: string;
	/**
	 * `written`: accepted by the OS pipe (a reply may still never arrive).
	 * `refused`: not sent at all — the control channel was already down.
	 * `uncertain`: the write was attempted and failed, so the child may have
	 * acted. Uncertain sends are never retried automatically.
	 */
	outcome: "written" | "refused" | "uncertain";
	/** Human-readable reason for `refused` or `uncertain`. */
	reason?: string;
}

/**
 * Why the control channel ended. Each cause carries distinct policy:
 * - `exit`: the child process exited (fault unless the cockpit asked for it).
 * - `stdout-closed`: stdout ended without an exit event (half-close: control lost).
 * - `write-failed`: stdin write failed, so the child may or may not have acted.
 * - `spawn-error`: the child could not be started.
 * - `client-stop`: the cockpit deliberately shut the child down (not a fault).
 *
 * Stderr closing is deliberately NOT a disconnect: stderr is diagnostics only
 * and never carries protocol records.
 */
export type DisconnectCause =
	| "exit"
	| "stdout-closed"
	| "write-failed"
	| "spawn-error"
	| "client-stop";

export type CockpitEvent =
	| { kind: "record"; record: RpcRecord }
	| { kind: "stderr"; text: string }
	| { kind: "parse-error"; line: string; error: string }
	| {
			kind: "disconnected";
			cause: DisconnectCause;
			/** Faults are control losses the operator must resolve; client-stop is not one. */
			fault: boolean;
			reason: string;
			/** Command ids written but unanswered: their effect is unknown. */
			uncertainIds: string[];
			exitCode: number | null;
	  };

interface CockpitRpcOptions {
	/** Called for every event, in arrival order. */
	onEvent: (event: CockpitEvent) => void;
}

type Unsubscribe = () => void;

/** Stream flags that report a closed read side; absent on plain Readables while healthy. */
interface ClosedStreamFlags {
	destroyed?: boolean;
	readableEnded?: boolean;
	writableEnded?: boolean;
}

/** True once stdout can no longer deliver records (a closed or closing control channel). */
function stdoutEnded(stdout: unknown): boolean {
	const flags = stdout as ClosedStreamFlags;
	return flags.destroyed === true || flags.readableEnded === true || flags.writableEnded === true;
}

/**
 * Grace window so a real process exit (with code) wins over `stdout-closed`.
 * stdout 'end' arrives before 'exit'; this must comfortably exceed exit
 * latency on a loaded machine. Tests poll for the event, not for a tick count.
 */
const EXIT_GRACE_MS = 50;
/** Grace after SIGTERM before escalating to SIGKILL. */
const SIGKILL_GRACE_MS = 500;

/**
 * Owns one child process. Construction starts reading immediately; callers
 * must subscribe before sending any command to avoid missing fast replies.
 */
export class CockpitRpc {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly onEvent: (event: CockpitEvent) => void;
	private readonly stdoutDecoder = new StringDecoder("utf8");
	private stdoutBuffer = "";
	private pending = new Set<string>();
	private disconnected = false;
	/** Control channel is unusable; set before the cause is reported so sends are refused at once. */
	private controlLost = false;
	/** True while `stop()` is closing the child, so shutdown is not reported as a failure. */
	private stopping = false;
	// Facts accumulated from every source. The cause is resolved from these at
	// emit time, so event ordering ('end' before 'exit') cannot mislabel it.
	private spawnError: string | undefined;
	private writeError: string | undefined;
	private exitCode: number | null = null;
	private exitSignal: NodeJS.Signals | null = null;
	private disposeListeners: Unsubscribe = () => {};

	constructor(child: ChildProcessWithoutNullStreams, options: CockpitRpcOptions) {
		this.child = child;
		this.onEvent = options.onEvent;
		this.attach();
	}

	/** True once the child exited or its stdio closed. */
	get isDisconnected(): boolean {
		return this.disconnected;
	}

	/** Command ids written but unanswered (their effects are unknown). */
	unansweredIds(): string[] {
		return [...this.pending];
	}

	/**
	 * Write one command. Returns `refused` when the child is gone; never
	 * buffers, never retries. A write error after partial output is surfaced
	 * as a disconnect, which marks the command uncertain.
	 */
	send(command: Record<string, unknown>): SendResult {
		const id = typeof command.id === "string" ? command.id : `cmd-${Date.now()}`;
		if (this.disconnected || this.controlLost || !this.child.stdin.writable || stdoutEnded(this.child.stdout)) {
			return { id, outcome: "refused", reason: "agent process is not connected" };
		}
		this.pending.add(id);
		try {
			this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
			return { id, outcome: "written" };
		} catch (error) {
			// Unknown whether bytes reached the child: this is not a refusal.
			this.writeError = error instanceof Error ? error.message : String(error);
			this.concludeDisconnect("write-failed");
			return { id, outcome: "uncertain", reason: "write failed; effect unknown" };
		}
	}

	/** Reply to an `extension_ui_request` dialog. Responses are not commands. */
	respond(response: Record<string, unknown>): SendResult {
		return this.send({ ...response });
	}

	/**
	 * Orderly shutdown with a bounded, escalating kill path: close stdin, wait,
	 * then SIGTERM, wait a short grace, then SIGKILL. A child that traps SIGTERM
	 * must not leave the cockpit hanging or an orphan behind.
	 */
	async stop(timeoutMs = 3000): Promise<void> {
		if (this.disconnected) {
			this.disposeListeners();
			return;
		}
		this.stopping = true;
		try {
			this.child.stdin.end();
		} catch {
			// Already closed.
		}
		let exited = await this.waitForExit(timeoutMs);
		if (!exited) {
			this.child.kill("SIGTERM");
			exited = await this.waitForExit(SIGKILL_GRACE_MS);
		}
		if (!exited) {
			this.child.kill("SIGKILL");
			// Await the reap so callers know the child is actually gone.
			await this.waitForExit(SIGKILL_GRACE_MS);
		}
		this.concludeDisconnect("client-stop");
		this.disposeListeners();
	}

	/** Resolve true when the child exits within `ms`; removes its listener otherwise. */
	private waitForExit(ms: number): Promise<boolean> {
		if (this.child.exitCode !== null || this.child.signalCode !== null) {
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			const onExit = (): void => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this.child.off("exit", onExit);
				resolve(false);
			}, ms);
			this.child.once("exit", onExit);
		});
	}

	private attach(): void {
		const onStdout = (chunk: Buffer): void => {
			this.stdoutBuffer += this.stdoutDecoder.write(chunk);
			let newline = this.stdoutBuffer.indexOf("\n");
			while (newline !== -1) {
				const line = this.stdoutBuffer.slice(0, newline);
				this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
				this.handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
				newline = this.stdoutBuffer.indexOf("\n");
			}
		};
		const onStdoutEnd = (): void => {
			const rest = this.stdoutBuffer + this.stdoutDecoder.end();
			if (rest.length > 0) {
				this.handleLine(rest.endsWith("\r") ? rest.slice(0, -1) : rest);
			}
			this.stdoutBuffer = "";
			// The protocol channel is gone even if the child never emits `exit`
			// (e.g. it closed its stdout but kept the process alive). Reporting this
			// is what marks in-flight commands effects-UNKNOWN and refuses new sends.
			// Refuse sends immediately, but give a real process exit a short grace
			// window: stdout 'end' arrives before 'exit', and the exit cause carries
			// the exit code. A genuine half-close is concluded after the window.
			// The cause itself is resolved from accumulated facts at emit time.
			this.controlLost = true;
			setTimeout(() => this.concludeDisconnect("stdout-closed"), EXIT_GRACE_MS);
		};
		const onStderr = (chunk: Buffer): void => {
			this.onEvent({ kind: "stderr", text: chunk.toString("utf8") });
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
			this.exitCode = code;
			this.exitSignal = signal;
			this.concludeDisconnect("exit");
		};

		this.child.stdout.on("data", onStdout);
		this.child.stdout.on("end", onStdoutEnd);
		this.child.stderr.on("data", onStderr);
		this.child.on("exit", onExit);
		this.child.on("error", (error) => {
			this.spawnError = error.message;
			this.concludeDisconnect("spawn-error");
		});
		this.disposeListeners = () => {
			this.child.stdout.off("data", onStdout);
			this.child.stdout.off("end", onStdoutEnd);
			this.child.stderr.off("data", onStderr);
			this.child.off("exit", onExit);
		};
	}

	private handleLine(line: string): void {
		if (line.trim().length === 0) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			this.onEvent({
				kind: "parse-error",
				line,
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			this.onEvent({ kind: "parse-error", line, error: "record is not a JSON object" });
			return;
		}
		const record = parsed as RpcRecord;
		if (typeof record.type !== "string") {
			this.onEvent({ kind: "parse-error", line, error: "record has no string type" });
			return;
		}
		if (record.type === "response" && typeof record.id === "string") {
			this.pending.delete(record.id);
		}
		this.onEvent({ kind: "record", record });
	}

	/**
	 * Emit the one terminal event. `fallback` is used only when no stronger fact
	 * exists, so a real exit/spawn error is never masked by an earlier 'end'.
	 */
	private concludeDisconnect(fallback: DisconnectCause): void {
		if (this.disconnected) return;
		this.disconnected = true;
		this.controlLost = true;
		const uncertainIds = [...this.pending];
		this.pending.clear();
		const cause = this.resolveCause(fallback);
		this.onEvent({
			kind: "disconnected",
			cause,
			fault: cause !== "client-stop",
			reason: this.disconnectReason(cause),
			uncertainIds,
			exitCode: this.exitCode,
		});
	}

	/** Precedence: spawn error > intentional stop > real exit > triggering symptom. */
	private resolveCause(fallback: DisconnectCause): DisconnectCause {
		if (this.spawnError !== undefined) return "spawn-error";
		if (this.stopping) return "client-stop";
		if (this.exitCode !== null || this.exitSignal !== null) return "exit";
		return fallback;
	}

	private disconnectReason(cause: DisconnectCause): string {
		switch (cause) {
			case "spawn-error":
				return `spawn error: ${this.spawnError ?? "unknown"}`;
			case "exit":
				return `agent exited (code ${this.exitCode ?? "signal"})`;
			case "client-stop":
				return "stopped by cockpit";
			case "write-failed":
				return `write failed: ${this.writeError ?? "unknown"}`;
			case "stdout-closed":
				return "agent stdout closed";
		}
	}
}