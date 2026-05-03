/**
 * PAIR-CODING orchestration — bounded Driver/Navigator review-then-fix loop.
 *
 * Conceptually a 2-member council with role-specific prompts and strictly
 * sequential phases:
 *
 *   1. preparing context     — load AGENTS.md / spec / files
 *   2. navigator brief       — restate the prompt or return a clarification
 *   3. driver implementation — produce the artifact
 *   4. navigator review      — concrete defects (or "looks good")
 *   5. driver fix pass       — bounded fix; can repeat up to maxFixPasses
 *   6. complete
 *
 * Each phase is wrapped in a per-phase AbortController bounded by timeoutMs
 * AND chained to the caller's ctx.signal so Ctrl-C still aborts.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadPairContext, type PairContext } from "./context-loader.js";
import { resolveTeamSettings } from "./settings.js";
import { promptAssetLines, promptAssetText, type PromptCatalog } from "./prompt-resolver.js";
import { formatProtocolContext } from "./protocol-prompts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { currentPanopticonRecord, runMember } from "./runner.js";
import type { TeamParticipant, GenerationConfig, ModelRun } from "./types.js";

const DEFAULT_PAIR_PHASE_TIMEOUT_MS = 5 * 60 * 1000;
const DRIVER_LABEL = "Driver";
const NAVIGATOR_LABEL = "Navigator";

function defaultWorkflowPrompts(catalog: PromptCatalog): WorkflowPromptInputs {
	return {
		navigatorBriefSystem: promptAssetText(catalog, "pairNavigatorBriefSystem"),
		driverImplementationSystem: promptAssetText(catalog, "pairDriverImplementationSystem"),
		navigatorReviewSystem: promptAssetText(catalog, "pairNavigatorReviewSystem"),
		driverFixSystem: promptAssetText(catalog, "pairDriverFixSystem"),
		navigatorBriefTemplate: promptAssetLines(catalog, "pairNavigatorBriefTemplate"),
		driverImplementationTemplate: promptAssetLines(catalog, "pairDriverImplementationTemplate"),
		navigatorReviewTemplate: promptAssetLines(catalog, "pairNavigatorReviewTemplate"),
		driverFixTemplate: promptAssetLines(catalog, "pairDriverFixTemplate"),
	};
}

/** @public */
export type WorkflowPhase =
	| "preparing context"
	| "navigator brief"
	| "driver implementation"
	| "navigator review"
	| "driver fix pass"
	| "complete";

/** @public */
export interface WorkflowResult {
	mode: "PAIR";
	ok: boolean;
	summary: string;
	context: { projectRoot: string; loaded: string[]; warnings: string[] };
	phases: Array<{
		name: WorkflowPhase;
		durationMs: number;
		ok: boolean;
		error?: string;
	}>;
	navigatorBrief?: ModelRun;
	driverImplementation?: ModelRun;
	reviews: ModelRun[];
	fixes: ModelRun[];
	errors: string[];
}

interface WorkflowPromptInputs {
	navigatorBriefSystem: string;
	driverImplementationSystem: string;
	navigatorReviewSystem: string;
	driverFixSystem: string;
	navigatorBriefTemplate: readonly string[];
	driverImplementationTemplate: readonly string[];
	navigatorReviewTemplate: readonly string[];
	driverFixTemplate: readonly string[];
}

interface PairArgs {
	ctx: ExtensionContext;
	prompt: string;
	driver: string;
	navigator: string;
	driverConfig?: GenerationConfig;
	navigatorConfig?: GenerationConfig;
	prompts?: WorkflowPromptInputs;
	files?: string[];
	specPath?: string;
	maxFixPasses?: number;
	timeoutMs?: number;
	onProgress?: (label: string) => void;
}

