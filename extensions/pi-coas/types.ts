/**
 * CoAS extension shared types.
 */

export interface CoasConfig {
	coasDir: string;
	coasHome: string;
}

export interface RawCoasSettings {
	coasDir?: unknown;
	coasHome?: unknown;
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface TruncatedText {
	text: string;
	truncated: boolean;
	originalBytes: number;
	originalLines: number;
}

export interface WorkspaceSummary {
	id: string;
	path: string;
	roomRef?: string;
	purpose?: string;
	isolated?: string;
	updatedAt?: string;
	hasContext: boolean;
}
