import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { GOAL_BINDING_CUSTOM_TYPE } from "../../extensions/pi-goal/goal-binding.js";
import { registerGoalCommands } from "../../extensions/pi-goal/goal-commands.js";
import { createTextGoal, transactGoalAt, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { getGoalRuntime } from "../../extensions/pi-goal/goal-runtime.js";
import { goalPaths } from "../../extensions/pi-goal/goal-types.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("T-886 caller migration regressions", () => {
	it("commits unbound creation to the generated instance before binding", async () => {
		const cwd = await temporaryDirectory();
		await writeFile(join(cwd, "goal.txt"), "unbound goal", "utf8");
		const host = createHost(cwd);
		await runCommand(host, "file goal.txt");
		const binding = host.bindings.at(-1);
		expect(binding).toBeTypeOf("string");
		const state = await readInstance(cwd, binding as string);
		expect(state.objective).toContain("goal.txt");
		await expect(readFile(join(cwd, ".pi/goal/goal.json"))).rejects.toThrow();
	});

	it("replaces an inactive binding without targeting the old instance", async () => {
		const cwd = await temporaryDirectory();
		const host = createHost(cwd);
		const old = await createTextGoal(cwd, "old", host.contextScope());
		await transactGoalAt(cwd, old.goalId, "absent", () => old);
		host.appendBinding(old.goalId);
		await writeFile(join(cwd, "goal.txt"), "new goal", "utf8");
		await runCommand(host, "file goal.txt");
		const nextId = host.bindings.at(-1);
		expect(nextId).not.toBe(old.goalId);
		expect((await readInstance(cwd, old.goalId)).objective).toBe("old");
		expect((await readInstance(cwd, nextId as string)).objective).toContain("goal.txt");
	});

	it("reports committed-but-unbound when binding append fails", async () => {
		const cwd = await temporaryDirectory();
		await writeFile(join(cwd, "goal.txt"), "binding failure", "utf8");
		const host = createHost(cwd, true);
		await expect(runCommand(host, "file goal.txt")).rejects.toThrow("binding append failed");
		expect(host.bindings).toHaveLength(0);
		expect((await findInstanceIds(cwd)).length).toBe(1);
	});

	it("conditionally clears artifacts without touching siblings or unknown files", async () => {
		const cwd = await temporaryDirectory();
		const host = createHost(cwd);
		const state = await createTextGoal(cwd, "clear", host.contextScope());
		await transactGoalAt(cwd, state.goalId, "absent", () => state);
		host.appendBinding(state.goalId);
		const paths = goalPaths(cwd, state.goalId);
		await mkdir(join(paths.dir, "runs/2026/01/01"), { recursive: true });
		await writeFile(join(paths.dir, "runs/2026/01/01", "attempt.jsonl"), "run", "utf8");
		await writeFile(join(paths.dir, "runs/2026/01/01", "unknown.txt"), "preserve nested", "utf8");
		await writeFile(join(paths.dir, "unknown.txt"), "preserve", "utf8");
		const sibling = await createTextGoal(cwd, "sibling", host.contextScope());
		await transactGoalAt(cwd, sibling.goalId, "absent", () => sibling);
		await runCommand(host, "clear");
		await expect(readFile(paths.statePath)).rejects.toThrow();
		await expect(readFile(join(paths.dir, "unknown.txt"), "utf8")).resolves.toBe("preserve");
		await expect(readFile(join(goalPaths(cwd, sibling.goalId).dir, "goal.json"))).resolves.toBeTruthy();
		expect(host.bindings.at(-1)).toBeNull();
	});

	it("removes normal generated run artifacts while preserving unknown contents", async () => {
		const cwd = await temporaryDirectory();
		const host = createHost(cwd);
		const state = await createTextGoal(cwd, "generated cleanup", host.contextScope());
		await transactGoalAt(cwd, state.goalId, "absent", () => state);
		host.appendBinding(state.goalId);
		const paths = goalPaths(cwd, state.goalId);
		const runDir = join(paths.runsPath, "2026/01/01");
		await mkdir(runDir, { recursive: true });
		const generatedJsonl = join(runDir, "run-iter-001.jsonl");
		const generatedMarkdown = join(runDir, "run-iter-001.md");
		const unknown = join(runDir, "attempt.jsonl");
		await writeFile(generatedJsonl, "generated", "utf8");
		await writeFile(generatedMarkdown, "generated", "utf8");
		await writeFile(unknown, "preserve", "utf8");

		await runCommand(host, "clear");

		await expect(readFile(generatedJsonl)).rejects.toThrow();
		await expect(readFile(generatedMarkdown)).rejects.toThrow();
		await expect(readFile(unknown, "utf8")).resolves.toBe("preserve");
	});

	it("surfaces unsafe nested run cleanup and preserves the unknown target", async () => {
		const cwd = await temporaryDirectory();
		const host = createHost(cwd);
		const state = await createTextGoal(cwd, "unsafe clear", host.contextScope());
		await transactGoalAt(cwd, state.goalId, "absent", () => state);
		host.appendBinding(state.goalId);
		const paths = goalPaths(cwd, state.goalId);
		await mkdir(join(paths.runsPath, "nested"), { recursive: true });
		await writeFile(join(paths.runsPath, "nested", "unknown.txt"), "keep", "utf8");
		await symlink(join(paths.runsPath, "nested", "unknown.txt"), join(paths.runsPath, "nested", "unknown-link"));
		await expect(runCommand(host, "clear")).rejects.toThrow("cleanup failed");
		await expect(readFile(join(paths.runsPath, "nested", "unknown.txt"), "utf8")).resolves.toBe("keep");
	});

	it("returns conflict and projection-failed outcomes without retrying", async () => {
		const cwd = await temporaryDirectory();
		const state = await createTextGoal(cwd, "conflict", undefined);
		const created = await transactGoal(cwd, undefined, "absent", () => state);
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const stale = await transactGoal(cwd, undefined, { goalId: created.state.goalId, revision: 0 }, (current) => ({ ...current!, objective: "stale" }));
		expect(stale.status).toBe("conflict");
		const paths = goalPaths(cwd);
		await rm(paths.summaryPath, { force: true });
		await mkdir(paths.summaryPath, { recursive: true });
		const failed = await transactGoal(cwd, undefined, { goalId: created.state.goalId, revision: created.state.revision }, (current) => ({ ...current!, objective: "projection" }));
		expect(failed).toMatchObject({ status: "applied", projection: "failed" });
	});
});

