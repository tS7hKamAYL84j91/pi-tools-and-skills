/** Pure Automations identifiers, paths, and environment-file formatting. */

import { join } from "node:path";
import { assertInside, pathInside } from "../../lib/path-inside.js";
import { assertSafeId, isoUtc } from "./lib/automations-paths.js";
import type { AutomationsConfig } from "./types.js";

export { assertInside, assertSafeId, isoUtc, pathInside };

export function slugify(value: string, fallback = "workspace"): string {
	const slug = value.trim().toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "");
	return slug || fallback;
}

export function workspaceIdFromRoom(room: string): string {
	return `room-${slugify(room)}`;
}

export function workspaceRoot(config: AutomationsConfig): string {
	return join(config.automationsHome, "workspace");
}

export function scheduleRoot(config: AutomationsConfig): string {
	return join(config.automationsHome, "schedules");
}

export function logRoot(config: AutomationsConfig): string {
	return join(config.automationsHome, "logs");
}

export function scheduleLogRoot(config: AutomationsConfig): string {
	return join(logRoot(config), "schedules");
}

export function lockRoot(config: AutomationsConfig): string {
	return join(config.automationsHome, "locks", "schedules");
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value) && value.length > 0) return value;
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function unquoteShellValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'"'"'/g, "'");
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/\\"/g, '"');
	return trimmed;
}

export function parseEnv(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index <= 0) continue;
		const key = trimmed.slice(0, index);
		if (/^[A-Z0-9_]+$/.test(key)) values[key] = unquoteShellValue(trimmed.slice(index + 1));
	}
	return values;
}

export function formatEnv(values: Record<string, string>): string {
	return `${Object.entries(values).map(([key, value]) => `${key}=${shellQuote(value)}`).join("\n")}\n`;
}
