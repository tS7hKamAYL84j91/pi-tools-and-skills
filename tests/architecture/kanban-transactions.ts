/** Kanban authoritative-log transaction fitness functions. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

const KANBAN_ROOT = "extensions/pi-kanban";

function source(path: string): string {
	return readFileSync(path, "utf8");
}

describe("Kanban board transaction boundary", () => {
	it("centralizes board appends in the transaction module", () => {
		const directAppenders = listTsFiles(KANBAN_ROOT)
			.filter((path) => source(path).includes("appendLogLine("))
			.map((path) => relative(process.cwd(), path));
		expect(directAppenders).toEqual([
			"extensions/pi-kanban/board-transactions.ts",
		]);
	});

	it("compaction replaces board.log only through the shared board lock", () => {
		const compaction = source(`${KANBAN_ROOT}/compaction.ts`);
		expect(compaction).toContain('import { withBoardLock } from "./board-transactions.js"');
		expect(compaction).toMatch(
			/return withBoardLock\(\(\) => runCompactionLocked\(agentLabel, triggerParam\)\)/,
		);
	});

	it("claim conflict handling has no compensating append", () => {
		const claims = source(`${KANBAN_ROOT}/claim-tools.ts`);
		expect(claims).not.toContain("CLAIM_CONFLICT");
		expect(claims).not.toContain("await logAppend");
		expect(claims).toContain("withBoardTransaction");
	});
});
