/** Durable approval-inbox claim-check artifacts for gated CoAS runs. */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { ConfinedStore } from "./store.js";
import { assertSafeId, isoUtc } from "./store-paths.js";
import type { CoasConfig } from "./types.js";

const INBOX_DIR = "schedule-runs/awaiting-approval";
const VERSION = 1;
const RETENTION_DAYS = 30;
const MAX_TERMINAL_ARTIFACTS = 100;

type ApprovalStatus = "awaiting-approval" | "approved" | "rejected" | "deferred" | "completed";

interface ApprovalArtifact {
	readonly version: number;
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly claimToken: string;
	readonly slotKey?: string;
	readonly status: ApprovalStatus;
	readonly prompt: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly decision?: string;
}

function approvalArtifactPath(config: CoasConfig, requestId: string): string {
	assertSafeId("approval request id", requestId);
	return join(config.coasHome, INBOX_DIR, `${requestId}.json`);
}

function isStatus(value: unknown): value is ApprovalStatus {
	return value === "awaiting-approval" || value === "approved" || value === "rejected" || value === "deferred" || value === "completed";
}

function isSafeRunId(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

function sanitizeText(value: string, maxChars: number): string {
	const withoutControls = [...value].map((character) => {
		const code = character.charCodeAt(0);
		return code < 0x20 || code === 0x7f ? " " : character;
	}).join("");
	return withoutControls
		.replace(/((?:api[_ -]?key|token|password|secret|credential)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
		.slice(0, maxChars);
}

function parseArtifact(value: unknown, requestId: string): ApprovalArtifact | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	if (item.version !== VERSION || item.requestId !== requestId || typeof item.taskId !== "string" || typeof item.runId !== "string" || typeof item.claimToken !== "string" || item.claimToken.length < 16 || (item.slotKey !== undefined && typeof item.slotKey !== "string") || !isStatus(item.status) || typeof item.prompt !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") return undefined;
	try {
		assertSafeId("task id", item.taskId);
		if (!isSafeRunId(item.runId)) throw new Error("unsafe run id");
	} catch {
		return undefined;
	}
	return {
		version: VERSION,
		requestId,
		taskId: item.taskId,
		runId: item.runId,
		claimToken: item.claimToken,
		slotKey: typeof item.slotKey === "string" ? item.slotKey : undefined,
		status: item.status,
		prompt: sanitizeText(item.prompt, 4_000),
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		decision: typeof item.decision === "string" ? sanitizeText(item.decision, 500) : undefined,
	};
}

export async function readApprovalArtifact(config: CoasConfig, requestId: string): Promise<ApprovalArtifact | undefined> {
	const store = await ConfinedStore.openCoasHome(config);
	if (!store) return undefined;
	const raw = await store.readOptionalFile(approvalArtifactPath(config, requestId));
	if (raw === undefined) return undefined;
	try {
		return parseArtifact(JSON.parse(raw) as unknown, requestId);
	} catch {
		return undefined;
	}
}

export async function writeApprovalArtifact(config: CoasConfig, artifact: ApprovalArtifact): Promise<void> {
	const store = await ConfinedStore.createCoasHome(config);
	await store.writePrivateFileAtomic(
		approvalArtifactPath(config, artifact.requestId),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
}

interface ApprovalRequest {
	readonly config: CoasConfig;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly claimToken?: string;
	readonly slotKey?: string;
	readonly requestId?: string;
}

interface ApprovalGateRequest {
	readonly config: CoasConfig;
	readonly required: boolean;
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly claimToken?: string;
	readonly slotKey?: string;
}

interface ApprovalGateResult {
	readonly requestId?: string;
	readonly parked: boolean;
	readonly approved: boolean;
}

export async function claimApproval(request: ApprovalGateRequest): Promise<ApprovalGateResult> {
	if (!request.required) return { parked: false, approved: true };
	const requestId = request.requestId;
	const approval = await readApprovalArtifact(request.config, requestId);
	if (!approval) {
		await parkApproval({ ...request, requestId });
		return { requestId, parked: true, approved: false };
	}
	if (request.claimToken !== undefined && approval.claimToken !== request.claimToken) {
		return { requestId, parked: false, approved: false };
	}
	return { requestId, parked: false, approved: approval.status === "approved" };
}

export async function parkApproval(request: ApprovalRequest): Promise<ApprovalArtifact> {
	const requestId = request.requestId ?? `${request.taskId}-${request.runId}`;
	const existing = await readApprovalArtifact(request.config, requestId);
	if (existing) return existing;
	const now = isoUtc();
	assertSafeId("task id", request.taskId);
	if (!isSafeRunId(request.runId)) throw new Error(`Invalid run id: ${request.runId}`);
	const artifact: ApprovalArtifact = { version: VERSION, requestId, taskId: request.taskId, runId: request.runId, claimToken: request.claimToken ?? randomUUID(), ...(request.slotKey ? { slotKey: request.slotKey } : {}), status: "awaiting-approval", prompt: sanitizeText(request.prompt, 4_000), createdAt: now, updatedAt: now };
	await writeApprovalArtifact(request.config, artifact);
	return artifact;
}

async function decide(config: CoasConfig, requestId: string, status: ApprovalStatus, decision?: string): Promise<ApprovalArtifact> {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
	return withAdvisoryLock(approvalArtifactPath(config, requestId), async () => {
		const current = await readApprovalArtifact(config, requestId);
		if (!current) throw new Error(`Unknown approval request: ${requestId}`);
		if (current.status === "completed" || current.status === "rejected" || current.status === "deferred" || (current.status === "approved" && status !== "approved")) return current;
		if (current.status === status) return current;
		const next: ApprovalArtifact = { ...current, status, updatedAt: isoUtc(), ...(decision ? { decision: sanitizeText(decision, 500) } : {}) };
		await writeApprovalArtifact(config, next);
		return next;
	});
}

export function isPrincipal(): boolean {
	return process.env.PI_PRINCIPAL === "1";
}

function requirePrincipal(): void {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
}

export async function approveApproval(config: CoasConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "approved", decision);
}
export async function rejectApproval(config: CoasConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "rejected", decision);
}
export async function deferApproval(config: CoasConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "deferred", decision);
}

export async function countAwaitingApprovals(config: CoasConfig): Promise<number> {
	const artifacts = await listApprovalArtifacts(config);
	return artifacts.filter((artifact) => artifact.status === "awaiting-approval" || artifact.status === "deferred").length;
}

export async function removeApprovalArtifactsForTask(config: CoasConfig, taskId: string): Promise<void> {
	assertSafeId("task id", taskId);
	const store = await ConfinedStore.openCoasHome(config);
	if (!store) return;
	const paths = (await listApprovalArtifacts(config))
		.filter((artifact) => artifact.taskId === taskId)
		.map((artifact) => approvalArtifactPath(config, artifact.requestId));
	await store.removePrivateFiles(paths);
}

export async function listApprovalArtifacts(config: CoasConfig): Promise<ApprovalArtifact[]> {
	const store = await ConfinedStore.openCoasHome(config);
	const root = join(config.coasHome, INBOX_DIR);
	if (!store || !await store.fileExists(root)) return [];
	const items: ApprovalArtifact[] = [];
	for (const entry of await store.readDirectory(root)) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const requestId = entry.name.slice(0, -5);
		const artifact = await readApprovalArtifact(config, requestId);
		if (artifact) items.push(artifact);
	}
	const sorted = items.sort((first, second) => first.updatedAt.localeCompare(second.updatedAt));
	const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
	const terminal = sorted.filter((item) => item.status === "completed" || item.status === "rejected");
	const retainedTerminal = terminal.slice(-MAX_TERMINAL_ARTIFACTS);
	const retained = new Set(retainedTerminal.map((item) => item.requestId));
	const expiredPaths = terminal
		.filter((item) => !retained.has(item.requestId) || Date.parse(item.updatedAt) < cutoff)
		.map((item) => approvalArtifactPath(config, item.requestId));
	await store.removePrivateFiles(expiredPaths);
	return sorted.filter((item) => item.status !== "completed" && item.status !== "rejected" || retained.has(item.requestId));
}
