import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addSchedule } from "../../extensions/pi-coas/schedules.js";
import { parkApproval, readApprovalArtifact } from "../../extensions/pi-coas/approval-inbox.js";
import { renderAgentDetailOverlay, showAgentDetail } from "../../extensions/pi-panopticon/ui/agent-overlay.js";
import { makeRegistry } from "./helpers.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentRecord } from "../../extensions/pi-panopticon/types.js";
import type { AgentOverlayDeps } from "../../extensions/pi-panopticon/ui/agent-overlay-types.js";
import type { AgentDetailAction } from "../../extensions/pi-panopticon/ui/agent-detail.js";

const homes: string[] = [];

function makeTheme(): Theme {
	// Test rendering only needs these two formatting functions.
	return { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
}

function workerRecord(): AgentRecord {
	return {
		id: "worker-id",
		name: "worker",
		pid: 1234,
		cwd: "/tmp/worker",
		model: "test/model",
		startedAt: Date.now(),
		heartbeat: Date.now(),
		status: "waiting",
		pendingMessages: 0,
	};
}

function otherRecord(): AgentRecord {
	return { ...workerRecord(), id: "other-id", name: "other" };
}

function makeDeps(overrides: { coasHome?: string; resumeApprovedRun?: ReturnType<typeof vi.fn> } = {}) {
	const self: AgentRecord = { ...workerRecord(), id: "self-id", name: "self" };
	const registry = makeRegistry(self, [workerRecord()]);
	return {
		selfId: self.id,
		registry,
		listMode: { get: () => "all" as const, set: () => undefined },
		sendAgentMessage: vi.fn(async () => ({ accepted: true })),
		stopAgent: vi.fn(async () => ({ accepted: true })),
		getCoasConfig: overrides.coasHome ? () => ({ coasHome: overrides.coasHome as string }) : () => undefined,
		resumeApprovedRun: overrides.resumeApprovedRun ?? vi.fn(async () => true),
	};
}

interface DetailComponent {
	render(width: number): string[];
	handleInput(data: string): void;
}

interface HarnessState {
	readonly component: DetailComponent;
	readonly done: (result: AgentDetailAction) => void;
	readonly tui: { requestRender: ReturnType<typeof vi.fn> };
	resolve(result: AgentDetailAction): void;
}

interface CustomHarness {
	readonly component: DetailComponent;
	readonly done: (result: AgentDetailAction) => void;
	readonly tui: { requestRender: ReturnType<typeof vi.fn> };
	readonly ready: Promise<void>;
	register(factory: (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => DetailComponent): Promise<AgentDetailAction>;
}

function createCustomHarness(): CustomHarness {
	let harness: HarnessState | undefined;
	let resolveReady: () => void = () => undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	return {
		get component() {
			if (!harness) throw new Error("custom factory not called");
			return harness.component;
		},
		get done() {
			if (!harness) throw new Error("custom factory not called");
			return harness.done;
		},
		get tui() {
			if (!harness) throw new Error("custom factory not called");
			return harness.tui;
		},
		ready,
		register(factory) {
			const tui = { requestRender: vi.fn() };
			let resolvePromise: (result: AgentDetailAction) => void = () => undefined;
			const done = () => resolvePromise("close");
			const component = factory(tui, makeTheme(), {}, done);
			const promise = new Promise<AgentDetailAction>((resolve) => {
				resolvePromise = resolve;
			});
			harness = { component, done: (result) => resolvePromise(result), tui, resolve: resolvePromise };
			resolveReady();
			return promise;
		},
	};
}

async function openAgentDetail(deps: ReturnType<typeof makeDeps>, agentName = "worker") {
	const harness = createCustomHarness();
	const notify = vi.fn();
	const ctx = {
		cwd: "/tmp",
		hasUI: true,
		ui: {
			notify,
			custom: vi.fn(async (factory) => harness.register(factory)),
			setEditorText: vi.fn(),
		},
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
	// Vitest mocks retain generic procedure types rather than the production callback signature.
	const promise = showAgentDetail(ctx, agentName, deps as AgentOverlayDeps);
	await harness.ready;
	return { ctx, harness, promise };
}

beforeEach(() => {
	delete process.env.PI_PRINCIPAL;
});

afterEach(async () => {
	delete process.env.PI_PRINCIPAL;
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function makeCoasHome(): Promise<string> {
	const home = join(tmpdir(), `pi-panopticon-approval-${process.pid}-${Date.now()}-${homes.length}`);
	homes.push(home);
	await mkdir(join(home, "workspace"), { recursive: true });
	return home;
}

async function makeScheduleAndArtifact(home: string, targetAgent = "worker") {
	const schedule = await addSchedule(
		{ coasHome: home },
		{ room: "general", name: "Gated", cron: "0 9 * * 1", prompt: "Run gated work.", targetAgent },
	);
	const requestId = `${schedule.taskId}-run-1`;
	await parkApproval({ config: { coasHome: home }, taskId: schedule.taskId, runId: "run-1", prompt: "Run gated work.", requestId });
	return { schedule, requestId };
}

describe("approval-inbox overlay", () => {
	it("renders pending approvals with taskId, runId, truncated prompt and createdAt", () => {
		const createdAt = "2026-08-05T12:00:00Z";
		const lines = renderAgentDetailOverlay({
			record: workerRecord(),
			selfId: "self-id",
			sessionEvents: [],
			theme: makeTheme(),
			width: 80,
			pendingApprovals: [
				{
					requestId: "gated-run-1",
					taskId: "gated",
					runId: "run-1",
					prompt: "A".repeat(120),
					createdAt,
					status: "awaiting-approval",
				},
			],
		});
		const body = lines.join("\n");
		expect(body).toContain("Pending Approvals");
		expect(body).toContain("gated");
		expect(body).toContain("run-1");
		expect(body).not.toContain("A".repeat(81));
		expect(body).toContain(createdAt);
		expect(body).toContain("Principal authority required for approvals");
	});

	it("does not render the approvals section when there are no pending approvals", () => {
		const lines = renderAgentDetailOverlay({
			record: workerRecord(),
			selfId: "self-id",
			sessionEvents: [],
			theme: makeTheme(),
			width: 80,
		});
		expect(lines.join("\n")).not.toContain("Pending Approvals");
	});

	it("shows approvals only for the selected agent", async () => {
		const home = await makeCoasHome();
		await makeScheduleAndArtifact(home, "worker");
		const deps = makeDeps({ coasHome: home });
		const { harness, promise } = await openAgentDetail(deps);
		const lines = harness.component.render(80);
		expect(lines.join("\n")).toContain("Pending Approvals");
		expect(lines.join("\n")).toContain("gated");
		harness.done("close");
		await promise;
	});

	it("omits approvals for a non-target agent", async () => {
		const home = await makeCoasHome();
		await makeScheduleAndArtifact(home, "worker");
		const self: AgentRecord = { ...workerRecord(), id: "self-id", name: "self" };
		const deps = {
			...makeDeps({ coasHome: home }),
			registry: makeRegistry(self, [otherRecord()]),
		};
		const { harness, promise } = await openAgentDetail(deps, "other");
		const lines = harness.component.render(80);
		expect(lines.join("\n")).not.toContain("Pending Approvals");
		harness.done("close");
		await promise;
	});

	it("requires principal authority to approve", async () => {
		const home = await makeCoasHome();
		const { requestId } = await makeScheduleAndArtifact(home, "worker");
		const deps = makeDeps({ coasHome: home });
		const { ctx, harness, promise } = await openAgentDetail(deps);
		harness.component.handleInput("a");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(ctx.ui.notify).toHaveBeenCalledWith("Approval decisions require principal authority", "warning");
		expect(deps.resumeApprovedRun).not.toHaveBeenCalled();
		expect((await readApprovalArtifact({ coasHome: home }, requestId))?.status).toBe("awaiting-approval");
		harness.component.handleInput("\x1b");
		await promise;
	});

	it("approves a pending run and invokes the resume path", async () => {
		process.env.PI_PRINCIPAL = "1";
		const home = await makeCoasHome();
		const { requestId } = await makeScheduleAndArtifact(home, "worker");
		const resumeApprovedRun = vi.fn(async () => true);
		const deps = makeDeps({ coasHome: home, resumeApprovedRun });
		const { harness, promise } = await openAgentDetail(deps);
		harness.component.handleInput("a");
		await vi.waitFor(async () => {
			expect((await readApprovalArtifact({ coasHome: home }, requestId))?.status).toBe("approved");
			expect(resumeApprovedRun).toHaveBeenCalledOnce();
		});
		expect(resumeApprovedRun).toHaveBeenCalledWith({ coasHome: home }, requestId);
		const afterLines = harness.component.render(80);
		expect(afterLines.join("\n")).not.toContain("Pending Approvals");
		harness.component.handleInput("\x1b");
		await promise;
	});

	it("rejects a pending run and records the terminal status", async () => {
		process.env.PI_PRINCIPAL = "1";
		const home = await makeCoasHome();
		const { requestId } = await makeScheduleAndArtifact(home, "worker");
		const deps = makeDeps({ coasHome: home });
		const { harness, promise } = await openAgentDetail(deps);
		harness.component.handleInput("r");
		await vi.waitFor(async () => {
			expect((await readApprovalArtifact({ coasHome: home }, requestId))?.status).toBe("rejected");
		});
		expect(deps.resumeApprovedRun).not.toHaveBeenCalled();
		harness.component.handleInput("\x1b");
		await promise;
	});

	it("defers a pending run and records the terminal status", async () => {
		process.env.PI_PRINCIPAL = "1";
		const home = await makeCoasHome();
		const { requestId } = await makeScheduleAndArtifact(home, "worker");
		const deps = makeDeps({ coasHome: home });
		const { harness, promise } = await openAgentDetail(deps);
		harness.component.handleInput("d");
		await vi.waitFor(async () => {
			expect((await readApprovalArtifact({ coasHome: home }, requestId))?.status).toBe("deferred");
		});
		expect(deps.resumeApprovedRun).not.toHaveBeenCalled();
		harness.component.handleInput("\x1b");
		await promise;
	});
});
