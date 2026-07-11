/**
 * Matrix extension — shared types.
 */

/** Configurable inbound message policy. */
export interface MatrixIngressConfig {
	/** Maximum in-memory inbound messages before overflow drops begin. */
	maxBuffer?: number;
	/** Maximum messages accepted across all senders within rateWindowMs. */
	globalBurstLimit?: number;
	/** Maximum messages accepted from one sender within rateWindowMs. */
	perSenderBurstLimit?: number;
	/** Sliding window duration in milliseconds for burst limits. */
	rateWindowMs?: number;
	/** Whether a full buffer evicts the oldest message or rejects the newest. */
	overflowPolicy?: "drop-newest" | "drop-oldest";
}

/** Resolved configuration for the matrix extension. */
export interface MatrixConfig {
	/** Homeserver base URL */
	homeserver: string;
	/** Bot's full MXID */
	userId: string;
	/** Optional primary room for replies. If unset, replies go to the latest inbound DM/room. */
	roomId?: string;
	/** Bearer access token (resolved from env at runtime) */
	accessToken: string;
	/** Filesystem path for sync state storage */
	storagePath: string;
	/** Filesystem path for downloaded Matrix attachments */
	attachmentCachePath: string;
	/** Maximum Matrix attachment size to download, in bytes */
	maxAttachmentBytes: number;
	/** Allowed MIME prefixes/classes. Empty means no MIME filtering. */
	allowedMimePrefixes: string[];
	/** Label used in message attribution, e.g. "matrix" */
	channelLabel: string;
	/** MXIDs allowed to send messages to the agent. Empty = deny by default. */
	trustedSenders: string[];
	/** Explicit dev/test escape hatch for accepting any Matrix sender. */
	allowAnySender: boolean;
	/** Optional inbound rate/buffer policy. Defaults are applied when omitted. */
	ingress: MatrixIngressConfig;
}
