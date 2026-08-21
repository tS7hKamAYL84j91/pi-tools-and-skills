import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTeamRunAsync } from "../../extensions/pi-teams/team-async.js";
import {
	readTeamRunResultArtifact,
	teamRunResultArtifactPath,
	writeTeamRunResultArtifact,
} from "../../extensions/pi-teams/team-result-artifact.js";
import { resolveTeamResultRoot } from "../../extensions/pi-teams/team-paths.js";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("team result artifact ownership", () => {
	it("honors the configured user team root without using cwd or COAS_HOME", () => {
		const cwd = tempDir("team-result-cwd-");
		const configuredRoot = join(tempDir("team-result-user-"), "team-root");
		const settingsPath = join(tempDir("team-result-settings-"), "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ teams: { roots: [configuredRoot] } }));
		process.env.COAS_HOME = tempDir("team-result-coas-");
		try {
			expect(resolveTeamResultRoot(cwd, settingsPath)).toBe(join(configuredRoot, "results"));
		} finally {
			delete process.env.COAS_HOME;
		}
	});

	it("rejects run IDs that are not safe basenames", () => {
		const root = tempDir("team-result-root-");
		for (const runId of ["../escape", "a/b", ".", "", "run.json", `r${"x".repeat(128)}`]) {
			expect(() => teamRunResultArtifactPath(runId, root)).toThrow(/Invalid team run id/);
		}
	});

	it("writes private directories and files and reads the same artifact", async () => {
		const resultRoot = join(tempDir("team-result-modes-"), "teams", "results");
		const written = await writeTeamRunResultArtifact(
			"team-safe-run",
			"result",
			{ team: "test-team", status: "completed", ok: true },
			resultRoot,
		);

		expect(lstatSync(resultRoot).mode & 0o777).toBe(0o700);
		expect(lstatSync(written.path).mode & 0o777).toBe(0o600);
		expect(await readTeamRunResultArtifact("team-safe-run", resultRoot)).toEqual(written.artifact);
	});

	it("uses the writer root for async claim-check delivery", async () => {
		const resultRoot = join(tempDir("team-result-async-"), "results");
		const messages: string[] = [];
		const runId = "team-async-safe";
		startTeamRunAsync({
			pi: { sendUserMessage: (message) => {
				if (typeof message === "string") messages.push(message);
			} },
			params: { id: "test-team", prompt: "test", async: true },
			ctx: { ui: { setStatus() {} } } as never,
			resultRoot,
			run: async (_params, writerRoot) => {
				await writeTeamRunResultArtifact(
					runId,
					"artifact result",
					{ team: "test-team", status: "completed", ok: true },
					writerRoot,
				);
				return { content: [{ type: "text", text: "fallback result" }], details: { runId } };
			},
		});

		await vi.waitFor(() => expect(messages).toHaveLength(1));
		expect(messages[0]).toContain("artifact result");
		expect(messages[0]).not.toContain("fallback result");
	});

	it("fails closed when the result root is symlinked", async () => {
		const parent = tempDir("team-result-link-");
		const target = tempDir("team-result-target-");
		const resultRoot = join(parent, "results");
		mkdirSync(target, { recursive: true });
		symlinkSync(target, resultRoot, "dir");

		await expect(writeTeamRunResultArtifact(
			"team-safe-run",
			"result",
			{ team: "test-team", status: "completed", ok: true },
			resultRoot,
		)).rejects.toThrow(/symlink/);
		expect(await readTeamRunResultArtifact("team-safe-run", resultRoot)).toBeUndefined();
	});
});
