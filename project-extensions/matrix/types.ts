/**
 * Matrix extension — shared types.
 *
 * Kept deliberately small. Anything more elaborate goes in the file
 * that uses it.
 */

/** Resolved configuration for the matrix extension. */
export interface MatrixConfig {
	/** Homeserver base URL — e.g. "https://matrix.org" or "http://continuwuity:8008" */
	homeserver: string;
	/** Bot's full MXID — e.g. "@coas-bot:matrix.org" */
	userId: string;
	/** The single room the bot listens to and replies in */
	roomId: string;
	/** Registered panopticon agent name to deliver inbound messages to */
	targetAgent: string;
	/** Bearer access token for the bot account (resolved from env, never stored on disk) */
	accessToken: string;
	/** Whether to enable end-to-end encryption (Rust crypto + file-backed store) */
	encryption: boolean;
	/** Filesystem path for the persistent crypto store */
	cryptoStorePath: string;
	/** Display name shown to other Matrix devices for the bot's session */
	deviceDisplayName: string;
	/** Optional Secure Backup recovery passphrase, resolved from env */
	recoveryPassphrase?: string;
}

/** Connection state surfaced to the UI widget and the matrix_status tool. */
export interface MatrixStatus {
	connected: boolean;
}
