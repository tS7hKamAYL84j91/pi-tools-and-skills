/**
 * Council deliberation — pre-flight validation + 3-stage protocol.
 *
 * Each stage uses a parallel timeout for the *whole stage*, not per-member,
 * with partial-progress fallback: if some members time out or error, the
 * deliberation proceeds with whoever responded, as long as the minimum
 * threshold is met. State is persisted after each transition so an
 * orchestrator crash leaves a recoverable trail at ~/.pi/agent/councils.
 *
 * Members may be model ids (one-shot `pi --print`) or live agent references
 * (`agent:<name>`, served by mailbox round-trip).
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { askAgent } from "./agent-runner.js";
import {
	type ResolvedAgent,
	type ResolveError,
	resolveChairman,
	resolveMembers,
} from "./agent-ref.js";
import { checkHeterogeneity, type HeterogeneityCheck } from "./members.js";
import {
	chairmanSystemPrompt,
	critiquePrompt,
	critiqueSystemPrompt,
	generationSystemPrompt,
	synthesisPrompt,
} from "./prompts.js";
import {
	currentPanopticonRecord,
	type PanopticonRecord,
	runMember,
} from "./runner.js";
import type { CouncilStateManager } from "./state.js";
import type {
	CouncilDefinition,
	CouncilDeliberation,
	CouncilMember,
	CritiqueRun,
	ModelRun,
} from "./types.js";

/** @public */
export const DEFAULT_PARALLEL_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_GENERATION_FOR_CRITIQUE = 2;

type StageLabel = "generate" | "critique" | "synthesize";

// ── Pre-flight ─────────────────────────────────────────────────

/** @public */
export interface PreflightReport {
	ok: boolean;
	heterogeneity: HeterogeneityCheck;
	missingFromSnapshot: string[];
	totalCalls: number;
	reasons: string[];
	warnings: string[];
	members: CouncilMember[];
	chairman: CouncilMember | null;
	agents: ResolvedAgent[];
}

/** Resolve members and validate the council before launching a deliberation. */
export function preflight(
	definition: CouncilDefinition,
	availableSnapshot: string[],
): PreflightReport {
	const memberResolution = resolveMembers(definition.members);
	const chairResolution = resolveChairman(definition.chairman);
	const agents = [
		...memberResolution.agents,
		...(chairResolution.agent ? [chairResolution.agent] : []),
	];
	const errors: ResolveError[] = [
		...memberResolution.errors,
		...(chairResolution.error ? [chairResolution.error] : []),
	];

	const allMembers = [
		...memberResolution.members,
		...(chairResolution.chairman ? [chairResolution.chairman] : []),
	];
	const heterogeneity = checkHeterogeneity(allMembers.map((m) => m.model));
	// Snapshot validation only applies to model members. Live-agent members
	// run their own model in their own session; the orchestrator's local
	// snapshot is irrelevant to whether they can answer.
	const available = new Set(availableSnapshot);
	const missingFromSnapshot =
		availableSnapshot.length === 0
			? []
			: allMembers
					.filter((m) => !m.agentName)
					.map((m) => m.model)
					.filter((model) => !available.has(model));

	const reasons: string[] = errors.map((e) => `${e.ref}: ${e.reason}`);
	if (missingFromSnapshot.length > 0) {
		reasons.push(
			`Models not in registry snapshot: ${missingFromSnapshot.join(", ")}`,
		);
	}

	// Heterogeneity is a warning, not an error: provider-prefix matching is a
	// proxy for true model-family diversity, but proxies like OpenRouter expose
	// many distinct families under one prefix. Surface the concern, don't block.
	const warnings: string[] = [...memberResolution.warnings];
	if (!heterogeneity.ok && heterogeneity.reason) {
		warnings.push(heterogeneity.reason);
	}
	for (const agent of agents) {
		if (agent.heartbeatStale) {
			warnings.push(
				`agent "${agent.name}" heartbeat is ${Math.round(agent.heartbeatAgeMs / 1000)}s old; may not respond in time`,
			);
		}
	}

	const ok = missingFromSnapshot.length === 0 && errors.length === 0;
	return {
		ok,
		heterogeneity,
		missingFromSnapshot,
		totalCalls: definition.members.length * 2 + 1,
		reasons,
		warnings,
		members: memberResolution.members,
		chairman: chairResolution.chairman,
		agents,
	};
}

