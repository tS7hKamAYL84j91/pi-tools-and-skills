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
		{ id: "generation.system", kind: "system", defaultPromptId: "debate/generation/system", roles: ["member"] },
		{ id: "critique.system", kind: "system", defaultPromptId: "debate/critique/system", roles: ["critic"] },
		{ id: "synthesis.system", kind: "system", defaultPromptId: "debate/synthesis/system", roles: ["chairman", "chair"] },
		{ id: "critique.template", kind: "template", defaultPromptId: "debate/critique/template", roles: ["critic"] },
		{ id: "synthesis.template", kind: "template", defaultPromptId: "debate/synthesis/template", roles: ["chairman", "chair"] },
	],
	consult: [
		{ id: "navigator.system", kind: "system", defaultPromptId: "consult/navigator/system", roles: ["navigator"] },
		{ id: "node.template", kind: "template", defaultPromptId: "consult/navigator/template", roles: ["navigator"] },
	],
	"pair-coding": [
		{ id: "navigatorBrief.system", kind: "system", defaultPromptId: "pair-coding/navigator-brief/system", roles: ["navigator_brief"] },
		{ id: "driverImplementation.system", kind: "system", defaultPromptId: "pair-coding/driver-implementation/system", roles: ["driver_implementation"] },
		{ id: "navigatorReview.system", kind: "system", defaultPromptId: "pair-coding/navigator-review/system", roles: ["navigator_review"] },
		{ id: "driverFix.system", kind: "system", defaultPromptId: "pair-coding/driver-fix/system", roles: ["driver_fix"] },
		{ id: "navigatorBrief.template", kind: "template", defaultPromptId: "pair-coding/navigator-brief/template", roles: ["navigator_brief"] },
		{ id: "driverImplementation.template", kind: "template", defaultPromptId: "pair-coding/driver-implementation/template", roles: ["driver_implementation"] },
		{ id: "navigatorReview.template", kind: "template", defaultPromptId: "pair-coding/navigator-review/template", roles: ["navigator_review"] },
		{ id: "driverFix.template", kind: "template", defaultPromptId: "pair-coding/driver-fix/template", roles: ["driver_fix"] },
	],
	telephone: [
		{ id: "relay.system", kind: "template", defaultPromptId: "telephone/relay/system", roles: ["relay", "member"] },
		{ id: "relay.template", kind: "template", defaultPromptId: "telephone/relay/template", roles: ["relay", "member"] },
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