interface TestHost {
	readonly cwd: string;
	readonly bindings: Array<string | null>;
	readonly contextScope: () => ReturnType<typeof createScope>;
	readonly appendBinding: (goalId: string | null) => void;
	readonly command: { readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
	readonly context: ExtensionCommandContext;
}

function createScope(cwd: string, branch: unknown[], append: (goalId: string | null) => void) {
	return { cwd, sessionManager: { getBranch: () => branch, getSessionFile: () => undefined }, appendBinding: async (goalId: string | null) => append(goalId) };
}

function createHost(cwd: string, failBinding = false): TestHost {
	const branch: unknown[] = [];
	const bindings: Array<string | null> = [];
	const appendBinding = (goalId: string | null): void => {
		if (failBinding) throw new Error("binding append failed");
		bindings.push(goalId);
		branch.push({ type: "custom", customType: GOAL_BINDING_CUSTOM_TYPE, data: { goalId } });
	};
	const commands = new Map<string, { readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const pi = {
		registerCommand(name: string, command: { readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) { commands.set(name, command); },
		registerTool: () => undefined,
		on: () => undefined,
		appendEntry: (_type: string, data: { readonly goalId: string | null }) => appendBinding(data.goalId),
		sendMessage: () => undefined,
		sendUserMessage: () => {
			queueMicrotask(() => getGoalRuntime().resolve?.([]));
		},
	} as unknown as ExtensionAPI;
	registerGoalCommands(pi, getGoalRuntime());
	const context = createContext(cwd, branch, () => undefined);
	return {
		cwd,
		bindings,
		contextScope: () => createScope(cwd, branch, appendBinding),
		appendBinding,
		command: commands.get("goal")!,
		context,
	} as TestHost & { readonly context: ExtensionCommandContext };
}

function createContext(cwd: string, branch: unknown[], _notify: () => void): ExtensionCommandContext {
	return {
		cwd,
		ui: { setStatus: () => undefined, setWidget: () => undefined, notify: () => undefined },
		waitForIdle: async () => undefined,
		sessionManager: { getBranch: () => branch, getSessionFile: () => undefined },
		newSession: async () => ({ cancelled: true }),
		sendUserMessage: async () => undefined,
		hasPendingMessages: () => false,
		isIdle: () => true,
	} as unknown as ExtensionCommandContext;
}

async function runCommand(host: TestHost & { readonly context: ExtensionCommandContext }, args: string): Promise<void> {
	await host.command.handler(args, host.context);
}

async function readInstance(cwd: string, goalId: string): Promise<GoalState> {
	return JSON.parse(await readFile(join(goalPaths(cwd, goalId).statePath), "utf8")) as GoalState;
}

async function findInstanceIds(cwd: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	return readdir(join(cwd, ".pi/goal/instances"));
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "t-886-caller-regression-"));
	directories.push(directory);
	return directory;
}
