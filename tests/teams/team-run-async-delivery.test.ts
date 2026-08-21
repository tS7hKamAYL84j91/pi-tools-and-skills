/** End-to-end regression coverage for asynchronous public team-run delivery. */
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import { registerTeamRunTool } from "../../extensions/pi-panopticon/teams/team-runtime.js";
import {
	createFakeApi,
	withTempProjectRoot,
	writeConsultTeam,
	writeSubagent,
} from "./team-test-helpers.js";

vi.mock("../../extensions/pi-panopticon/spawner/spawn-service.js", () => ({
	resolvePiBinary: () =>
		process.env.PI_TEAMS_TEST_PI_BINARY ?? process.execPath,
}));

const tempDirs: string[] = [];
const CHILD_RESULT_MARKER = "FAKE_ASYNC_TEAM_CHILD_RESULT";

afterEach(() => {
	delete process.env.PI_TEAMS_TEST_PI_BINARY;
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function createFakePi(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-teams-async-delivery-"));
	tempDirs.push(dir);
	const script = join(dir, "fake-pi.js");
	writeFileSync(
		script,
		[
			"#!/usr/bin/env node",
			"let stdin = '';",
			"process.stdin.setEncoding('utf8');",
			"process.stdin.on('data', (chunk) => { stdin += chunk; });",
			"process.stdin.on('end', () => {",
			`  const text = '${CHILD_RESULT_MARKER} promptLength=' + stdin.length;`,
			"  process.stdout.write(JSON.stringify({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] }) + '\\n');",
			"});",
		].join("\n"),
		"utf8",
	);
	chmodSync(script, 0o755);
	return script;
}

function createProjectTeams(project: string): void {
	const teamsRoot = join(project, ".pi", "teams");
	mkdirSync(join(teamsRoot, "agents"), { recursive: true });
	mkdirSync(join(teamsRoot, "teams"), { recursive: true });
	mkdirSync(join(project, ".pi"), { recursive: true });
	writeFileSync(
		join(project, ".pi", "settings.json"),
		JSON.stringify({ teams: { roots: [".pi/teams"] } }),
		"utf8",
	);
	writeSubagent(teamsRoot, "fake_navigator", null);
	writeConsultTeam(teamsRoot, "navigator", "fake_navigator", "test/fake");
	writeConsultTeam(teamsRoot, "consultant", "fake_navigator", "test/fake");
}

describe("team_run async follow-up delivery", () => {
	it("delivers non-empty fake child output as follow-ups for navigator and consultant", async () => {
		await withTempProjectRoot("pi-teams-async-delivery-", async (project) => {
			createProjectTeams(project);
			process.env.PI_TEAMS_TEST_PI_BINARY = createFakePi();
			const { api, tools, userMessages } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new TeamStateManager() });
			const teamRun = tools.get("team_run");
			if (!teamRun) throw new Error("team_run missing");
			const prompt = "0123456789".repeat(1600);
			const ctx = {
				cwd: project,
				ui: { setStatus() {}, setWidget() {} },
			};

			// Both IDs dispatch through the consult handler; exercising both guards the shared async delivery path.
			for (const id of ["navigator", "consultant"]) {
				const result = await teamRun.execute(
					"test",
					{ id, prompt, profile: "fast", async: true },
					undefined,
					undefined,
					ctx,
				);
				expect(result.content[0]?.text).toContain("started asynchronously");
			}

			expect(prompt.length).toBeGreaterThanOrEqual(16000);
			await vi.waitFor(() => expect(userMessages).toHaveLength(2));
			for (const followUp of userMessages) {
				expect(followUp.options).toEqual({ deliverAs: "followUp" });
				expect(followUp.message).not.toHaveLength(0);
				expect(followUp.message).toContain(CHILD_RESULT_MARKER);
				const childPromptLength = /promptLength=(\d+)/.exec(
					followUp.message,
				)?.[1];
				expect(Number(childPromptLength)).toBeGreaterThanOrEqual(prompt.length);
			}
			expect(userMessages.map(({ message }) => message).join("\n")).toContain(
				'[Team "navigator" async result]',
			);
			expect(userMessages.map(({ message }) => message).join("\n")).toContain(
				'[Team "consultant" async result]',
			);
		});
	});
});
