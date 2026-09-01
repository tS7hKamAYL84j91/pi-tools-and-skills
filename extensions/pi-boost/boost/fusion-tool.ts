/** Principal and policy-authorized `boost_fusion` tool for multi-model cognitive boost deliberation. */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../../lib/tool-result.js";
import { resolveEffectiveBoostSettings } from "../boost-settings.js";
import { executeCognitiveLease } from "./cognitive-lease.js";
import { MAX_BOOST_FUSION_PROMPT_BYTES } from "./cognitive-parser.js";
import type {
	CognitiveAuditSink,
	CognitiveModelRunner,
	CognitiveProfile,
} from "./cognitive-types.js";
import type { BoostIdentitySource } from "./identity-source.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
	type BoostHostCapabilities,
} from "./host-capabilities.js";

function readCognitiveProfile(value: unknown): CognitiveProfile | undefined {
	return value === "fast" || value === "balanced" || value === "thorough"
		? value
		: undefined;
}

function getVisibleTextModels(ctx: ExtensionContext): readonly string[] {
	const available = ctx.modelRegistry.getAvailable();
	return available
		.filter((model) => model.input.includes("text"))
		.map((model) => `${model.provider}/${model.id}`);
}

interface BoostFusionToolOptions {
	readonly runner?: CognitiveModelRunner;
	readonly hostCapabilities?: BoostHostCapabilities;
	readonly audit?: CognitiveAuditSink;
}

/** Register the `boost_fusion` tool for cognitive deliberation. */
export function registerBoostFusionTool(
	pi: ExtensionAPI,
	identitySource: BoostIdentitySource,
	options: BoostFusionToolOptions = {},
): void {
	const hostCapabilities =
		options.hostCapabilities ?? DEFAULT_BOOST_HOST_CAPABILITIES;
	const { runner, audit } = options;
	pi.registerTool({
		name: "boost_fusion",
		label: "Boost Fusion",
		description:
			"Boost the current blocker with a single frontier model (rut-breaker lease, no judge). Explicit panelSize opts into multi-model fusion deliberation with judge synthesis.",
		promptSnippet:
			"Run a bounded cognitive boost lease: single boost model by default, or an explicit fusion panel with judge synthesis.",
		promptGuidelines: [
			"Use boost_fusion for complex research, architecture trade-offs, expert critiques, and high-stakes reasoning where multiple model viewpoints and synthesis improve accuracy.",
			"The tool returns a synthesized final answer along with structured consensus, contradictions, blind spots, and confidence.",
			"Requires Principal session or extension-configured agent capability policy.",
		],
		parameters: Type.Object({
			prompt: Type.String({
				description:
					"The prompt or problem statement to analyze with multi-model deliberation.",
			}),
			profile: Type.Optional(
				Type.String({
					description: "Speed vs depth profile. Defaults to balanced.",
					enum: ["fast", "balanced", "thorough"],
				}),
			),
			models: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional Principal-only custom panel model IDs.",
					maxItems: 4,
				}),
			),
			judge: Type.Optional(
				Type.String({ description: "Optional custom judge model ID." }),
			),
			panelSize: Type.Optional(
				Type.Integer({
					description: "Number of panel models to query (1 to 4).",
					minimum: 1,
					maximum: 4,
				}),
			),
			timeoutMs: Type.Optional(
				Type.Integer({
					description: "Principal-only per-query timeout in milliseconds.",
					minimum: 1_000,
					maximum: 120_000,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (
				new TextEncoder().encode(params.prompt).byteLength >
				MAX_BOOST_FUSION_PROMPT_BYTES
			) {
				throw new Error(
					"Boost fusion denied: prompt exceeds the bounded byte limit",
				);
			}
			const effectiveSettings = resolveEffectiveBoostSettings(
				ctx.cwd,
				hostCapabilities.isProjectTrusted(ctx.cwd, ctx),
				hostCapabilities.globalSettingsPath,
			);
			const isPrincipal = identitySource.isPrincipalSession();
			const agentCognitiveAllowed =
				effectiveSettings.agentSelfBoost.enabled &&
				effectiveSettings.agentSelfBoost.allowCognitive;

			if (!isPrincipal && !agentCognitiveAllowed) {
				throw new Error(
					"Boost fusion denied: Principal session authorization or enabled agent capability policy required",
				);
			}
			if (
				!isPrincipal &&
				(params.profile !== undefined ||
					params.models !== undefined ||
					params.judge !== undefined ||
					params.panelSize !== undefined ||
					params.timeoutMs !== undefined)
			) {
				throw new Error(
					"Boost fusion denied: agent model and budget policy is fixed by operator settings",
				);
			}

			const effectivePanelSize = isPrincipal
				? (params.panelSize ?? effectiveSettings.panelSize)
				: Math.min(
						effectiveSettings.panelSize,
						effectiveSettings.agentSelfBoost.maxPanelModels,
					);
			const visibleModels = getVisibleTextModels(ctx);
			// Default single-model rut-breaker; explicit panelSize opts into judge fusion.
			const singleMode =
				effectiveSettings.mode !== "fusion" && params.panelSize === undefined;
			const result = await executeCognitiveLease({
				prompt: params.prompt,
				single: singleMode,
				profile: isPrincipal
					? (readCognitiveProfile(params.profile) ?? effectiveSettings.profile)
					: effectiveSettings.profile,
				models: isPrincipal
					? (params.models ?? effectiveSettings.models)
					: effectiveSettings.models,
				judge: isPrincipal
					? (params.judge ?? effectiveSettings.judge)
					: effectiveSettings.judge,
				panelSize: effectivePanelSize,
				timeoutMs: isPrincipal
					? (params.timeoutMs ?? effectiveSettings.timeoutMs)
					: effectiveSettings.timeoutMs,
				requireApprovalAboveCalls: isPrincipal ? 5 : effectivePanelSize + 1,
				audit,
				auditActor: isPrincipal ? "principal" : "agent",
				auditSurface: "tool",
				signal,
				runner,
				visibleModels,
				cwd: ctx.cwd,
			});

			const details: Record<string, unknown> = {
				ok: result.ok,
				degraded: result.degraded,
				...(result.analysis ? { ...result.analysis } : {}),
				nodes: result.nodes.map((node) => ({
					role: node.role,
					model: node.model,
					ok: node.ok,
					durationMs: node.durationMs,
					attempts: node.attempts,
					...(node.error ? { error: node.error } : {}),
				})),
				warnings: result.warnings,
				durationMs: result.durationMs,
				...(result.failureReason
					? { failureReason: result.failureReason }
					: {}),
			};

			return ok(result.answer, details);
		},
	});
}
