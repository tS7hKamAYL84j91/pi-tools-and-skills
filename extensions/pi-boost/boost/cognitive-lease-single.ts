/** Single-model rut-breaker lease (ADR-052 default): one planned model, no judge synthesis. */

import { planCognitiveFusion } from "./cognitive-planner.js";
import { defaultCognitiveModelRunner } from "./cognitive-runner.js";
import {
	type CognitiveLeaseExecutionOptions,
	type CognitiveLeaseResult,
	type CognitiveNodeRun,
	DEFAULT_PANEL_MODELS,
	resolveCognitiveProfile,
} from "./cognitive-types.js";

const SINGLE_SYSTEM_PROMPT =
	"Answer directly and precisely. Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.";

/** Single-model rut-breaker lease: one planned model, no judge synthesis. */
export async function executeSingleModelLease(
	options: CognitiveLeaseExecutionOptions,
): Promise<CognitiveLeaseResult> {
	const startedAt = Date.now();
	const profileSettings = resolveCognitiveProfile(options.profile);
	const runner = options.runner ?? defaultCognitiveModelRunner;
	const plan = planCognitiveFusion({
		configuredPanel: options.models ?? DEFAULT_PANEL_MODELS,
		configuredFallback: [],
		visibleModels: options.visibleModels,
		maxPanelModels: 1,
		allowProviders: options.allowProviders,
		denyProviders: options.denyProviders,
		requireApprovalAboveCalls: options.requireApprovalAboveCalls,
		profile: options.profile,
	});
	if (plan.requiresApproval) {
		throw new Error(
			`Cognitive boost single plan requires approval: estimated ${plan.estimatedCalls} model calls exceeds gate.`,
		);
	}
	const model = plan.panel[0];
	if (!model) {
		throw new Error("Cognitive boost single lease requires a usable model.");
	}
	const nodeStartedAt = Date.now();
	const run = await runner({
		model,
		prompt: options.prompt,
		systemPrompt: SINGLE_SYSTEM_PROMPT,
		maxTokens: profileSettings.panelMaxTokens,
		timeoutMs: options.timeoutMs,
		signal: options.signal,
		cwd: options.cwd,
	});
	const node: CognitiveNodeRun = {
		role: "single",
		model,
		ok: run.ok,
		output: run.output,
		durationMs: run.durationMs || Date.now() - nodeStartedAt,
		attempts: 1,
		...(run.error ? { error: run.error } : {}),
	};
	return {
		ok: node.ok,
		answer: node.ok
			? node.output
			: "Cognitive boost single lease failed: no usable model output.",
		degraded: !node.ok,
		nodes: [node],
		...(node.ok ? {} : { failureReason: node.error ?? "single_model_failed" }),
		warnings: plan.warnings,
		durationMs: Date.now() - startedAt,
	};
}