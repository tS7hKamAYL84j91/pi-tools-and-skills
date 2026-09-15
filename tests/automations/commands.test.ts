import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAutomationsCommands } from "../../extensions/pi-automations/commands.js";
import type { PiScheduler } from "../../extensions/pi-automations/pi-scheduler.js";

interface CommandDefinition {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface CommandFixture {
	commands: Map<string, CommandDefinition>;
	notify: ReturnType<typeof vi.fn>;
	custom: ReturnType<typeof vi.fn>;
	ctx: ExtensionCommandContext;
	scheduler: PiScheduler;
}

function makeCommandFixture(cwd: string): CommandFixture {
	const commands = new Map<string, CommandDefinition>();
	const notify = vi.fn();
	const custom = vi.fn(async <T>(): Promise<T | undefined> => undefined);
	const api = {
		registerCommand(name: string, definition: CommandDefinition) {
			commands.set(name, definition);
		},
	} as unknown as ExtensionAPI;
	const scheduler = {
		snapshot: vi.fn(() => ({ running: false, enabledSchedules: 0, activeRuns: 0, spawnedRuns: 0 })),
		reconcile: vi.fn(async () => undefined),
	} as unknown as PiScheduler;
	registerAutomationsCommands(api, scheduler);
	const ctx = { cwd, ui: { notify, custom } } as unknown as ExtensionCommandContext;
	return { commands, notify, custom, ctx, scheduler };
}

async function makeAutomationsHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "pi-automations-command-"));
	await mkdir(join(home, "workspace", "briefing", ".pi", "automations"), { recursive: true });
	await writeFile(join(home, "workspace", "briefing", ".pi", "automations", "workspace.env"), "WORKSPACE_ID=briefing\nPURPOSE=Daily briefing\n");
	await writeFile(join(home, "workspace", "briefing", "CONTEXT.md"), "# Briefing\n");
	return home;
}

describe("Automations slash commands", () => {
	let home: string | undefined;

	afterEach(async () => {
		if (home) await rm(home, { recursive: true, force: true });
		home = undefined;
		vi.unstubAllEnvs();
	});

	it("registers the complete command surface", async () => {
		home = await makeAutomationsHome();
		const fixture = makeCommandFixture(home);
		expect([...fixture.commands.keys()]).toEqual([
			"automations", "automations-status", "automations-doctor", "automations-workspaces", "automations-schedules", "pi-scheduler",
		]);
	});

	it("dispatches subcommands via /automations", async () => {
		home = await makeAutomationsHome();
		vi.stubEnv("AUTOMATIONS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("automations")?.handler("workspaces --text", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("Automations workspaces", "info");
		expect(fixture.custom).toHaveBeenCalled();
	});

	it("parses --text for workspaces and renders the result headlessly", async () => {
		home = await makeAutomationsHome();
		vi.stubEnv("AUTOMATIONS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("automations-workspaces")?.handler("  --text  ", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("Automations workspaces", "info");
		expect(fixture.custom).toHaveBeenCalled();
	});

	it("treats unknown workspace arguments as interactive mode rather than text mode", async () => {
		home = await makeAutomationsHome();
		vi.stubEnv("AUTOMATIONS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("automations-workspaces")?.handler("--json", fixture.ctx);
		expect(fixture.custom).toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it("renders status, doctor, and scheduler responses", async () => {
		home = await makeAutomationsHome();
		vi.stubEnv("AUTOMATIONS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("automations-status")?.handler("", fixture.ctx);
		await fixture.commands.get("automations-doctor")?.handler("", fixture.ctx);
		await fixture.commands.get("pi-scheduler")?.handler("", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("Automations status", "info");
		expect(fixture.notify).toHaveBeenCalledWith(expect.stringContaining("Automations doctor exit="), expect.any(String));
		expect(fixture.notify).toHaveBeenCalledWith("Pi scheduler", "info");
		expect(fixture.scheduler.reconcile).toHaveBeenCalled();
	});
});
