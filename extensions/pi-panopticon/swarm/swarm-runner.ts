/** Bounded worker-pool lifecycle and per-swarm claim accounting. */

import { maybeGovernanceRoute } from "../../../lib/coas-governance.js";
import { rpcWrite } from "../../../lib/spawn-rpc.js";
import {
	buildArgList,
	gracefulKill,
	spawnChild,
} from "../../../lib/spawn-service.js";
import { buildSpawnEnv } from "../spawner/spawner-launch.js";
import type {
	SwarmPlan,
	SwarmRecord,
	SwarmTask,
	SwarmWorkerAdapter,
	SwarmWorkerHandle,
	SwarmWorkerRequest,
} from "./swarm-types.js";

const HARD_WIP_CAP = 3;

/** Creates the production adapter from panopticon's existing spawn primitives. */
export function createSwarmWorkerAdapter(selfId: string): SwarmWorkerAdapter {
	return {
		spawn(request: SwarmWorkerRequest): SwarmWorkerHandle {
			const model = request.model;
			const agent = spawnChild({
				name: request.name,
				cwd: request.cwd,
				args: buildArgList({ name: request.name, model, tools: request.tools }),
				model,
				env: buildSpawnEnv(selfId, request.name, request.scope),
			});
			if (!rpcWrite(agent, { type: "prompt", message: request.brief })) {
				agent.proc.kill("SIGTERM");
				throw new Error(`Unable to send brief to worker '${request.name}'.`);
			}
			return {
				name: request.name,
				stop: async () => gracefulKill(agent, (worker) => {
					rpcWrite(worker, { type: "abort" });
				}),
			};
		},
	};
}

function boundedWip(wip: number): number {
	if (!Number.isInteger(wip) || wip < 1) return 1;
	return Math.min(wip, HARD_WIP_CAP);
}

function dependenciesDone(task: SwarmTask, plan: SwarmPlan): boolean {
	return task.dependencies.every(
		(dependency) => plan.tasks.find((candidate) => candidate.id === dependency)?.state === "done",
	);
}

/** Owns one active swarm and never permits more than three claimed tasks. */
export class SwarmRunner {
	private readonly records = new Map<string, SwarmRecord>();
	private readonly workers = new Map<string, SwarmWorkerHandle>();
	private activeSwarmId?: string;

	constructor(private readonly adapter: SwarmWorkerAdapter) {}

	start(plan: SwarmPlan, cwd: string, requestedWip = HARD_WIP_CAP): SwarmRecord {
		if (this.activeSwarmId) throw new Error("A swarm is already active in this session.");
		if (plan.state === "blocked") {
			const blocked: SwarmRecord = {
				plan,
				state: "blocked",
				config: { profile: plan.profile, wip: boundedWip(requestedWip), cwd },
			};
			this.records.set(plan.swarmId, blocked);
			return blocked;
		}
		const record: SwarmRecord = {
			plan,
			state: "running",
			config: { profile: plan.profile, wip: boundedWip(requestedWip), cwd },
			startedAt: Date.now(),
		};
		this.records.set(plan.swarmId, record);
		this.activeSwarmId = plan.swarmId;
		this.claimAvailable(plan.swarmId);
		return record;
	}

	claimAvailable(swarmId: string): SwarmTask[] {
		const record = this.requireRecord(swarmId);
		if (record.state !== "running") return [];
		const claimed = record.plan.tasks.filter((task) => task.state === "in_progress").length;
		let remaining = Math.max(0, record.config.wip - claimed);
		const started: SwarmTask[] = [];
		for (const task of record.plan.tasks) {
			if (remaining === 0) break;
			if (task.state !== "pending" || !dependenciesDone(task, record.plan)) continue;
			this.spawnTask(record, task);
			started.push(task);
			remaining -= 1;
		}
		return started;
	}

	get(swarmId: string): SwarmRecord | undefined {
		return this.records.get(swarmId);
	}

	list(): SwarmRecord[] {
		return [...this.records.values()];
	}

	async stop(swarmId: string, reason = "cancelled"): Promise<SwarmRecord> {
		const record = this.requireRecord(swarmId);
		const stopping = record.plan.tasks.filter((task) => task.state === "in_progress");
		await Promise.all(stopping.map((task) => this.stopTask(task)));
		for (const task of stopping) task.state = "blocked";
		record.state = "aborted";
		record.stopReason = reason;
		record.finishedAt = Date.now();
		if (this.activeSwarmId === swarmId) this.activeSwarmId = undefined;
		return record;
	}

	async shutdown(): Promise<void> {
		if (this.activeSwarmId) await this.stop(this.activeSwarmId, "session shutdown");
	}

	private spawnTask(record: SwarmRecord, task: SwarmTask): void {
		const workerName = `${record.plan.swarmId}-${task.id}`;
		const routing = maybeGovernanceRoute(task.brief, "code", record.config.cwd);
		const request: SwarmWorkerRequest = {
			name: workerName,
			brief: task.brief,
			cwd: record.config.cwd,
			model: routing.resolvedModel,
			tools: task.allowedTools,
			scope: "task",
		};
		const worker = this.adapter.spawn(request);
		task.workerName = worker.name;
		task.state = "in_progress";
		this.workers.set(task.id, worker);
	}

	private async stopTask(task: SwarmTask): Promise<void> {
		const worker = this.workers.get(task.id);
		if (worker) await worker.stop();
		this.workers.delete(task.id);
	}

	private requireRecord(swarmId: string): SwarmRecord {
		const record = this.records.get(swarmId);
		if (!record) throw new Error(`Unknown swarm '${swarmId}'.`);
		return record;
	}
}
