/**
 * CoAS home directory resolution.
 *
 * Centralises the lookup so extensions and lib modules share a single source
 * of truth without re-embedding the `COAS_HOME` / `~/.coas` convention.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Return the active CoAS home directory. */
export function getCoasHome(): string {
	return process.env.COAS_HOME ? process.env.COAS_HOME : join(homedir(), ".coas");
}
