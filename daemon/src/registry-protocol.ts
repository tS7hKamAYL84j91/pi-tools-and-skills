/**
 * M6 daemon-side registry sync session (design doc section 7): the
 * connection handler behind the daemon socket. The JSON-line wire codec is
 * published from lib/daemon-protocol/registry-protocol.ts (ADR-053) and
 * re-exported here so daemon-internal consumers are unchanged. Handshake:
 * hello -> challenge -> proof (capability possession per ADR section 2) ->
 * hello_ok -> subscribe -> one atomic snapshot followed by per-change events
 * with monotonically increasing seq. Daemon-side failures (bad proof,
 * unknown op, wrong stage) are fail-closed.
 */
import { randomBytes } from "node:crypto";
import { verifyCapabilityProof } from "./admission.js";
import {
	encodeWireMessage,
	parseWireMessage,
	type RegistrySyncConnection,
} from "../../lib/daemon-protocol/registry-protocol.js";
import type { DaemonRegistry } from "./registry.js";

export { encodeWireMessage, parseWireMessage } from "../../lib/daemon-protocol/registry-protocol.js";
export type {
	RegistrySyncConnection,
	RegistrySyncRequest,
	RegistrySyncResponse,
	RegistryWireMessage,
} from "../../lib/daemon-protocol/registry-protocol.js";

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

export function acceptRegistrySyncConnection(
	input: RegistrySyncHandlerInput,
	connection: RegistrySyncConnection,
): RegistrySyncSession {
	const mintNonce =
		input.mintNonce ?? ((): string => randomBytes(16).toString("base64"));
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
					connection.send(
						encodeWireMessage({ op: "challenge", nonce: state.nonce }),
					);
					return;
				}
				case "hello_proof": {
					if (
						state.stage !== "challenged" ||
						state.agentId !== message.agentId
					) {
						failClosed("proof without challenge");
						return;
					}
					const capability = input.registry.capabilityFor(message.agentId);
					if (
						!capability ||
						!verifyCapabilityProof(
							capability.capabilitySecret,
							state.nonce ?? "",
							Buffer.from(message.proof, "base64"),
						)
					) {
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
					void input.registry
						.subscribe((event) => {
							connection.send(
								encodeWireMessage({
									op: "event",
									seq: event.seq,
									kind: event.kind,
									agentId: event.agentId,
									entry: input.registry.entry(event.agentId),
								}),
							);
						})
						.then((handshake) => {
							state.unsubscribe = handshake.unsubscribe;
							state.stage = "subscribed";
							connection.send(
								encodeWireMessage({
									op: "snapshot",
									seq: handshake.snapshot.seq,
									entries: handshake.snapshot.entries,
								}),
							);
						})
						.catch(() => {
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