/** Run the bounded PAIR-CODING workflow. */
export async function runPairCoding(args: PairArgs): Promise<WorkflowResult> {
	const settings = resolveTeamSettings();
	const promptInputs = args.prompts ?? defaultWorkflowPrompts(settings.prompts);
	const phases: WorkflowResult["phases"] = [];
	const errors: string[] = [];
	const reviews: ModelRun[] = [];
	const fixes: ModelRun[] = [];
	const driver: TeamParticipant = {
		label: DRIVER_LABEL,
		model: args.driver,
		...(args.driverConfig ?? {}),
	};
	const navigator: TeamParticipant = {
		label: NAVIGATOR_LABEL,
		model: args.navigator,
		...(args.navigatorConfig ?? {}),
	};
	const fixPasses = Math.max(0, args.maxFixPasses ?? 1);
	const timeoutMs = args.timeoutMs ?? DEFAULT_PAIR_PHASE_TIMEOUT_MS;

	args.onProgress?.("preparing context");
	const t0 = Date.now();
	const context = loadPairContext({
		cwd: args.ctx.cwd,
		specPath: args.specPath,
		files: args.files,
	});
	phases.push({
		name: "preparing context",
		durationMs: Date.now() - t0,
		ok: true,
	});
	const parentId = (await currentPanopticonRecord(args.ctx.cwd))?.id;

	const phaseCtx: PhaseCtx = { args, parentId, phases, errors, timeoutMs };
	const contextText = formatProtocolContext(context);

	const navigatorBrief = await runPhase(phaseCtx, {
		name: "navigator brief",
		member: navigator,
		label: "navigator brief",
		build: () => ({
			prompt: renderTemplate([...promptInputs.navigatorBriefTemplate], { context: contextText, prompt: args.prompt }),
			systemPrompt: promptInputs.navigatorBriefSystem,
		}),
	});
	if (!navigatorBrief.ok)
		return done({ context, phases, errors, navigatorBrief, reviews, fixes });

	const driverImplementation = await runPhase(phaseCtx, {
		name: "driver implementation",
		member: driver,
		label: "driver implementation",
		build: () => ({
			prompt: renderTemplate([...promptInputs.driverImplementationTemplate], {
				context: contextText,
				prompt: args.prompt,
				navigatorBrief: navigatorBrief.output,
			}),
			systemPrompt: promptInputs.driverImplementationSystem,
		}),
	});
	if (!driverImplementation.ok) {
		return done({
			context,
			phases,
			errors,
			navigatorBrief,
			driverImplementation,
			reviews,
			fixes,
		});
	}

	let currentArtifact = driverImplementation.output;
	for (let pass = 1; pass <= fixPasses; pass++) {
		const review = await runPhase(phaseCtx, {
			name: "navigator review",
			member: navigator,
			label: `navigator review (pass ${pass}/${fixPasses})`,
			build: () => ({
				prompt: renderTemplate([...promptInputs.navigatorReviewTemplate], {
					context: contextText,
					prompt: args.prompt,
					driverArtifact: currentArtifact,
				}),
				systemPrompt: promptInputs.navigatorReviewSystem,
			}),
		});
		reviews.push(review);
		if (!review.ok) break;

		const fix = await runPhase(phaseCtx, {
			name: "driver fix pass",
			member: driver,
			label: `driver fix pass (${pass}/${fixPasses})`,
			build: () => ({
				prompt: renderTemplate([...promptInputs.driverFixTemplate], {
					prompt: args.prompt,
					driverArtifact: currentArtifact,
					navigatorReview: review.output,
				}),
				systemPrompt: promptInputs.driverFixSystem,
			}),
		});
		fixes.push(fix);
		if (!fix.ok) break;
		currentArtifact = fix.output;
	}

	return done({
		context,
		phases,
		errors,
		navigatorBrief,
		driverImplementation,
		reviews,
		fixes,
		finalArtifact: currentArtifact,
	});
}

// ── Per-phase execution with timeout ────────────────────────────

interface PhaseCtx {
	args: PairArgs;
	parentId: string | undefined;
	phases: WorkflowResult["phases"];
	errors: string[];
	timeoutMs: number;
}

interface PhaseInputs {
	prompt: string;
	systemPrompt: string;
}

interface PhaseDescriptor {
	name: WorkflowPhase;
	member: TeamParticipant;
	label: string;
	build: () => PhaseInputs;
}

async function runPhase(
	ctx: PhaseCtx,
	phase: PhaseDescriptor,
): Promise<ModelRun> {
	ctx.args.onProgress?.(phase.label);
	const inputs = phase.build();
	const t = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
	const onParentAbort = () => controller.abort();
	ctx.args.ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
	let run: ModelRun;
	try {
		run = await runMember(phase.member, {
			prompt: inputs.prompt,
			systemPrompt: inputs.systemPrompt,
			cwd: ctx.args.ctx.cwd,
			signal: controller.signal,
			parentId: ctx.parentId,
		});
	} finally {
		clearTimeout(timer);
		ctx.args.ctx.signal?.removeEventListener("abort", onParentAbort);
	}
	ctx.phases.push({
		name: phase.name,
		durationMs: Date.now() - t,
		ok: run.ok,
		...(run.error ? { error: run.error } : {}),
	});
	if (!run.ok && run.error) ctx.errors.push(`${phase.name}: ${run.error}`);
	return run;
}

// ── Result finalisation ────────────────────────────────────────

interface FinalisingArgs {
	context: PairContext;
	phases: WorkflowResult["phases"];
	errors: string[];
	navigatorBrief?: ModelRun;
	driverImplementation?: ModelRun;
	reviews: ModelRun[];
	fixes: ModelRun[];
	finalArtifact?: string;
}

function done(args: FinalisingArgs): WorkflowResult {
	args.phases.push({
		name: "complete",
		durationMs: 0,
		ok: args.errors.length === 0,
	});
	const lastFix = args.fixes[args.fixes.length - 1];
	const summary =
		args.finalArtifact ??
		lastFix?.output ??
		args.driverImplementation?.output ??
		args.navigatorBrief?.output ??
		"(no output)";
	return {
		mode: "PAIR",
		ok: args.errors.length === 0,
		summary,
		context: {
			projectRoot: args.context.projectRoot,
			loaded: args.context.loaded.map((l) => l.path),
			warnings: args.context.warnings,
		},
		phases: args.phases,
		...(args.navigatorBrief ? { navigatorBrief: args.navigatorBrief } : {}),
		...(args.driverImplementation
			? { driverImplementation: args.driverImplementation }
			: {}),
		reviews: args.reviews,
		fixes: args.fixes,
		errors: args.errors,
	};
}
