/** Fusion CognitiveLease execution: panel selection, concurrent querying, and judge synthesis. */

import {
	INVALID_JUDGE_FALLBACK,
	isValidJudgeJson,
	parseJudgeJson,
	renderJudgePrompt,
} from "./cognitive-output.js";
import { planCognitiveFusion } from "./cognitive-planner.js";
import { defaultCognitiveModelRunner } from "./cognitive-runner.js";
import {
	type CognitiveJudgeOutput,
	type CognitiveLeaseExecutionOptions,
	type CognitiveLeaseResult,
	type CognitiveNodeRun,
	resolveCognitiveProfile,
} from "./cognitive-types.js";

const PANEL_SYSTEM_PROMPT =
	"Answer independently and concisely. Give only the strongest findings and evidence; do not mention other panelists.";

const JUDGE_SYSTEM_PROMPT =
	"You are the judge in an internal cognitive boost deliberation. Compare panel responses and return only valid JSON with keys: answer, consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence.";

/** Parse the bundled reviewed fallback JSON, guarded even though the constant is static. */
function parseInvalidJudgeFallback(): CognitiveJudgeOutput {
	try {
		// Bundled constant reviewed in cognitive-output.ts; assertion cannot fail at runtime for valid JSON.
		return JSON.parse(INVALID_JUDGE_FALLBACK) as CognitiveJudgeOutput;
	} catch (error) {
		throw new Error("Invalid bundled judge fallback payload", { cause: error });
	}
}

/** Execute a bounded, single-turn fusion deliberation: concurrent panel, judge synthesis. */
export async function executeFusionLease(
	options: CognitiveLeaseExecutionOptions,
): Promise<CognitiveLeaseResult> {
	const startedAt = Date.now();
	const profileSettings = resolveCognitiveProfile(options.profile);
	const runner = options.runner ?? defaultCognitiveModelRunner;
	const configuredPanel = options.models ?? [];

	const plan = planCognitiveFusion({
		configuredPanel,
		configuredJudge: options.judge,
		configuredFallback: [],
		visibleModels: options.visibleModels,
		maxPanelModels: options.panelSize ?? profileSettings.panelModels,
		allowProviders: options.allowProviders,
		denyProviders: options.denyProviders,
		requireApprovalAboveCalls: options.requireApprovalAboveCalls,
		profile: options.profile,
	});

	if (plan.requiresApproval) {
		throw new Error(
			`Cognitive boost fusion plan requires approval: estimated ${plan.estimatedCalls} model calls exceeds gate.`,
		);
	}

	// Step 1: Concurrently query all selected panel models.
	const panelRuns: CognitiveNodeRun[] = await Promise.all(
		plan.panel.map(async (model, index): Promise<CognitiveNodeRun> => {
			const nodeStartedAt = Date.now();
			const role = `panel_${index + 1}`;
			try {
				const res = await runner({
					model,
					prompt: options.prompt,
					systemPrompt: PANEL_SYSTEM_PROMPT,
					maxTokens: profileSettings.panelMaxTokens,
					timeoutMs: options.timeoutMs,
					signal: options.signal,
					cwd: options.cwd,
				});
				return {
					role,
					model,
					ok: res.ok,
					output: res.output,
					durationMs: res.durationMs || Date.now() - nodeStartedAt,
					attempts: 1,
					...(res.error ? { error: res.error } : {}),
				};
			} catch (err) {
				return {
					role,
					model,
					ok: false,
					output: "",
					durationMs: Date.now() - nodeStartedAt,
					attempts: 1,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}),
	);

	const usablePanel = panelRuns.filter((node) => node.ok && node.output.trim());

	// If no panel model succeeded, fail gracefully with degraded status.
	if (usablePanel.length === 0) {
		return {
			ok: false,
			answer:
				"Cognitive boost fusion failed: no panel model produced usable output.",
			degraded: true,
			nodes: panelRuns,
			failureReason: "all_panels_failed",
			warnings: plan.warnings,
			durationMs: Date.now() - startedAt,
		};
	}

	if (options.signal?.aborted) {
		return {
			ok: false,
			answer: "Cognitive boost fusion aborted.",
			degraded: true,
			nodes: panelRuns,
			failureReason: "aborted",
			warnings: plan.warnings,
			durationMs: Date.now() - startedAt,
		};
	}

	// Step 2: Render bounded judge prompt and synthesize with the judge model.
	const judgePrompt = renderJudgePrompt(
		options.prompt,
		usablePanel,
		profileSettings.promptMaxChars,
		profileSettings.panelMaxChars,
	);

	const judgeStartedAt = Date.now();
	let judgeRun: CognitiveNodeRun;
	try {
		const judgeRes = await runner({
			model: plan.judge,
			prompt: judgePrompt,
			systemPrompt: JUDGE_SYSTEM_PROMPT,
			maxTokens: profileSettings.judgeMaxTokens,
			timeoutMs: options.timeoutMs,
			signal: options.signal,
			cwd: options.cwd,
		});
		judgeRun = {
			role: "judge",
			model: plan.judge,
			ok: judgeRes.ok,
			output: judgeRes.output,
			durationMs: judgeRes.durationMs || Date.now() - judgeStartedAt,
			attempts: 1,
			...(judgeRes.error ? { error: judgeRes.error } : {}),
		};
	} catch (err) {
		judgeRun = {
			role: "judge",
			model: plan.judge,
			ok: false,
			output: "",
			durationMs: Date.now() - judgeStartedAt,
			attempts: 1,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	const allNodes = [...panelRuns, judgeRun];

	// Step 3: Validate judge output and produce the synthesized result.
	if (judgeRun.ok && isValidJudgeJson(judgeRun.output)) {
		const analysis = parseJudgeJson(judgeRun.output);
		if (analysis) {
			const degraded = panelRuns.some((node) => !node.ok);
			return {
				ok: !degraded,
				answer: analysis.answer,
				analysis,
				degraded,
				nodes: allNodes,
				warnings: plan.warnings,
				durationMs: Date.now() - startedAt,
			};
		}
	}

	// Fallback when judge response is invalid or judge query failed.
	const fallbackAnalysis = parseInvalidJudgeFallback();
	return {
		ok: false,
		answer: fallbackAnalysis.answer,
		analysis: fallbackAnalysis,
		degraded: true,
		nodes: allNodes,
		failureReason: judgeRun.ok
			? "invalid_judge_json"
			: (judgeRun.error ?? "judge_failed"),
		warnings: plan.warnings,
		durationMs: Date.now() - startedAt,
	};
}