// ── Parallel stage with timeout + caller-cancellable ───────────

async function runStageParallel<T>(
	tasks: Array<(signal: AbortSignal) => Promise<T>>,
	timeoutMs: number,
	parentSignal?: AbortSignal,
): Promise<T[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onParentAbort = () => controller.abort();
	parentSignal?.addEventListener("abort", onParentAbort, { once: true });
	try {
		const settled = await Promise.allSettled(
			tasks.map((t) => t(controller.signal)),
		);
		return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener("abort", onParentAbort);
	}
}

// ── 3-stage protocol ────────────────────────────────────────────

interface DeliberateArgs {
	definition: CouncilDefinition;
	prompt: string;
	ctx: ExtensionContext;
	availableSnapshot: string[];
	stateManager: CouncilStateManager;
	parallelTimeoutMs?: number;
	onProgress?: (text: string) => void;
}

interface StageInputs {
	prompt: string;
	systemPrompt: string;
}

interface DispatchContext {
	cwd: string;
	timeoutMs: number;
	deliberationId: string;
	ourAgentId?: string;
	ourAgentName?: string;
	parentId?: string;
}

interface DispatchArgs {
	member: CouncilMember;
	stage: StageLabel;
	inputs: StageInputs;
	ctx: DispatchContext;
	signal: AbortSignal;
}

async function dispatchMember(args: DispatchArgs): Promise<ModelRun> {
	const { member, inputs, ctx, signal } = args;
	if (member.agentName && member.agentId) {
		if (!ctx.ourAgentId || !ctx.ourAgentName) {
			return {
				member,
				prompt: inputs.prompt,
				systemPrompt: inputs.systemPrompt,
				output: "",
				durationMs: 0,
				ok: false,
				error: "council orchestrator is not registered with panopticon — cannot reach live agents",
			};
		}
		const result = await askAgent({
			agentName: member.agentName,
			agentId: member.agentId,
			memberLabel: member.label,
			prompt: inputs.prompt,
			systemPrompt: inputs.systemPrompt,
			deliberationId: ctx.deliberationId,
			stage: args.stage,
			ourAgentId: ctx.ourAgentId,
			ourAgentName: ctx.ourAgentName,
			signal,
			timeoutMs: ctx.timeoutMs,
		});
		return {
			member,
			prompt: inputs.prompt,
			systemPrompt: inputs.systemPrompt,
			...result,
		};
	}
	return runMember(member, {
		prompt: inputs.prompt,
		systemPrompt: inputs.systemPrompt,
		cwd: ctx.cwd,
		signal,
		parentId: ctx.parentId,
	});
}

