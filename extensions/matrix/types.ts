/**
 * Matrix extension — shared types.
 */

/** Resolved configuration for the matrix extension. */
export interface MatrixConfig {
	/** Homeserver base URL */
	homeserver: string;
	/** Bot's full MXID */
	userId: string;
	/** Primary room for replies */
	roomId: string;
	/** Bearer access token (resolved from env at runtime) */
	accessToken: string;
	/** Filesystem path for sync state storage */
	storagePath: string;
	/** Label used in message attribution, e.g. "matrix" */
	channelLabel: string;
	/** MXIDs allowed to send messages to the agent. Empty = accept all. */
	trustedSenders: string[];
}
