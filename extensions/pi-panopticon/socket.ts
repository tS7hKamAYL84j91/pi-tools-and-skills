/**
 * Unix socket server for pi agents.
 *
 * Minimal socket interface — only handles "peek" commands to read session logs.
 * The server accepts connections and reads newline-delimited JSON commands.
 */

import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { readSessionLog } from "../../lib/session-log.js";

// ── Constants ───────────────────────────────────────────────────

const SOCKET_TIMEOUT_MS = 3_000;

// ── Types ───────────────────────────────────────────────────────

interface SocketCommand {
	type: "peek";
	lines?: number;
}

// ── SocketServer class ──────────────────────────────────────────

export default class SocketServer {
	private server: net.Server | null = null;
	private socketPath: string | null = null;

	/**
	 * Start the Unix socket server.
	 * @param socketPath - Path where the socket file will be created
	 * @param getSessionFile - Callback to get the current session file path
	 */
	start(socketPath: string, getSessionFile: () => string | undefined): void {
		try {
			// Clean up stale socket file
			if (existsSync(socketPath)) {
				try {
					unlinkSync(socketPath);
				} catch {
					/* ignore */
				}
			}

			this.socketPath = socketPath;

			this.server = net.createServer({ allowHalfOpen: true }, (conn) => {
				let buf = "";
				conn.setTimeout(SOCKET_TIMEOUT_MS);

				conn.on("data", (chunk) => {
					buf += chunk.toString();
					const nlIdx = buf.indexOf("\n");
					if (nlIdx !== -1) {
						const line = buf.slice(0, nlIdx).trim();
						buf = buf.slice(nlIdx + 1);

						try {
							const cmd = JSON.parse(line) as SocketCommand;
							this.handleCommand(cmd, conn, getSessionFile);
						} catch {
							conn.end(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
						}
					}
				});

				conn.on("timeout", () => conn.destroy());
				conn.on("error", () => {
					/* ignore */
				});
			});

			this.server.listen(socketPath);

			this.server.on("error", () => {
				this.server = null;
				// Remove stale socket file so retries can rebind
				try {
					if (this.socketPath && existsSync(this.socketPath)) {
						unlinkSync(this.socketPath);
					}
				} catch {
					/* ignore */
				}
			});

			// Don't keep the process alive for the socket server alone
			this.server.unref();
		} catch {
			this.server = null;
		}
	}

	/**
	 * Stop the socket server and clean up.
	 * Idempotent — safe to call multiple times.
	 */
	stop(): void {
		if (this.server) {
			try {
				this.server.close();
			} catch {
				/* ignore */
			}
			this.server = null;
		}

		if (this.socketPath) {
			try {
				unlinkSync(this.socketPath);
			} catch {
				/* ignore */
			}
			this.socketPath = null;
		}
	}

	/**
	 * Check if the server is currently running.
	 */
	isRunning(): boolean {
		return this.server !== null;
	}

	// ── Private ─────────────────────────────────────────────────

	private handleCommand(cmd: SocketCommand, conn: net.Socket, getSessionFile: () => string | undefined): void {
		const reply = (payload: object) => conn.end(`${JSON.stringify(payload)}\n`);

		switch (cmd.type) {
			case "peek": {
				const sessionFile = getSessionFile();
				const events = sessionFile ? readSessionLog(sessionFile, cmd.lines ?? 50) : [];
				reply({ ok: true, events });
				break;
			}
			default:
				reply({ ok: false, error: `Unknown command: ${cmd.type}` });
		}
	}
}
