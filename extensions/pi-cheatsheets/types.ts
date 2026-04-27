/**
 * Shared types for the Pi Cheatsheets extension.
 */

export interface MemoryMeta {
	tool: string;
	version: string;
	updated: string;
	category: string;
	tags: string[];
	confidence: "high" | "medium" | "low";
}

export type MemorySource = "settings" | "global" | "project" | "deprecated-global" | "deprecated-project";

export interface MemoryFile {
	path: string;
	name: string;
	meta: MemoryMeta;
	body: string;
	raw: string;
	source: MemorySource;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export interface CreateMemoryOptions {
	tool: string;
	version?: string;
	category?: string;
	tags?: string[];
	confidence?: "high" | "medium" | "low";
	target?: "project" | "global";
}

export const MMEM_EXT = ".mmem.yml";
