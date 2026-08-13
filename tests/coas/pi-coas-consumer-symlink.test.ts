import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listApprovalArtifacts } from "../../extensions/pi-coas/approval-inbox.js";
import { appendScheduleLog } from "../../extensions/pi-coas/scheduler-log.js";
import { loadRunState } from "../../extensions/pi-coas/scheduler-run-state.js";
import { listSchedules, removeSchedule } from "../../extensions/pi-coas/schedules.js";
import { coasStatus } from "../../extensions/pi-coas/status.js";
import { readWorkspaceContext } from "../../extensions/pi-coas/workspace-context.js";

const roots: string[] = [];

async function createRoot(label: string): Promise<string> {
	const root = join(tmpdir(), `pi-coas-consumer-${label}-${process.pid}-${Date.now()}-${roots.length}`);
	roots.push(root);
	await mkdir(root, { recursive: true });
	return root;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CoAS production consumer symlink confinement", () => {
	it("rejects symlinked schedule entries and prompt targets", async () => {
		const home = await createRoot("schedule-list");
		const outside = await createRoot("schedule-outside");
		const schedules = join(home, "schedules");
		await mkdir(schedules);
		await writeFile(join(outside, "linked.env"), "TASK_ID=linked\n", "utf8");
		await symlink(join(outside, "linked.env"), join(schedules, "linked.env"));

		await expect(listSchedules({ coasHome: home })).rejects.toThrow(/symlinked CoAS directory entry/);

		await rm(join(schedules, "linked.env"));
		const prompt = join(schedules, "daily.prompt");
		await writeFile(join(outside, "prompt.txt"), "outside", "utf8");
		await symlink(join(outside, "prompt.txt"), prompt);
		await writeFile(join(schedules, "daily.env"), [
			"TASK_ID=daily",
			"TASK_NAME=Daily",
			"ROOM_ID=general",
			"WORKSPACE_ID=room-a",
			"CRON_EXPR=0 9 * * 1",
			`PROMPT_FILE=${prompt}`,
			"ENABLED=1",
			"",
		].join("\n"));
		await expect(listSchedules({ coasHome: home })).rejects.toThrow(/symlinked CoAS directory entry/);
	});

	it("validates all schedule removals before mutating any file", async () => {
		const home = await createRoot("schedule-remove");
		const outside = await createRoot("remove-outside");
		const schedules = join(home, "schedules");
		await mkdir(join(home, "schedule-runs"), { recursive: true });
		await mkdir(schedules);
		const envPath = join(schedules, "daily.env");
		await writeFile(envPath, "TASK_ID=daily\n", "utf8");
		await writeFile(join(home, "schedule-runs", "daily.json"), "{}\n", "utf8");
		await writeFile(join(outside, "prompt.txt"), "outside", "utf8");
		await symlink(join(outside, "prompt.txt"), join(schedules, "daily.prompt"));

		await expect(removeSchedule({ coasHome: home }, "daily")).rejects.toThrow(/symlinked CoAS path component/);
		await expect(readFile(envPath, "utf8")).resolves.toBe("TASK_ID=daily\n");
	});

	it("rejects symlinked workspace and approval entries through status and inbox consumers", async () => {
		const home = await createRoot("status");
		const outside = await createRoot("status-outside");
		await mkdir(join(home, "workspace"));
		await symlink(outside, join(home, "workspace", "linked"));
		await expect(coasStatus({ coasHome: home })).rejects.toThrow(/symlinked CoAS directory entry/);

		await mkdir(join(home, "schedule-runs", "awaiting-approval"), { recursive: true });
		await writeFile(join(outside, "request.json"), "{}\n", "utf8");
		await symlink(join(outside, "request.json"), join(home, "schedule-runs", "awaiting-approval", "request.json"));
		await expect(listApprovalArtifacts({ coasHome: home })).rejects.toThrow(/symlinked CoAS directory entry/);
	});

	it("rejects external workspace context symlinks after metadata authorization", async () => {
		const home = await createRoot("workspace-home");
		const workspace = await createRoot("external-workspace");
		const outside = await createRoot("workspace-outside");
		await mkdir(join(workspace, ".pi", "coas"), { recursive: true });
		await writeFile(join(workspace, ".pi", "coas", "workspace.env"), "WORKSPACE_ID=external\n", "utf8");
		await writeFile(join(outside, "CONTEXT.md"), "outside", "utf8");
		await symlink(join(outside, "CONTEXT.md"), join(workspace, "CONTEXT.md"));

		await expect(readWorkspaceContext({ coasHome: home }, workspace, workspace)).rejects.toThrow(/symlinked CoAS path component/);
	});

	it("rejects symlinked run-state and schedule-log roots", async () => {
		const home = await createRoot("runtime");
		const outside = await createRoot("runtime-outside");
		await mkdir(join(home, "schedule-runs"));
		await writeFile(join(outside, "daily.json"), "{}\n", "utf8");
		await symlink(join(outside, "daily.json"), join(home, "schedule-runs", "daily.json"));
		await expect(loadRunState({ coasHome: home }, "daily")).rejects.toThrow(/symlinked CoAS path component/);

		await mkdir(join(home, "logs"));
		await symlink(outside, join(home, "logs", "schedules"));
		await expect(appendScheduleLog({ coasHome: home }, "daily", "QUEUED")).rejects.toThrow(/symlinked CoAS path component/);
	});
});
