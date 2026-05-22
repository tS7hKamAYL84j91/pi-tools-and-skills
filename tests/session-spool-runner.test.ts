import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manageSessionSpoolHook } from "../lib/session-hook-installer.js";
import { runSessionSpoolOnce } from "../lib/session-spool-runner.js";
import { readSessionLog } from "../lib/session-log.js";

function sourceFile(dir: string, lines: unknown[]): string {
	const path = join(dir, "source.jsonl");
	writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
	return path;
}

describe("session spool runner", () => {
	it("requires explicit source and installed manifest gate", async () => {
		const dir = mkdtempSync(join(tmpdir(), "session-runner-gate-"));
		const source = sourceFile(dir, []);

		await expect(runSessionSpoolOnce({ registryDir: dir, sourceFile: "../outside.jsonl", sourceRoot: dir, agentId: "a", name: "A", cwd: dir })).rejects.toThrow(/sourceFile must stay inside sourceRoot/);
		await expect(runSessionSpoolOnce({ registryDir: dir, sourceFile: source, sourceRoot: dir, agentId: "a", name: "A", cwd: dir })).rejects.toThrow(/manifest/);
	});

	it("spools redacted bounded output readable by Panopticon session parser", async () => {
		const dir = mkdtempSync(join(tmpdir(), "session-runner-"));
		await manageSessionSpoolHook("install", { registryDir: dir, retentionEvents: 2 });
		const email = ["local", "example.test"].join("@");
		const source = sourceFile(dir, [
			{ message: { role: "user", timestamp: 1, content: [{ type: "text", text: `first ${email}` }] } },
			{ message: { role: "assistant", timestamp: 2, content: [{ type: "toolCall", name: "read", input: { path: "a.md", rawPayload: "private" } }] } },
			{ message: { role: "assistant", timestamp: 3, content: [{ type: "text", text: "last event" }] } },
		]);

		const before = readFileSync(source, "utf8");
		const result = await runSessionSpoolOnce({ registryDir: dir, sourceFile: "source.jsonl", sourceRoot: dir, agentId: "claude-local", name: "Claude Local", cwd: dir });

		expect(result).toMatchObject({ spooled: true, manifestFound: true, eventsWritten: 2, prunedFiles: 0 });
		const output = readFileSync(result.sessionFile ?? "", "utf8");
		expect(output).not.toContain(email);
		expect(output).toContain("rawPayload=[OMITTED]");
		expect(readSessionLog(result.sessionFile ?? "", 10)).toHaveLength(2);
		expect(readFileSync(source, "utf8")).toBe(before);
	});

	it("handles malformed source lines and uninstall rollback", async () => {
		const dir = mkdtempSync(join(tmpdir(), "session-runner-rollback-"));
		await manageSessionSpoolHook("install", { registryDir: dir });
		const path = join(dir, "source.jsonl");
		writeFileSync(path, "{not-json}\n", "utf8");

		const result = await runSessionSpoolOnce({ registryDir: dir, sourceFile: path, sourceRoot: dir, agentId: "bad", name: "Bad", cwd: dir });

		expect(result.omitted).toBeGreaterThan(0);
		expect(existsSync(result.registryPath ?? "")).toBe(true);
		await manageSessionSpoolHook("uninstall", { registryDir: dir });
		expect(existsSync(join(dir, "session-spool-hook.json"))).toBe(false);
	});
});
