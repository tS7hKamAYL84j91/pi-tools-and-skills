/** Durable approval-inbox claim-check artifacts for gated CoAS runs. */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { assertSafeId, ensurePrivateDir, isoUtc } from "./store.js";
import type { CoasConfig } from "./types.js";

const INBOX_DIR = "schedule-runs/awaiting-approval";
const VERSION = 1;

type ApprovalStatus = "awaiting-approval" | "approved" | "rejected" | "deferred" | "completed";

interface ApprovalArtifact {
	readonly version: number;
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
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

function parseArtifact(value: unknown, requestId: string): ApprovalArtifact | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	if (item.version !== VERSION || item.requestId !== requestId || typeof item.taskId !== "string" || typeof item.runId !== "string" || !isStatus(item.status) || typeof item.prompt !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") return undefined;
	return {
		version: VERSION,
		requestId,
		taskId: item.taskId,
		runId: item.runId,
		status: item.status,
		prompt: item.prompt.slice(0, 4_000),
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		decision: typeof item.decision === "string" ? item.decision.slice(0, 500) : undefined,
	};
}

export async function readApprovalArtifact(config: CoasConfig, requestId: string): Promise<ApprovalArtifact | undefined> {
	try {
		return parseArtifact(JSON.parse(await readFile(approvalArtifactPath(config, requestId), "utf8")) as unknown, requestId);
	} catch {
		return undefined;
	}
}

export async function writeApprovalArtifact(config: CoasConfig, artifact: ApprovalArtifact): Promise<void> {
	const path = approvalArtifactPath(config, artifact.requestId);
	await ensurePrivateDir(join(config.coasHome, INBOX_DIR));
	await writeFileAtomic(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

interface ApprovalRequest {
	readonly config: CoasConfig;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly requestId?: string;
}

interface ApprovalGateRequest {
	readonly config: CoasConfig;
	readonly required: boolean;
	readonly taskId: string;
	readonly key: string;
	readonly runId: string;
	readonly prompt: string;
}

interface ApprovalGateResult {
	readonly requestId?: string;
	readonly parked: boolean;
	readonly approved: boolean;
}

export async function claimApproval(request: ApprovalGateRequest): Promise<ApprovalGateResult> {
	if (!request.required) return { parked: false, approved: true };
	const requestId = `${request.taskId}-${request.key.replace(/[^a-z0-9._-]/gi, "-").toLowerCase()}`;
	const approval = await readApprovalArtifact(request.config, requestId);
	if (!approval) {
		await parkApproval({ ...request, requestId });
		return { requestId, parked: true, approved: false };
	}
	return { requestId, parked: false, approved: approval.status === "approved" };
}

export async function parkApproval(request: ApprovalRequest): Promise<ApprovalArtifact> {
	const requestId = request.requestId ?? `${request.taskId}-${request.runId}`;
	const existing = await readApprovalArtifact(request.config, requestId);
	if (existing) return existing;
	const now = isoUtc();
	const artifact: ApprovalArtifact = { version: VERSION, requestId, taskId: request.taskId, runId: request.runId, status: "awaiting-approval", prompt: request.prompt.slice(0, 4_000), createdAt: now, updatedAt: now };
	await writeApprovalArtifact(request.config, artifact);
	return artifact;
}

async function decide(config: CoasConfig, requestId: string, status: ApprovalStatus, decision?: string): Promise<ApprovalArtifact> {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
	const current = await readApprovalArtifact(config, requestId);
	if (!current) throw new Error(`Unknown approval request: ${requestId}`);
	if (current.status === "completed" || current.status === "rejected") return current;
	const next: ApprovalArtifact = { ...current, status, updatedAt: isoUtc(), ...(decision ? { decision: decision.slice(0, 500) } : {}) };
	await writeApprovalArtifact(config, next);
	return next;
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

export async function listApprovalArtifacts(config: CoasConfig): Promise<ApprovalArtifact[]> {
	const root = join(config.coasHome, INBOX_DIR);
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const items: ApprovalArtifact[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const requestId = entry.name.slice(0, -5);
		const artifact = await readApprovalArtifact(config, requestId);
		if (artifact) items.push(artifact);
	}
	return items.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
