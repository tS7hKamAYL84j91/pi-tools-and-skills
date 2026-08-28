/**
 * M6 registry sync protocol (design doc section 7): the JSON-line wire
 * contract shared by the daemon-side connection handler and the pi-panopticon
 * daemon-client. Handshake: hello -> challenge -> proof (capability
 * possession per ADR section 2) -> hello_ok -> subscribe -> one atomic
 * snapshot followed by per-change events with monotonically increasing seq.
 * Daemon-side failures (bad proof, unknown op, wrong stage) are fail-closed.
 */
import { randomBytes } from "node:crypto";
import { verifyCapabilityProof } from "./admission.js";
import type { DaemonRegistry, RegistryEntry, RegistryEvent } from "./registry.js";

/** Wire size cap: sync lines are small control messages, not payloads. */
const MAX_WIRE_LINE_BYTES = 64 * 1024;

/** Client -> daemon messages. */
export type RegistrySyncRequest =
	| { readonly op: "hello"; readonly agentId: string }
	| { readonly op: "hello_proof"; readonly agentId: string; readonly proof: string }
	| { readonly op: "subscribe"; readonly lastSeq: number };

/** Daemon -> client messages. */
export type RegistrySyncResponse =
	| { readonly op: "challenge"; readonly nonce: string }
	| { readonly op: "hello_ok" }
	| { readonly op: "hello_rejected"; readonly reason: string }
	| { readonly op: "snapshot"; readonly seq: number; readonly entries: readonly RegistryEntry[] }
	| { readonly op: "event"; readonly seq: number; readonly kind: RegistryEvent["kind"]; readonly agentId: string; readonly entry?: RegistryEntry };

export type RegistryWireMessage = RegistrySyncRequest | RegistrySyncResponse;

/** Encode one wire message as a JSON line (newline-terminated). */
export function encodeWireMessage(message: RegistryWireMessage): string {
	return `${JSON.stringify(message)}\n`;
}

/**
 * Parse one wire line. Returns undefined for empty, oversized, malformed, or
 * op-unknown lines — callers treat undefined as a protocol violation.
 */
export function parseWireMessage(line: string): RegistryWireMessage | undefined {
	const trimmed = line.trim();
	if (trimmed.length === 0) return undefined;
	if (Buffer.byteLength(trimmed, "utf8") > MAX_WIRE_LINE_BYTES) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const op = (value as Record<string, unknown>).op;
	if (
		op !== "hello" && op !== "hello_proof" && op !== "subscribe" &&
		op !== "challenge" && op !== "hello_ok" && op !== "hello_rejected" && op !== "snapshot" && op !== "event"
	) {
		return undefined;
	}
	return value as RegistryWireMessage;
}

/** Transport-agnostic connection surface (node:net socket or a test double). */
export interface RegistrySyncConnection {
	/** Write one encoded line to the peer. */
	readonly send: (line: string) => void;
	/** Tear the connection down. */
	readonly close: () => void;
}

/**
 * One authenticated, subscribed daemon-side sync session. The daemon socket
 * layer feeds complete lines to onLine; replies go to connection.send. The
 * capability proof is verified against the live binding the registry holds
 * for the claimed agent_id (registry-owned state, never caller-supplied
 * identity fields).
 */
export interface RegistrySyncSession {
	readonly onLine: (line: string) => void;
	readonly close: () => void;
}

export interface RegistrySyncHandlerInput {
	readonly registry: DaemonRegistry;
	/** Nonce source; defaults to 128 bits of cryptographic randomness. */
	readonly mintNonce?: () => string;
}

export function acceptRegistrySyncConnection(input: RegistrySyncHandlerInput, connection: RegistrySyncConnection): RegistrySyncSession {
	const mintNonce = input.mintNonce ?? ((): string => randomBytes(16).toString("base64"));
	const state: {
		stage: "unauthenticated" | "challenged" | "authenticated" | "subscribed";
		agentId?: string;
		nonce?: string;
		unsubscribe?: () => void;
	} = { stage: "unauthenticated" };

	const failClosed = (reason: string): void => {
		connection.send(encodeWireMessage({ op: "hello_rejected", reason }));
		connection.close();
	};

	const session: RegistrySyncSession = {
		onLine: (line: string): void => {
			const message = parseWireMessage(line);
			if (!message) {
				failClosed("malformed wire line");
				return;
			}
			switch (message.op) {
				case "hello": {
					// A hello (re)starts the handshake: drop any prior subscription
					// stream so a restarted handshake cannot double-forward events.
					state.unsubscribe?.();
					state.unsubscribe = undefined;
					state.stage = "challenged";
					state.agentId = message.agentId;
					state.nonce = mintNonce();
					connection.send(encodeWireMessage({ op: "challenge", nonce: state.nonce }));
					return;
				}
				case "hello_proof": {
					if (state.stage !== "challenged" || state.agentId !== message.agentId) {
						failClosed("proof without challenge");
						return;
					}
					const capability = input.registry.capabilityFor(message.agentId);
					if (!capability || !verifyCapabilityProof(capability.capabilitySecret, state.nonce ?? "", Buffer.from(message.proof, "base64"))) {
						failClosed("capability proof invalid");
						return;
					}
					state.stage = "authenticated";
					connection.send(encodeWireMessage({ op: "hello_ok" }));
					return;
				}
				case "subscribe": {
					if (state.stage !== "authenticated" && state.stage !== "subscribed") {
						failClosed("subscribe before authentication");
						return;
					}
					// A re-subscribe (the client's resync path) replaces the stream.
					state.unsubscribe?.();
					state.unsubscribe = undefined;
					void input.registry.subscribe((event) => {
						connection.send(encodeWireMessage({ op: "event", seq: event.seq, kind: event.kind, agentId: event.agentId, entry: input.registry.entry(event.agentId) }));
					}).then((handshake) => {
						state.unsubscribe = handshake.unsubscribe;
						state.stage = "subscribed";
						connection.send(encodeWireMessage({ op: "snapshot", seq: handshake.snapshot.seq, entries: handshake.snapshot.entries }));
					}).catch(() => {
						failClosed("subscription failed");
					});
					return;
				}
				case "challenge":
				case "hello_ok":
				case "hello_rejected":
				case "snapshot":
				case "event":
					// Daemon -> client ops never originate from the client side.
					failClosed("unexpected daemon op");
					return;
			}
		},
		close: (): void => {
			state.unsubscribe?.();
			connection.close();
		},
	};
	return session;
}