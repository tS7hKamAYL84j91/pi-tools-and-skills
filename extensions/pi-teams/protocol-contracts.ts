/** Protocol prompt-slot contracts and resolution helpers. */

import {
	resolveSystemPrompt,
	resolveTemplatePrompt,
	type PromptBindingSource,
	type PromptCatalog,
	type PromptSlotKind,
	type ResolvedPromptChain,
} from "./prompt-resolver.js";
import type { TeamPromptRefs } from "./team-types.js";

interface ProtocolPromptSlot {
	id: string;
	kind: PromptSlotKind;
	defaultPromptId: string;
	roles?: string[];
}

interface TeamPromptContext {
	protocol: string;
	prompts: TeamPromptRefs;
	bindings: Array<PromptBindingSource & { role: string }>;
}

const PROTOCOL_PROMPT_CONTRACTS: Record<string, readonly ProtocolPromptSlot[]> = {
	debate: [
		{ id: "generation.system", kind: "system", defaultPromptId: "councilGenerationSystem", roles: ["member"] },
		{ id: "critique.system", kind: "system", defaultPromptId: "councilCritiqueSystem", roles: ["critic"] },
		{ id: "synthesis.system", kind: "system", defaultPromptId: "councilChairmanSystem", roles: ["chairman", "chair"] },
		{ id: "critique.template", kind: "template", defaultPromptId: "councilCritiqueTemplate", roles: ["critic"] },
		{ id: "synthesis.template", kind: "template", defaultPromptId: "councilSynthesisTemplate", roles: ["chairman", "chair"] },
	],
	consult: [
		{ id: "navigator.system", kind: "system", defaultPromptId: "pairNavigatorConsultSystem", roles: ["navigator"] },
	],
	"pair-coding": [
		{ id: "navigatorBrief.system", kind: "system", defaultPromptId: "pairNavigatorBriefSystem", roles: ["navigator_brief"] },
		{ id: "driverImplementation.system", kind: "system", defaultPromptId: "pairDriverImplementationSystem", roles: ["driver_implementation"] },
		{ id: "navigatorReview.system", kind: "system", defaultPromptId: "pairNavigatorReviewSystem", roles: ["navigator_review"] },
		{ id: "driverFix.system", kind: "system", defaultPromptId: "pairDriverFixSystem", roles: ["driver_fix"] },
		{ id: "navigatorBrief.template", kind: "template", defaultPromptId: "pairNavigatorBriefTemplate", roles: ["navigator_brief"] },
		{ id: "driverImplementation.template", kind: "template", defaultPromptId: "pairDriverImplementationTemplate", roles: ["driver_implementation"] },
		{ id: "navigatorReview.template", kind: "template", defaultPromptId: "pairNavigatorReviewTemplate", roles: ["navigator_review"] },
		{ id: "driverFix.template", kind: "template", defaultPromptId: "pairDriverFixTemplate", roles: ["driver_fix"] },
	],
	telephone: [
		{ id: "relay.system", kind: "template", defaultPromptId: "telephoneRelaySystem", roles: ["relay", "member"] },
		{ id: "relay.template", kind: "template", defaultPromptId: "telephoneRelayTemplate", roles: ["relay", "member"] },
	],
	graph: [
		{ id: "node.template", kind: "template", defaultPromptId: "teamGraphNodeTemplate", roles: ["node", "agent", "member"] },
	],
};

function roleMatches(role: string, candidates: readonly string[]): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}_`));
}

function bindingForSlot(context: TeamPromptContext, slot: ProtocolPromptSlot): PromptBindingSource | undefined {
	if (!slot.roles) return undefined;
	return context.bindings.find((binding) => roleMatches(binding.role, slot.roles ?? []));
}

export function resolveProtocolPromptChains(context: TeamPromptContext, catalog: PromptCatalog): Map<string, ResolvedPromptChain> {
	const contract = PROTOCOL_PROMPT_CONTRACTS[context.protocol];
	if (!contract) throw new Error(`No prompt contract registered for protocol "${context.protocol}".`);
	const chains = new Map<string, ResolvedPromptChain>();
	for (const slot of contract) {
		const binding = bindingForSlot(context, slot);
		const args = {
			teamPrompts: context.prompts,
			binding,
			slot: slot.id,
			defaultPromptId: slot.defaultPromptId,
			catalog,
		};
		chains.set(slot.id, slot.kind === "system" ? resolveSystemPrompt(args) : resolveTemplatePrompt(args));
	}
	return chains;
}

export function requirePromptChain(chains: ReadonlyMap<string, ResolvedPromptChain>, slot: string): ResolvedPromptChain {
	const chain = chains.get(slot);
	if (!chain) throw new Error(`Protocol prompt slot "${slot}" was not resolved.`);
	return chain;
}
