import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listRecentSessionSources } from "../lib/session-source-discovery.js";
import { runSessionSourceCli } from "../lib/session-source-cli.js";

function touch(path: string, seconds: number): void {
	writeFileSync(path, "{}\n", "utf8");
	const date = new Date(seconds * 1000);
	utimesSync(path, date, date);
}

describe("session source discovery", () => {
	it("returns empty list for missing or empty source roots", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-source-empty-"));
		await expect(listRecentSessionSources({ sourceRoot: join(root, "missing") })).resolves.toEqual([]);
		await expect(listRecentSessionSources({ sourceRoot: root })).resolves.toEqual([]);
	});

	it("lists session files by recency and ignores junk", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-source-"));
		mkdirSync(join(root, "nested"));
		touch(join(root, "old.jsonl"), 10);
		touch(join(root, "nested", "new.jsonl"), 20);
		writeFileSync(join(root, "notes.txt"), "ignore", "utf8");

		const sources = await listRecentSessionSources({ sourceRoot: root });

		expect(sources.map((source) => source.relativePath)).toEqual([join("nested", "new.jsonl"), "old.jsonl"]);
		expect(sources[0]?.path).toContain(root);
	});

	it("honors limit and stable tie ordering", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-source-limit-"));
		touch(join(root, "b.jsonl"), 10);
		touch(join(root, "a.jsonl"), 10);

		const sources = await listRecentSessionSources({ sourceRoot: root, limit: 1 });

		expect(sources.map((source) => source.relativePath)).toEqual(["a.jsonl"]);
	});

	it("CLI uses explicit test override without mutating files", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-source-cli-"));
		const file = join(root, "session.jsonl");
		touch(file, 10);

		const sources = await runSessionSourceCli(["--source-root", root, "--limit", "5"]);

		expect(sources).toEqual([expect.objectContaining({ relativePath: "session.jsonl" })]);
	});

	it("rejects a file source root", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-source-bad-"));
		const file = join(root, "not-dir.jsonl");
		touch(file, 10);

		await expect(listRecentSessionSources({ sourceRoot: file })).rejects.toThrow(/sourceRoot/);
	});
});
