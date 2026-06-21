import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manageSessionSpoolHook } from "../../lib/session-hook-installer.js";
import { runSessionSpoolSelectCli } from "../../lib/session-spool-select-cli.js";

function writeSession(path: string, seconds: number, text: string): void {
	writeFileSync(path, `${JSON.stringify({ message: { role: "user", content: [{ type: "text", text }] } })}\n`, "utf8");
	const date = new Date(seconds * 1000);
	utimesSync(path, date, date);
}

describe("session spool select CLI", () => {
	it("discovers read-only by default and reports an explicit next command", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-select-discover-"));
		writeSession(join(root, "session.jsonl"), 10, "hello");

		const result = await runSessionSpoolSelectCli(["--source-root", root]);

		expect(result).toMatchObject({
			mode: "discover",
			sources: [expect.objectContaining({ index: 0, relativePath: "session.jsonl" })],
		});
		expect(JSON.stringify(result)).toContain("--pick N --spool");
	});

	it("requires both pick and spool before invoking the runner", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-select-guard-"));
		writeSession(join(root, "session.jsonl"), 10, "hello");

		await expect(runSessionSpoolSelectCli(["--source-root", root, "--pick", "0"])).rejects.toThrow(/--pick N and --spool/);
		await expect(runSessionSpoolSelectCli(["--source-root", root, "--spool"])).rejects.toThrow(/--pick N and --spool/);
		await expect(runSessionSpoolSelectCli(["--source-root", root, "--pick", "99", "--spool", "--registry-dir", root, "--agent-id", "a", "--name", "A", "--cwd", root])).rejects.toThrow(/out of range/);
	});

	it("spools one explicitly selected discovered session", async () => {
		const root = mkdtempSync(join(tmpdir(), "session-select-spool-"));
		const registryDir = mkdtempSync(join(tmpdir(), "session-select-registry-"));
		mkdirSync(join(root, "nested"));
		writeSession(join(root, "old.jsonl"), 10, "old");
		writeSession(join(root, "nested", "new.jsonl"), 20, "new");
		await manageSessionSpoolHook("install", { registryDir });

		const result = await runSessionSpoolSelectCli([
			"--source-root",
			root,
			"--pick",
			"0",
			"--spool",
			"--registry-dir",
			registryDir,
			"--agent-id",
			"selected",
			"--name",
			"Selected",
			"--cwd",
			root,
			"--max-events",
			"1",
		]);

		expect(result).toMatchObject({
			mode: "spool",
			selected: { index: 0, relativePath: join("nested", "new.jsonl") },
			result: { spooled: true, manifestFound: true, eventsWritten: 1 },
		});
	});
});
