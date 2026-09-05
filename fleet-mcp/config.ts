import { isAbsolute, resolve } from "node:path";

export interface FleetLimits {
	pageSize: number;
	maxTextBytes: number;
	maxAckIds: number;
}

export interface FleetConfig {
	transport: "stdio" | "http" | "both";
	workspaceAlias: string;
	workspaceRoot: string;
	mailboxRoot: string;
	stateDir: string;
	listenHost: string;
	listenPort: number;
	mcpPath: string;
	bearerToken?: string;
	principal: string;
	limits: FleetLimits;
}

const CONFIG_KEYS = new Set([
	"transport",
	"workspaceAlias",
	"workspaceRoot",
	"mailboxRoot",
	"stateDir",
	"listenHost",
	"listenPort",
	"mcpPath",
	"bearerToken",
	"principal",
	"limits",
]);
const LIMIT_KEYS = new Set(["pageSize", "maxTextBytes", "maxAckIds"]);

function objectRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid ${name}`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
	return value;
}

function positiveInteger(value: unknown, fallback: number, name: string, maximum?: number): number {
	const resolved = value === undefined ? fallback : value;
	if (
		typeof resolved !== "number" ||
		!Number.isInteger(resolved) ||
		resolved <= 0 ||
		(maximum !== undefined && resolved > maximum)
	) {
		throw new Error(`Invalid ${name}`);
	}
	return resolved;
}

function absolutePath(value: unknown, name: string): string {
	const path = requiredString(value, name);
	if (!isAbsolute(path)) throw new Error(`${name} must be absolute`);
	return resolve(path);
}

export function parseFleetConfig(input: unknown): FleetConfig {
	const raw = objectRecord(input, "fleet configuration");
	for (const key of Object.keys(raw)) {
		if (!CONFIG_KEYS.has(key)) throw new Error(`Unknown configuration property: ${key}`);
	}

	const transport = raw.transport ?? "stdio";
	if (transport !== "stdio" && transport !== "http" && transport !== "both") {
		throw new Error("Invalid transport");
	}

	const listenHost = raw.listenHost === undefined ? "127.0.0.1" : requiredString(raw.listenHost, "listenHost");
	if (transport !== "stdio" && listenHost !== "127.0.0.1") {
		throw new Error("HTTP must bind to loopback");
	}

	const bearerToken = raw.bearerToken;
	if (transport !== "stdio" && (typeof bearerToken !== "string" || bearerToken.length < 16)) {
		throw new Error("HTTP bearerToken is required and must contain at least 16 characters");
	}

	const mcpPath = raw.mcpPath === undefined ? "/mcp" : requiredString(raw.mcpPath, "mcpPath");
	if (!mcpPath.startsWith("/") || mcpPath.includes("?")) throw new Error("Invalid mcpPath");

	const limits = raw.limits === undefined ? {} : objectRecord(raw.limits, "limits");
	for (const key of Object.keys(limits)) {
		if (!LIMIT_KEYS.has(key)) throw new Error(`Unknown limit: ${key}`);
	}

	return {
		transport,
		workspaceAlias: requiredString(raw.workspaceAlias, "workspaceAlias"),
		workspaceRoot: absolutePath(raw.workspaceRoot, "workspaceRoot"),
		mailboxRoot: absolutePath(raw.mailboxRoot, "mailboxRoot"),
		stateDir: absolutePath(raw.stateDir, "stateDir"),
		listenHost,
		listenPort: positiveInteger(raw.listenPort, 8787, "listenPort", 65_535),
		mcpPath,
		bearerToken: typeof bearerToken === "string" ? bearerToken : undefined,
		principal: raw.principal === undefined ? "local-stdio" : requiredString(raw.principal, "principal"),
		limits: {
			pageSize: positiveInteger(limits.pageSize, 20, "pageSize", 100),
			maxTextBytes: positiveInteger(limits.maxTextBytes, 32_768, "maxTextBytes"),
			maxAckIds: positiveInteger(limits.maxAckIds, 100, "maxAckIds", 100),
		},
	};
}
