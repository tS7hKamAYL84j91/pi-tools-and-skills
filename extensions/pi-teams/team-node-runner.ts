/** Shared direct team role-node execution primitive. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isLiveAgentRef, liveAgentModel, runLiveAgentNode } from "./live-agent.js";
import { runMember } from "./runner.js";
import type { TeamAgentBinding } from "./team-types.js";
import type { ModelRun } from "./types.js";

export interface NodeRun {
	role: string;
	binding: TeamAgentBinding;
	model: string;
	ok: boolean;
	output: string;
	durationMs: number;
	attempts: number;
	error?: string;
}

export function modelForBinding(binding: TeamAgentBinding, fallback?: string): string | undefined {
	if (isLiveAgentRef(binding.subagent)) return liveAgentModel(binding.subagent) ?? binding.model ?? fallback ?? binding.subagent;
	return binding.model ?? fallback;
}

export function participantsFromRuns(runs: readonly NodeRun[]): ModelRun[] {
	return runs.map((run) => ({
		member: { label: run.binding.label ?? run.role, model: run.model },
		prompt: "",
		systemPrompt: "",
		output: run.output,
		durationMs: run.durationMs,
		ok: run.ok,
		...(run.error ? { error: run.error } : {}),
	}));
}

export function nodeDetails(nodes: readonly NodeRun[]): Array<Record<string, unknown>> {
	return nodes.map((node) => ({
		role: node.role,
		model: node.model,
		ok: node.ok,
		durationMs: node.durationMs,
		attempts: node.attempts,
		...(node.error ? { error: node.error } : {}),
	}));
}

export async function runTeamNode(args: {
	binding: TeamAgentBinding;
	role: string;
	model: string;
	prompt: string;
	systemPrompt: string;
	ctx: ExtensionContext;
	parentId?: string;
	orchestratorName?: string;
	timeoutMs?: number;
	maxRetries?: number;
}): Promise<NodeRun> {
	const startedAt = Date.now();
	const retries = isLiveAgentRef(args.binding.subagent) ? 0 : args.maxRetries ?? args.binding.maxRetries ?? 0;
	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		const controller = new AbortController();
		const timeout = args.timeoutMs ? setTimeout(() => controller.abort(), args.timeoutMs) : undefined;
		const onParentAbort = () => controller.abort();
		args.ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
		try {
			const run = await runRoleCall({ ...args, signal: controller.signal });
			const error = controller.signal.aborted && !args.ctx.signal?.aborted ? "timeout" : run.error;
			if (!run.ok && error !== "timeout" && !args.ctx.signal?.aborted && attempt <= retries) continue;
			return nodeRunFromModelRun({ args, run, startedAt, attempts: attempt, error });
		} catch (error) {
			const message = controller.signal.aborted && !args.ctx.signal?.aborted ? "timeout" : error instanceof Error ? error.message : String(error);
			if (message !== "timeout" && !args.ctx.signal?.aborted && attempt <= retries) continue;
			return failedNodeRun(args, startedAt, attempt, message);
		} finally {
			if (timeout) clearTimeout(timeout);
			args.ctx.signal?.removeEventListener("abort", onParentAbort);
		}
	}
	throw new Error("unreachable team node retry state.");
}

async function runRoleCall(args: Parameters<typeof runTeamNode>[0] & { signal: AbortSignal }): Promise<ModelRun> {
	if (isLiveAgentRef(args.binding.subagent)) {
		return runLiveAgentNode({
			binding: args.binding,
			model: args.model,
			prompt: args.prompt,
			systemPrompt: args.systemPrompt,
			signal: args.signal,
			parentId: args.parentId,
			orchestratorName: args.orchestratorName,
		});
	}
	return runMember({
		label: args.binding.label ?? args.role,
		model: args.model,
		...(args.binding.tools !== undefined ? { tools: args.binding.tools } : {}),
		...(args.binding.parameters !== undefined ? { parameters: args.binding.parameters } : {}),
	}, {
		prompt: args.prompt,
		systemPrompt: args.systemPrompt,
		cwd: args.ctx.cwd,
		signal: args.signal,
		parentId: args.parentId,
	});
}

function nodeRunFromModelRun(input: {
	args: Parameters<typeof runTeamNode>[0];
	run: ModelRun;
	startedAt: number;
	attempts: number;
	error?: string;
}): NodeRun {
	return {
		role: input.args.role,
		binding: input.args.binding,
		model: input.args.model,
		ok: input.run.ok,
		output: input.run.output,
		durationMs: Date.now() - input.startedAt,
		attempts: input.attempts,
		...(input.error ? { error: input.error } : {}),
	};
}

function failedNodeRun(args: Parameters<typeof runTeamNode>[0], startedAt: number, attempts: number, error: string): NodeRun {
	return {
		role: args.role,
		binding: args.binding,
		model: args.model,
		ok: false,
		output: "",
		durationMs: Date.now() - startedAt,
		attempts,
		error,
	};
}
