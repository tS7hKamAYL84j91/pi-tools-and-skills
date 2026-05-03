/**
 * Generic prompt resolution for team protocol slots.
 *
 * This layer deals only in prompt slots, prompt ids, prompt assets, and binding
 * overrides. It intentionally has no knowledge of built-in team protocols,
 * protocol names, execution policy, or settings objects.
 */

import type { TeamPromptRefs } from "./team-types.js";

export type PromptSlotKind = "system" | "template";
export type PromptCatalog = Record<string, readonly string[]>;

export interface PromptBindingSource {
	promptId?: string;
	templateId?: string;
	systemPrompt?: string;
	subagentPromptId?: string;
	subagentSystemPrompt?: string;
}

export interface PromptChainStep {
	label: string;
	value?: string;
	active: boolean;
}

export interface ResolvedPromptChain {
	slot: string;
	kind: PromptSlotKind;
	steps: PromptChainStep[];
	effectiveId?: string;
	text: string;
}

interface PromptArgs {
	teamPrompts: TeamPromptRefs;
	binding?: PromptBindingSource;
	slot: string;
	defaultPromptId: string;
	catalog: PromptCatalog;
}

export function promptAssetLines(catalog: PromptCatalog, id: string): readonly string[] {
	const lines = catalog[id];
	if (lines === undefined) {
		throw new Error(`Unknown prompt id "${id}".`);
	}
	return lines;
}

export function promptAssetText(catalog: PromptCatalog, id: string): string {
	return promptAssetLines(catalog, id).join("\n");
}

function activeStep(label: string, value: string | undefined, activeValue: string | undefined): PromptChainStep {
	return { label, ...(value ? { value } : {}), active: value !== undefined && value === activeValue };
}

export function resolveSystemPrompt(args: PromptArgs): ResolvedPromptChain {
	const teamPromptId = args.teamPrompts[args.slot];
	const bindingPromptId = args.binding?.promptId;
	const subagentPromptId = args.binding?.subagentPromptId;
	const subagentBody = args.binding?.subagentSystemPrompt;
	const bindingLiteral = args.binding?.systemPrompt;
	if (bindingLiteral !== undefined) {
		return {
			slot: args.slot,
			kind: "system",
			text: bindingLiteral,
			steps: [
				{ label: "protocol default", value: args.defaultPromptId, active: false },
				activeStep("subagent prompt", subagentPromptId, undefined),
				{ label: "subagent body", active: false },
				activeStep("team override", teamPromptId, undefined),
				activeStep("binding prompt", bindingPromptId, undefined),
				{ label: "binding literal", active: true },
			],
		};
	}
	const effectiveId = bindingPromptId ?? teamPromptId ?? subagentPromptId;
	if (effectiveId !== undefined) {
		return {
			slot: args.slot,
			kind: "system",
			effectiveId,
			text: promptAssetText(args.catalog, effectiveId),
			steps: [
				activeStep("protocol default", args.defaultPromptId, effectiveId),
				activeStep("subagent prompt", subagentPromptId, effectiveId),
				{ label: "subagent body", active: false },
				activeStep("team override", teamPromptId, effectiveId),
				activeStep("binding prompt", bindingPromptId, effectiveId),
			],
		};
	}
	if (subagentBody !== undefined) {
		return {
			slot: args.slot,
			kind: "system",
			text: subagentBody,
			steps: [
				{ label: "protocol default", value: args.defaultPromptId, active: false },
				{ label: "subagent prompt", active: false },
				{ label: "subagent body", active: true },
			],
		};
	}
	return {
		slot: args.slot,
		kind: "system",
		effectiveId: args.defaultPromptId,
		text: promptAssetText(args.catalog, args.defaultPromptId),
		steps: [{ label: "protocol default", value: args.defaultPromptId, active: true }],
	};
}

export function resolveTemplatePrompt(args: PromptArgs): ResolvedPromptChain {
	const teamPromptId = args.teamPrompts[args.slot];
	const bindingTemplateId = args.binding?.templateId;
	const effectiveId = bindingTemplateId ?? teamPromptId ?? args.defaultPromptId;
	return {
		slot: args.slot,
		kind: "template",
		effectiveId,
		text: promptAssetText(args.catalog, effectiveId),
		steps: [
			activeStep("protocol default", args.defaultPromptId, effectiveId),
			activeStep("team override", teamPromptId, effectiveId),
			activeStep("binding override", bindingTemplateId, effectiveId),
		],
	};
}

/** @public */
export function promptRefsFromRecord(value: unknown): TeamPromptRefs {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const refs: TeamPromptRefs = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === "string" && raw.trim().length > 0) refs[key] = raw.trim();
	}
	return refs;
}

export function formatPromptChains(chains: readonly ResolvedPromptChain[]): string[] {
	return chains.map((chain) => {
		const active = chain.effectiveId ? ` -> ${chain.effectiveId}` : " -> literal";
		const steps = chain.steps
			.filter((step) => step.value !== undefined || step.active)
			.map((step) => `${step.active ? "*" : ""}${step.label}${step.value ? `=${step.value}` : ""}`)
			.join(" < ");
		return `  - ${chain.slot} (${chain.kind})${active}${steps ? ` [${steps}]` : ""}`;
	});
}
