/**
 * M6 registry sync protocol wire codec (design doc section 7, ADR-053): the
 * JSON-line contract shared by the daemon-side connection handler and the
 * pi-panopticon daemon-client. Handshake: hello -> challenge -> proof
 * (capability possession per ADR section 2) -> hello_ok -> subscribe -> one
 * atomic snapshot followed by per-change events with monotonically increasing
 * seq. The daemon-side session handler (acceptRegistrySyncConnection) stays
 * private in daemon/src/registry-protocol.ts. The codec is wire-stable: no
 * format or behavior changes are permitted here.
 */
import type { RegistryEntry, RegistryEvent } from "./registry-types.js";

/** Wire size cap: sync lines are small control messages, not payloads. */
const MAX_WIRE_LINE_BYTES = 64 * 1024;

/** Client -> daemon messages. */
export type RegistrySyncRequest =
	| { readonly op: "hello"; readonly agentId: string }
	| {
			readonly op: "hello_proof";
			readonly agentId: string;
			readonly proof: string;
	  }
	| { readonly op: "subscribe"; readonly lastSeq: number };

/** Daemon -> client messages. */
export type RegistrySyncResponse =
	| { readonly op: "challenge"; readonly nonce: string }
	| { readonly op: "hello_ok" }
	| { readonly op: "hello_rejected"; readonly reason: string }
	| {
			readonly op: "snapshot";
			readonly seq: number;
			readonly entries: readonly RegistryEntry[];
	  }
	| {
			readonly op: "event";
			readonly seq: number;
			readonly kind: RegistryEvent["kind"];
			readonly agentId: string;
			readonly entry?: RegistryEntry;
	  };

export type RegistryWireMessage = RegistrySyncRequest | RegistrySyncResponse;

/** Encode one wire message as a JSON line (newline-terminated). */
export function encodeWireMessage(message: RegistryWireMessage): string {
	return `${JSON.stringify(message)}\n`;
}

/**
 * Parse one wire line. Returns undefined for empty, oversized, malformed, or
 * op-unknown lines — callers treat undefined as a protocol violation.
 */
export function parseWireMessage(
	line: string,
): RegistryWireMessage | undefined {
	const trimmed = line.trim();
	if (trimmed.length === 0) return undefined;
	if (Buffer.byteLength(trimmed, "utf8") > MAX_WIRE_LINE_BYTES)
		return undefined;
	let value: unknown;
	try {
		value = JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const op = (value as Record<string, unknown>).op;
	if (
		op !== "hello" &&
		op !== "hello_proof" &&
		op !== "subscribe" &&
		op !== "challenge" &&
		op !== "hello_ok" &&
		op !== "hello_rejected" &&
		op !== "snapshot" &&
		op !== "event"
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
