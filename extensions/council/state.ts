/**
 * Council state manager — atomic persistence and orphan recovery.
 *
 * Writes are atomic (tmp/ → rename) so a crash during persistence cannot
 * corrupt a record. Orphans (non-terminal records whose orchestrator pid is
 * dead) are surfaced on demand so callers can decide whether to resume them.
 */

import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isPidAlive } from "../../lib/agent-registry.js";
import type { CouncilDeliberation, CouncilMember } from "./types.js";

/** @public */
export const DEFAULT_COUNCILS_DIR = join(homedir(), ".pi", "agent", "councils");
const TMP_SUBDIR = "tmp";

function generateId(): string {
	return `council-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

interface CreateArgs {
	council: string;
	prompt: string;
	members: CouncilMember[];
	chairman: CouncilMember;
}

export class CouncilStateManager {
	constructor(private readonly councilsDir: string = DEFAULT_COUNCILS_DIR) {}

	private recordPath(id: string): string {
		return join(this.councilsDir, `${id}.json`);
	}

	private tmpPath(id: string): string {
		return join(this.councilsDir, TMP_SUBDIR, `${id}-${process.pid}.json`);
	}

	private ensureDirs(): void {
		mkdirSync(join(this.councilsDir, TMP_SUBDIR), { recursive: true });
	}

	/** Atomic write via tmp/ → rename. */
	private write(record: CouncilDeliberation): void {
		this.ensureDirs();
		const tmp = this.tmpPath(record.id);
		writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
		renameSync(tmp, this.recordPath(record.id));
	}

	create(args: CreateArgs): CouncilDeliberation {
		const record: CouncilDeliberation = {
			version: 1,
			id: generateId(),
			council: args.council,
			prompt: args.prompt,
			members: args.members,
			chairman: args.chairman,
			status: "pending",
			startedAt: Date.now(),
			orchestratorPid: process.pid,
			generation: [],
			critiques: [],
		};
		this.write(record);
		return record;
	}

	/** Merge a patch into the record and persist atomically. */
	update(
		record: CouncilDeliberation,
		patch: Partial<CouncilDeliberation>,
	): CouncilDeliberation {
		const next: CouncilDeliberation = { ...record, ...patch };
		this.write(next);
		return next;
	}

	get(id: string): CouncilDeliberation | undefined {
		try {
			const raw = readFileSync(this.recordPath(id), "utf-8");
			return JSON.parse(raw) as CouncilDeliberation;
		} catch {
			return undefined;
		}
	}

	list(): CouncilDeliberation[] {
		try {
			this.ensureDirs();
			const files = readdirSync(this.councilsDir).filter((f) =>
				f.endsWith(".json"),
			);
			return files.flatMap((f) => {
				try {
					const raw = readFileSync(join(this.councilsDir, f), "utf-8");
					return [JSON.parse(raw) as CouncilDeliberation];
				} catch {
					return [];
				}
			});
		} catch {
			return [];
		}
	}

	remove(id: string): void {
		try {
			rmSync(this.recordPath(id), { force: true });
		} catch {
			/* best-effort */
		}
	}

	/**
	 * Identify deliberations whose orchestrator is no longer running and which
	 * never reached a terminal status. These are recovery candidates.
	 */
	findOrphans(): CouncilDeliberation[] {
		return this.list().filter((d) => {
			if (d.status === "completed" || d.status === "failed") return false;
			return !isPidAlive(d.orchestratorPid);
		});
	}

	/** Mark an orphan as failed so it stops being recovered repeatedly. */
	markFailed(id: string, reason: string): void {
		const record = this.get(id);
		if (!record) return;
		this.update(record, {
			status: "failed",
			error: reason,
			completedAt: Date.now(),
		});
	}
}
