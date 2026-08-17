import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { describe, expect, it, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { approveApproval, listApprovalArtifacts, parkApproval, readApprovalArtifact, rejectApproval } from "../../extensions/pi-coas/approval-inbox.js";
import { ConfinedStore } from "../../extensions/pi-coas/store.js";
import { registerCoasApprovalTools } from "../../extensions/pi-coas/tools-approval.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";
import type { ToolResult } from "../../lib/tool-result.js";

const homes: string[] = [];

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: () => resolvePromise?.() };
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

interface RegisteredApprovalTool {
	readonly name: string;
	execute(
		id: string,
		params: { readonly requestId: string; readonly cwd?: string },
		signal: AbortSignal,
		onUpdate: () => void,
		ctx: { readonly cwd: string },
	): Promise<ToolResult>;
}

afterEach(async () => {
	vi.restoreAllMocks();
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
	delete process.env.PI_PRINCIPAL;
	delete process.env[COAS_WORKSPACE_ID_ENV];
	delete process.env[PANOPTICON_SCOPE_ENV];
	delete process.env[PANOPTICON_SPAWN_NAME_ENV];
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
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
		const calls: string[] = [];
		const scheduler = new CoasInternalScheduler({ sendUserMessage(message: string) { calls.push(message); }, getSessionName() { return undefined; } } as never);
		await scheduler.reconcile({ coasHome: home });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
		const artifacts = await listApprovalArtifacts({ coasHome: home });
		expect(artifacts).toHaveLength(1);
		const requestId = artifacts[0]?.requestId;
		if (!requestId) throw new Error("approval artifact was not created");
		const artifact = await readApprovalArtifact({ coasHome: home }, requestId);
		expect(artifact?.status).toBe("awaiting-approval");
		expect(requestId).toContain(`-${artifact?.runId}`);
		expect(scheduler.snapshot().awaitingApprovalCount).toBe(1);
		expect(calls).toHaveLength(0);
		expect(scheduler.snapshot().queued).toBe(0);
		expect(await readFile(join(home, "schedule-runs", "awaiting-approval", `${requestId}.json`), "utf8")).toContain("awaiting-approval");
		process.env.PI_PRINCIPAL = "1";
		expect((await approveApproval({ coasHome: home }, requestId)).status).toBe("approved");
		expect(await scheduler.resumeApprovedRun({ coasHome: home }, requestId)).toBe(true);
		expect(calls).toHaveLength(1);
		await scheduler.handleAgentEnd([{ role: "user", content: calls[0] }, { role: "assistant", content: "DONE: gated work." }]);
		expect((await readApprovalArtifact({ coasHome: home }, requestId))?.status).toBe("completed");
		expect(scheduler.snapshot().awaitingApprovalCount).toBe(0);
		await scheduler.stop();
	});

	it("returns a failed tool result when an approved run cannot resume", async () => {
		const project = join(tmpdir(), `pi-coas-approval-tool-${process.pid}-${Date.now()}`);
		homes.push(project);
		const home = join(project, ".pi", "coas");
		await mkdir(join(home, "workspace"), { recursive: true });
		await parkApproval({ config: { coasHome: home }, taskId: "task", runId: "run", prompt: "prompt", requestId: "request" });
		process.env.PI_PRINCIPAL = "1";
		const tools = new Map<string, RegisteredApprovalTool>();
		const resumeApprovedRun = vi.fn(async () => false);
		registerCoasApprovalTools({
			registerTool(definition: RegisteredApprovalTool) {
				tools.set(definition.name, definition);
			},
		} as never, resumeApprovedRun);
		const approve = tools.get("coas_approval_approve");
		if (!approve) throw new Error("approval tool was not registered");

		const result = await approve.execute(
			"tool-call",
			{ requestId: "request", cwd: project },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("could not be resumed");
		expect(resumeApprovedRun).toHaveBeenCalledOnce();
		expect((await readApprovalArtifact({ coasHome: home }, "request"))?.status).toBe("approved");
	});

	it("keeps concurrent approve and reject results consistent with the final decision", async () => {
		const home = join(tmpdir(), `pi-coas-approval-decision-${process.pid}-${Date.now()}`);
		homes.push(home);
		await parkApproval({ config: { coasHome: home }, taskId: "task", runId: "run", prompt: "prompt", requestId: "request" });
		process.env.PI_PRINCIPAL = "1";

		const results = await Promise.all([
			approveApproval({ coasHome: home }, "request"),
			rejectApproval({ coasHome: home }, "request"),
		]);
		const final = await readApprovalArtifact({ coasHome: home }, "request");
		expect(final?.status === "approved" || final?.status === "rejected").toBe(true);
		expect(results.map((result) => result.status)).toEqual([final?.status, final?.status]);
		expect(existsSync(join(home, "schedule-runs", "awaiting-approval", "request.json.lock"))).toBe(false);
	});

	it("serializes concurrent reject and approve decisions before dispatch", async () => {
		const project = join(tmpdir(), `pi-coas-approval-race-${process.pid}-${Date.now()}`);
		homes.push(project);
		const home = join(project, ".pi", "coas");
		await mkdir(join(home, "workspace"), { recursive: true });
		await parkApproval({ config: { coasHome: home }, taskId: "task", runId: "run", prompt: "prompt", requestId: "request" });
		process.env.PI_PRINCIPAL = "1";

		const rejectWriteStarted = deferred();
		const releaseRejectWrite = deferred();
		const originalWrite = ConfinedStore.prototype.writePrivateFileAtomic;
		let heldReject = false;
		vi.spyOn(ConfinedStore.prototype, "writePrivateFileAtomic").mockImplementation(async function(this: ConfinedStore, path, content) {
			const artifact = JSON.parse(content) as { readonly status?: unknown };
			if (artifact.status === "rejected" && !heldReject) {
				heldReject = true;
				rejectWriteStarted.resolve();
				await releaseRejectWrite.promise;
			}
			await originalWrite.call(this, path, content);
		});

		const tools = new Map<string, RegisteredApprovalTool>();
		const resumeApprovedRun = vi.fn(async () => true);
		registerCoasApprovalTools({
			registerTool(definition: RegisteredApprovalTool) {
				tools.set(definition.name, definition);
			},
		} as never, resumeApprovedRun);
		const reject = tools.get("coas_approval_reject");
		const approve = tools.get("coas_approval_approve");
		if (!reject || !approve) throw new Error("approval tools were not registered");
		const signal = new AbortController().signal;
		const context = { cwd: process.cwd() };

		const rejectPending = reject.execute("reject", { requestId: "request", cwd: project }, signal, () => {}, context);
		await rejectWriteStarted.promise;
		const approvePending = approve.execute("approve", { requestId: "request", cwd: project }, signal, () => {}, context);
		const approveState = await Promise.race([
			approvePending.then(() => "resolved" as const),
			delay(100).then(() => "blocked" as const),
		]);
		expect(approveState).toBe("blocked");
		expect(resumeApprovedRun).not.toHaveBeenCalled();

		releaseRejectWrite.resolve();
		await Promise.all([rejectPending, approvePending]);
		expect((await readApprovalArtifact({ coasHome: home }, "request"))?.status).toBe("rejected");
		expect(resumeApprovedRun).not.toHaveBeenCalled();
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
