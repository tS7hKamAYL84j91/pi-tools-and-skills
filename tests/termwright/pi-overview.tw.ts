/**
 * Real-terminal acceptance for the pi-overview extension, using the termwright
 * driver directly in a plain Vitest run.
 *
 * Launches pi in a private temp project that loads only `pi-overview`, accepts
 * the trust prompt, runs `/overview`, asserts the live project facts, and closes
 * with esc. No model call is made: the command is local.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchTerminal, type TerminalHarness } from "@termwright/driver";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const dirs: string[] = [];
let session: TerminalHarness | undefined;

afterAll(async () => {
	await session?.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedProject(cwd: string): void {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify(
			{
				packages: [
					{
						source: repoRoot,
						extensions: ["extensions/pi-overview/index.ts"],
						skills: [],
						themes: [],
					},
				],
			},
			null,
			2,
		),
	);
	const git = (...args: string[]): void => {
		execFileSync("git", args, { cwd, stdio: "ignore" });
	};
	git("init", "-q");
	git("config", "user.email", "probe@example.com");
	git("config", "user.name", "Probe");
	writeFileSync(join(cwd, "a.txt"), "one\n");
	git("add", ".");
	git("commit", "-q", "-m", "probe: initial commit");
	// One tracked modification so the panel reports a non-zero dirty count.
	writeFileSync(join(cwd, "a.txt"), "two\n");
}

describe("pi-overview in a real terminal", () => {
	it("renders project facts and esc returns to the composer", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-overview-tui-"));
		dirs.push(cwd);
		seedProject(cwd);

		session = await launchTerminal({
			command: ["pi"],
			cwd,
			columns: 120,
			rows: 40,
		});
		const app = session;

		// First run in an untrusted folder: accept the trust prompt.
		await app.waitForText("Trust project folder?");
		await app.press("Enter");
		await app.waitForText(/\/ commands/);

		await app.type("/overview");
		await app.press("Enter");
		await app.waitForText("Project overview");

		const screen = app.screen().text();
		expect(screen).toContain("workspace");
		expect(screen).toContain("recent commits");
		expect(screen).toContain("probe: initial commit");
		expect(screen).toMatch(/uncommitted/);
		// Structural only: the hint wording is cosmetic copy and moves with key
		// bindings. The behaviour that matters is asserted below by pressing Escape.
		expect(screen).toMatch(/esc.*close/i);

		await app.press("Escape");
		await app.getByScreenText("Project overview").waitFor({ state: "hidden" });
	});
});
