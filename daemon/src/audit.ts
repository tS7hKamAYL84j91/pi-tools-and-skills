/**
 * Append-only audit log (design doc section 2/9). Administrative-action
 * records are fsync'd (they are the accountability trail for fail-closed
 * rejections); regular delivery-audit lines are advisory.
 */
import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { auditDir } from "./paths.js";
import type { DaemonRoots } from "./paths.js";

export interface AuditEvent {
	readonly kind: string;
	readonly at?: string;
	readonly [key: string]: unknown;
}

function auditLogPath(roots: DaemonRoots): string {
	return join(auditDir(roots), `audit-${new Date().toISOString().slice(0, 10)}.log`);
}

export async function appendAudit(roots: DaemonRoots, event: Record<string, unknown>, options: { readonly durable?: boolean } = {}): Promise<void> {
	await mkdir(auditDir(roots), { recursive: true, mode: 0o700 });
	const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
	const path = auditLogPath(roots);
	await appendFile(path, line, { mode: 0o600 });
	if (options.durable) {
		const handle = await open(path, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
}