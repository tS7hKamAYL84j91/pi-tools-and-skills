import { isAbsolute, resolve } from "node:path";

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
  limits: { pageSize: number; maxTextBytes: number; maxAckIds: number };
}

const keys = new Set(["transport","workspaceAlias","workspaceRoot","mailboxRoot","stateDir","listenHost","listenPort","mcpPath","bearerToken","principal","limits"]);
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || !value) throw new Error(`Invalid ${name}`); return value; }
export function parseFleetConfig(input: unknown): FleetConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid fleet configuration");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!keys.has(key)) throw new Error(`Unknown configuration property: ${key}`);
  const transport = raw.transport === undefined ? "stdio" : raw.transport;
  if (transport !== "stdio" && transport !== "http" && transport !== "both") throw new Error("Invalid transport");
  const workspaceRoot = requiredString(raw.workspaceRoot, "workspaceRoot");
  const mailboxRoot = requiredString(raw.mailboxRoot, "mailboxRoot");
  const stateDir = requiredString(raw.stateDir, "stateDir");
  for (const [name, value] of [["workspaceRoot",workspaceRoot],["mailboxRoot",mailboxRoot],["stateDir",stateDir]] as const) if (!isAbsolute(value)) throw new Error(`${name} must be absolute`);
  const listenHost = raw.listenHost === undefined ? "127.0.0.1" : requiredString(raw.listenHost, "listenHost");
  if (transport !== "stdio" && listenHost !== "127.0.0.1") throw new Error("HTTP must bind to loopback");
  const token = raw.bearerToken;
  if (transport !== "stdio" && (typeof token !== "string" || token.length < 16)) throw new Error("HTTP bearerToken is required");
  const portValue: unknown = raw.listenPort === undefined ? 8787 : raw.listenPort;
  if (typeof portValue !== "number" || !Number.isInteger(portValue) || portValue < 1 || portValue > 65535) throw new Error("Invalid listenPort");
  const port = portValue;
  const mcpPath = raw.mcpPath === undefined ? "/mcp" : requiredString(raw.mcpPath, "mcpPath");
  if (!mcpPath.startsWith("/")) throw new Error("mcpPath must start with /");
  const limitsRaw = raw.limits === undefined ? {} : raw.limits;
  if (!limitsRaw || typeof limitsRaw !== "object" || Array.isArray(limitsRaw)) throw new Error("Invalid limits");
  const limits = limitsRaw as Record<string, unknown>;
  for (const key of Object.keys(limits)) if (!["pageSize","maxTextBytes","maxAckIds"].includes(key)) throw new Error(`Unknown limit: ${key}`);
  const pageSize = limits.pageSize === undefined ? 20 : limits.pageSize;
  const maxTextBytes = limits.maxTextBytes === undefined ? 32768 : limits.maxTextBytes;
  const maxAckIds = limits.maxAckIds === undefined ? 100 : limits.maxAckIds;
  if (![pageSize,maxTextBytes,maxAckIds].every((n) => Number.isInteger(n) && Number(n) > 0) || Number(pageSize) > 100 || Number(maxAckIds) > 100) throw new Error("Invalid limits");
  return { transport, workspaceAlias: requiredString(raw.workspaceAlias, "workspaceAlias"), workspaceRoot: resolve(workspaceRoot), mailboxRoot: resolve(mailboxRoot), stateDir: resolve(stateDir), listenHost, listenPort: Number(port), mcpPath, bearerToken: typeof token === "string" ? token : undefined, principal: raw.principal === undefined ? "local-stdio" : requiredString(raw.principal, "principal"), limits: { pageSize: Number(pageSize), maxTextBytes: Number(maxTextBytes), maxAckIds: Number(maxAckIds) } };
}
