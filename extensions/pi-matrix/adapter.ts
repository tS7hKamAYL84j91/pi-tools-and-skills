/**
 * Internal Matrix SDK adapter boundary.
 *
 * Keeps Matrix SDK-specific objects inside the adapter so the bridge
 * depends only on this narrow interface. Swapping SDKs requires changing
 * only the adapter implementation.
 */

import type { MatrixConfig } from "./types.js";

/** Normalised inbound message event produced by the adapter. */
export interface MatrixInboundEvent {
	roomId: string;
	sender: string;
	eventId: string;
	timestampMs: number;
	content: Record<string, unknown>;
	isHistorical: boolean;
	isLocalEcho: boolean;
}

/** Normalised room membership event produced by the adapter. */
export interface MatrixMembershipEvent {
	roomId: string;
	sender?: string;
	userId: string;
	membership: "invite" | "join" | "leave" | "ban" | string;
}

/** Sync-state persistence contract. */
export interface SyncStateStore {
	load(): Promise<string | null>;
	save(token: string): Promise<void>;
	reset(): Promise<void>;
}

export interface MatrixClientAdapter {
	/** Start the sync loop. Resolves when initial sync reaches a prepared state or rejects on fatal startup error. */
	start(config: MatrixConfig, callbacks: MatrixAdapterCallbacks): Promise<void>;
	/** Stop the sync loop. Repeated stops must be safe. */
	stop(): Promise<void>;
	/** Join a room by id. */
	joinRoom(roomId: string): Promise<void>;
	/** Leave a room by id. */
	leaveRoom(roomId: string): Promise<void>;
	/** Send a message event to a room and return the event id. */
	sendMessage(roomId: string, content: Record<string, unknown>): Promise<{ eventId: string }>;
	/** Whether the adapter is currently in a prepared/syncing state. */
	isConnected(): boolean;
	/**
	 * Expose SDK crypto capabilities only when end-to-end encryption is enabled.
	 * For unencrypted deployments this is null.
	 */
	crypto: { decryptMedia(file: Record<string, unknown>): Promise<Buffer> } | null;
}

export interface MatrixAdapterCallbacks {
	/** New membership event (invite/join/leave). */
	onMembership(event: MatrixMembershipEvent): void | Promise<void>;
	/** New room message event. */
	onMessage(event: MatrixInboundEvent): void | Promise<void>;
	/** SDK emitted a warning or error (already sanitised by the bridge). */
	onLog?(message: string, level: "info" | "warning" | "error"): void;
	/** Sync reached prepared/syncing state or fell back to error/stopped. */
	onConnectionChange?(connected: boolean): void;
}
