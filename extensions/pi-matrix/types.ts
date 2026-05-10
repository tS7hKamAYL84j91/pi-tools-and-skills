/**
 * Matrix extension — shared types.
 */

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
	/** MXIDs allowed to send messages to the agent. Empty = accept all. */
	trustedSenders: string[];
}