export async function deliberate(
	args: DeliberateArgs,
): Promise<CouncilDeliberation> {
	const timeoutMs = args.parallelTimeoutMs ?? DEFAULT_PARALLEL_TIMEOUT_MS;

	const report = preflight(args.definition, args.availableSnapshot);
	if (!report.ok || !report.chairman) {
		throw new Error(
			`Council pre-flight failed:\n  ${report.reasons.join("\n  ")}`,
		);
	}
	args.onProgress?.(
		`pre-flight ok: ${report.heterogeneity.providers.length} providers, ${report.totalCalls} model calls`,
	);
	for (const warning of report.warnings) {
		args.onProgress?.(`warning: ${warning}`);
	}

	const members = report.members;
	const chairman = report.chairman;
	const ourRecord: PanopticonRecord | undefined = await currentPanopticonRecord(
		args.ctx.cwd,
	);
	const dispatchCtx: DispatchContext = {
		cwd: args.ctx.cwd,
		timeoutMs,
		deliberationId: "",
		ourAgentId: ourRecord?.id,
		ourAgentName: ourRecord?.name,
		parentId: ourRecord?.id,
	};

	let record = args.stateManager.create({
		council: args.definition.name,
		prompt: args.prompt,
		members,
		chairman,
	});
	dispatchCtx.deliberationId = record.id;

	const runStage = (
		stageMembers: CouncilMember[],
		stage: StageLabel,
		buildInputs: (member: CouncilMember) => StageInputs,
	): Promise<ModelRun[]> =>
		runStageParallel(
			stageMembers.map(
				(member) => (signal) =>
					dispatchMember({
						member,
						stage,
						inputs: buildInputs(member),
						ctx: dispatchCtx,
						signal,
					}),
			),
			timeoutMs,
			args.ctx.signal,
		);

	// ── Stage 1: parallel generation ─────────────────────────────
	record = args.stateManager.update(record, { status: "generating" });
	args.onProgress?.(`stage 1/3 generating (${members.length} members)`);
	const generationInputs: StageInputs = {
		prompt: args.prompt,
		systemPrompt: generationSystemPrompt(),
	};
	const generation = await runStage(members, "generate", () => generationInputs);
	record = args.stateManager.update(record, { generation });
	const successfulGen = generation.filter((r) => r.ok && r.output.length > 0);
	if (successfulGen.length < MIN_GENERATION_FOR_CRITIQUE) {
		const err = `Stage 1 produced only ${successfulGen.length} usable answer(s); need ${MIN_GENERATION_FOR_CRITIQUE}.\n${formatFailures(generation)}`;
		args.stateManager.update(record, {
			status: "failed",
			error: err,
			completedAt: Date.now(),
		});
		throw new Error(err);
	}

	// ── Stage 2: anonymized peer critique ───────────────────────
	record = args.stateManager.update(record, { status: "critiquing" });
	const reviewers = successfulGen.map((r) => r.member);
	args.onProgress?.(`stage 2/3 critiquing (${reviewers.length} reviewers)`);
	const critiqueRuns = await runStage(reviewers, "critique", (viewer) => ({
		prompt: critiquePrompt({
			originalPrompt: args.prompt,
			generation: successfulGen,
			members,
			viewer,
		}),
		systemPrompt: critiqueSystemPrompt(),
	}));
	const critiques: CritiqueRun[] = critiqueRuns.map((r) => ({
		...r,
		rankings:
			r.output.match(/rank(?:ing|ings)?\s*:?([\s\S]*)/i)?.[1]?.trim() ?? "",
	}));
	record = args.stateManager.update(record, { critiques });

	// ── Stage 3: chairman synthesis ─────────────────────────────
	record = args.stateManager.update(record, { status: "synthesizing" });
	args.onProgress?.(`stage 3/3 chairman synthesis (${chairman.model})`);
	const synthesisInputs: StageInputs = {
		prompt: synthesisPrompt(record),
		systemPrompt: chairmanSystemPrompt(),
	};
	const [synthesis] = await runStage([chairman], "synthesize", () => synthesisInputs);
	const completedAt = Date.now();
	if (!synthesis?.ok) {
		const err = `Chairman synthesis failed: ${synthesis?.error ?? "no response within timeout"}`;
		record = args.stateManager.update(record, {
			...(synthesis ? { synthesis } : {}),
			status: "failed",
			error: err,
			completedAt,
		});
		throw new Error(err);
	}
	return args.stateManager.update(record, {
		synthesis,
		status: "completed",
		completedAt,
	});
}

export function formatFailures(runs: ModelRun[]): string {
	return runs
		.filter((r) => !r.ok)
		.map(
			(r) => `- ${r.member.label} (${r.member.model}): ${r.error ?? "unknown"}`,
		)
		.join("\n");
}
