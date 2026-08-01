import { describe, expect, it, afterEach } from "vitest";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { approveApproval, listApprovalArtifacts, parkApproval, readApprovalArtifact } from "../../extensions/pi-coas/approval-inbox.js";

const homes: string[] = [];

afterEach(async () => {
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
	delete process.env.PI_PRINCIPAL;
	delete process.env.COAS_WORKSPACE_ID;
});

describe("CoAS approval inbox", () => {
	it("parks a gated scheduled run durably and does not complete or deliver it", async () => {
		const home = join(tmpdir(), `pi-coas-approval-${process.pid}-${Date.now()}`);
		homes.push(home);
		const schedules = join(home, "schedules");
		await mkdir(schedules, { recursive: true });
		const promptPath = join(schedules, "gated.prompt");
		await writeFile(promptPath, "Run gated work.\n", "utf8");
		await writeFile(join(schedules, "gated.env"), [
			"TASK_ID=gated",
			"TASK_NAME=Gated",
			"ROOM_ID=general",
			"WORKSPACE_ID=room-a",
			"CRON_EXPR=0 9 * * 1",
			`PROMPT_FILE=${promptPath}`,
			"APPROVAL_REQUIRED=1",
			"ENABLED=1",
			"",
		].join("\n"));
		process.env.COAS_WORKSPACE_ID = "room-a";
		const calls: string[] = [];
		const scheduler = new CoasInternalScheduler({ sendUserMessage(message: string) { calls.push(message); }, getSessionName() { return undefined; } } as never);
		await scheduler.reconcile({ coasHome: home });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		const artifacts = await listApprovalArtifacts({ coasHome: home });
		expect(artifacts).toHaveLength(1);
		const requestId = artifacts[0]?.requestId;
		if (!requestId) throw new Error("approval artifact was not created");
		const artifact = await readApprovalArtifact({ coasHome: home }, requestId);
		expect(artifact?.status).toBe("awaiting-approval");
		expect(calls).toHaveLength(0);
		expect(scheduler.snapshot().queued).toBe(0);
		expect(await readFile(join(home, "schedule-runs", "awaiting-approval", `${requestId}.json`), "utf8")).toContain("awaiting-approval");
		scheduler.stop();
	});

	it("requires principal authority for approval decisions", async () => {
		const home = join(tmpdir(), `pi-coas-approval-principal-${process.pid}-${Date.now()}`);
		homes.push(home);
		await mkdir(home, { recursive: true });
		await parkApproval({ config: { coasHome: home }, taskId: "task", runId: "run", prompt: "prompt", requestId: "request" });
		await expect(approveApproval({ coasHome: home }, "request")).rejects.toThrow(/principal authority/);
		process.env.PI_PRINCIPAL = "1";
		expect((await approveApproval({ coasHome: home }, "request")).status).toBe("approved");
	});
});
