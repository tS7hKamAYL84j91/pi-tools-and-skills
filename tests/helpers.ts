/**
 * Shared test helpers for kanban extension tests.
 *
 * Each test suite gets an isolated tmp dir so board.log writes don't collide.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTmpKanbanDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "kanban-test-"));
	// Create an empty board.log
	await writeFile(join(dir, "board.log"), "", "utf-8");
	return dir;
}

export async function cleanupDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

/** Seed a board.log with raw log lines for parser tests. */
export async function seedLog(dir: string, lines: string[]): Promise<void> {
	await writeFile(join(dir, "board.log"), lines.join("\n") + "\n", "utf-8");
}
