/**
 * M6 daemon-client (design doc section 7): the pi-panopticon read-only
 * consumer of the daemon registry, behind COAS_DAEMON_ENABLED=1 (ADR-0009
 * deny-by-default). Connects to the daemon socket, completes the
 * hello -> challenge -> proof -> subscribe handshake (capability possession,
 * never caller-supplied identity), then maintains the registry view from the
 * atomic snapshot plus per-change events using the daemon's
 * RegistryEventBuffer overlap rules: buffer until the snapshot is applied,
 * drop events with seq <= the snapshot's seq, apply in order, resync only on
 * a true gap (seq > expected + 1).
 */
import { createConnection } from "node:net";
import { capabilityProof } from "../../../daemon/src/admission.js";
import {
	encodeWireMessage,
	parseWireMessage,
	type RegistrySyncConnection,
	type RegistrySyncRequest,
} from "../../../daemon/src/registry-protocol.js";
import { RegistryEventBuffer, type RegistryEntry } from "../../../daemon/src/registry.js";

/** Reconnect backoff shares the M2 bounded ladder (1s doubling, 60s cap). */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 60_000;
/** A connection alive at least this long is stable: the ladder resets. */
const STABLE_CONNECTION_MS = 60_000;

interface DaemonRegistryClientOptions {
	readonly socketPath: string;
	/** Admission credential issued out-of-band at daemon admission. */
	readonly credential: { readonly agentId: string; readonly capabilitySecret: string };
	/** Injectable connect (tests); defaults to a node:net unix socket. */
	readonly connect?: (
		path: string,
		handlers: { readonly onLine: (line: string) => void; readonly onClose: () => void },
	) => RegistrySyncConnection;
	readonly now?: () => Date;
}

/**
 * Read-only daemon registry client: holds the current registry entries,
 * applies the snapshot/event overlap rules locally, and resyncs on a true
 * gap. When COAS_DAEMON_ENABLED is unset the caller never constructs or
 * starts this client, so the incumbent registry path stays byte-for-byte.
 */
export class DaemonRegistryClient {
	private readonly entries = new Map<string, RegistryEntry>();
	private readonly pendingEntries = new Map<number, RegistryEntry>();
	private readonly buffer: RegistryEventBuffer;
	private connection: RegistrySyncConnection | undefined;
	private stage: "disconnected" | "handshaking" | "subscribed" = "disconnected";
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private connectedAtMs = 0;
	private lastSeq = 0;
	private readonly connect: NonNullable<DaemonRegistryClientOptions["connect"]>;
	private readonly now: () => Date;

	constructor(private readonly options: DaemonRegistryClientOptions) {
		// Every applied event patches the local view from the delta payload the
		// daemon attached to the event message (post-mutation registry entry).
		this.buffer = new RegistryEventBuffer((event) => {
			const entry = this.pendingEntries.get(event.seq);
			if (entry === undefined) return;
			this.entries.set(entry.agentId, entry);
			this.pendingEntries.delete(event.seq);
			this.lastSeq = Math.max(this.lastSeq, event.seq);
		});
		this.connect =
			options.connect ??
			((path, handlers): RegistrySyncConnection => {
				const socket = createConnection(path);
				let remainder = "";
				socket.on("data", (chunk: Buffer) => {
					remainder = splitLines(remainder + chunk.toString("utf8"), handlers.onLine);
				});
				socket.on("close", () => handlers.onClose());
				return {
					send: (line: string): void => {
						socket.write(line);
					},
					close: (): void => {
						socket.destroy();
					},
				};
			});
		this.now = options.now ?? ((): Date => new Date());
	}

	/** Connect and run the handshake; reconnection is bounded and automatic. */
	start(): void {
		this.stopped = false;
		this.connectOnce();
	}

	stop(): void {
		this.stopped = true;
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.connection?.close();
		this.connection = undefined;
		this.stage = "disconnected";
	}

	/** Current registry entries (last snapshot + applied event deltas). */
	getEntries(): RegistryEntry[] {
		return [...this.entries.values()];
	}

	get connected(): boolean {
		return this.connection !== undefined && this.stage === "subscribed";
	}

	private connectOnce(): void {
		if (this.stopped) return;
		const connection = this.connect(this.options.socketPath, {
			onLine: (line) => {
				void this.dispatchLine(line);
			},
			onClose: (): void => {
				this.onDisconnected();
			},
		});
		this.connection = connection;
		this.stage = "handshaking";
		this.connectedAtMs = this.now().getTime();
		connection.send(encodeWireMessage({ op: "hello", agentId: this.options.credential.agentId }));
	}

	private onDisconnected(): void {
		this.connection = undefined;
		this.stage = "disconnected";
		if (this.stopped || this.reconnectTimer !== undefined) return;
		// Stability resets the ladder; rapid disconnects escalate to the cap.
		const stable = this.now().getTime() - this.connectedAtMs >= STABLE_CONNECTION_MS;
		this.reconnectAttempts = stable ? 1 : this.reconnectAttempts + 1;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_CAP_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.stopped) this.connectOnce();
		}, delay);
	}

	private async dispatchLine(line: string): Promise<void> {
		const message = parseWireMessage(line);
		if (!message) return;
		switch (message.op) {
			case "challenge": {
				this.stage = "handshaking";
				const proof = capabilityProof(this.options.credential.capabilitySecret, message.nonce);
				this.connection?.send(encodeWireMessage({ op: "hello_proof", agentId: this.options.credential.agentId, proof: proof.toString("base64") }));
				return;
			}
			case "hello_ok": {
				this.stage = "subscribed";
				this.sendRequest({ op: "subscribe", lastSeq: this.lastSeq });
				return;
			}
			case "hello_rejected": {
				// Fail-closed on the daemon side; drop and let the ladder retry.
				this.connection?.close();
				return;
			}
			case "snapshot": {
				this.replaceEntries(message.entries);
				this.buffer.applySnapshot({ seq: message.seq, generatedAt: "", entries: message.entries });
				this.lastSeq = message.seq;
				this.stage = "subscribed";
				return;
			}
			case "event": {
				if (message.entry !== undefined) this.pendingEntries.set(message.seq, message.entry);
				const status = this.buffer.applyEvent({ seq: message.seq, at: "", kind: message.kind, agentId: message.agentId });
				if (status === "resync") this.resubscribe();
				return;
			}
			case "hello":
			case "hello_proof":
			case "subscribe":
				// Daemon ops never originate from the client side of the wire.
				return;
		}
	}

	private replaceEntries(entries: readonly RegistryEntry[]): void {
		this.entries.clear();
		for (const entry of entries) this.entries.set(entry.agentId, entry);
	}

	/** Re-subscribe: a fresh atomic snapshot is the authority after a gap. */
	private resubscribe(): void {
		if (this.connection === undefined || this.stage !== "subscribed") return;
		this.sendRequest({ op: "subscribe", lastSeq: this.lastSeq });
	}

	/** Send one client request line to the daemon. */
	private sendRequest(message: RegistrySyncRequest): void {
		this.connection?.send(encodeWireMessage(message));
	}
}

/** Split a chunk into complete newline-delimited lines; returns the remainder. */
function splitLines(chunk: string, onLine: (line: string) => void): string {
	let remainder = chunk;
	let newlineIndex = remainder.indexOf("\n");
	while (newlineIndex !== -1) {
		onLine(remainder.slice(0, newlineIndex));
		remainder = remainder.slice(newlineIndex + 1);
		newlineIndex = remainder.indexOf("\n");
	}
	return remainder;
}