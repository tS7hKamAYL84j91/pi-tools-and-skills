/** Resolve the pi CLI for standalone Teams model runs. */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Locate the pi CLI without depending on Panopticon's private spawner. */
export function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) return candidate;

	const allowedDirs = [
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
		join(homedir(), ".local", "bin"),
	];
	for (const dir of allowedDirs) {
		const resolved = join(dir, "pi");
		if (existsSync(resolved)) return resolved;
	}
	return "pi";
}
