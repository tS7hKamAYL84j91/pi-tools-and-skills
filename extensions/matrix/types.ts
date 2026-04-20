/**
 * Matrix extension — shared types.
 */

/** Resolved configuration for the matrix extension. */
export interface MatrixConfig {
	/** Homeserver base URL — e.g. "https://coas-matrix.tail5a2ec5.ts.net" */
	homeserver: string;
	/** Bot's full MXID — e.g. "@coas-bot:coas-matrix.tail5a2ec5.ts.net" */
	userId: string;
	/** The primary room the bot sends replies to */
	roomId: string;
	/** Bearer access token for the bot account (resolved from env, never stored on disk) */
	accessToken: string;
	/** Whether to enable end-to-end encryption (requires crypto store + device verification) */
	encryption: boolean;
	/** Filesystem path for the persistent crypto store (only used when encryption=true) */
	cryptoStorePath: string;
	/** Display name shown to other Matrix devices for the bot's session */
	deviceDisplayName: string;
	/** Label used in message attribution, e.g. "matrix" → "[from matrix:jim]" */
	channelLabel: string;
	/** MXIDs allowed to send messages to the agent. Empty = accept all. */
	trustedSenders: string[];
}
