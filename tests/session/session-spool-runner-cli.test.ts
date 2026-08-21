import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manageSessionSpoolHook } from "../../lib/session-hook-installer.js";
import { runSessionSpoolRunnerCli } from "../../scripts/session-spool-runner-cli.js";

describe("session spool runner CLI", () => {
	it("requires explicit arguments and manifest", async () => {
		await expect(runSessionSpoolRunnerCli([])).rejects.toThrow(/Usage:/);
		const dir = mkdtempSync(join(tmpdir(), "session-runner-cli-missing-"));
		const source = join(dir, "source.jsonl");
		writeFileSync(source, "", "utf8");
		await expect(runSessionSpoolRunnerCli(["--registry-dir", dir, "--source-root", dir, "--source-file", "source.jsonl", "--agent-id", "a", "--name", "A", "--cwd", dir])).rejects.toThrow(/manifest/);
	});

	it("invokes the runner explicitly", async () => {
		const dir = mkdtempSync(join(tmpdir(), "session-runner-cli-"));
		const registryDir = join(dir, "registry");
		const source = join(dir, "source.jsonl");
		writeFileSync(source, `${JSON.stringify({ message: { role: "user", content: [{ type: "text", text: "hello cli" }] } })}\n`, "utf8");
		await manageSessionSpoolHook("install", { registryDir });

		const result = await runSessionSpoolRunnerCli(["--registry-dir", registryDir, "--source-root", dir, "--source-file", "source.jsonl", "--agent-id", "cli", "--name", "CLI", "--cwd", dir, "--max-events", "1"]);

		expect(result).toMatchObject({ spooled: true, manifestFound: true, eventsWritten: 1 });
	});
});
