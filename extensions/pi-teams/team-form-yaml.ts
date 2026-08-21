/**
 * YAML serialization helpers for team form files.
 */

import type { TeamAgentBinding } from "./team-types.js";
import type { TeamFormInput } from "./team-form-types.js";

function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function scalar(value: string | number | boolean): string {
	return typeof value === "string" ? quote(value) : String(value);
}

function inlineList(values: string[]): string {
	return `[${values.map(quote).join(", ")}]`;
}

function inlineParameters(parameters: Record<string, string | number | boolean>): string {
	const entries = Object.entries(parameters);
	if (entries.length === 0) return "{}";
	return `{ ${entries.map(([key, value]) => `${quote(key)}: ${scalar(value)}`).join(", ")} }`;
}

function promptLines(prompts: Record<string, string> | undefined): string[] {
	const entries = Object.entries(prompts ?? {});
	return entries.length > 0 ? ["prompts:", ...entries.map(([key, value]) => `  ${key}: ${quote(value)}`)] : [];
}

function agentBindingLines(bindings: TeamAgentBinding[]): string[] {
	return [
		"agents:",
		...bindings.flatMap((binding) => [
			`  - role: ${quote(binding.role)}`,
			`    subagent: ${quote(binding.subagent)}`,
			...(binding.model ? [`    model: ${quote(binding.model)}`] : []),
			...(binding.label ? [`    label: ${quote(binding.label)}`] : []),
			...(binding.promptId ? [`    promptId: ${quote(binding.promptId)}`] : []),
			...(binding.templateId ? [`    templateId: ${quote(binding.templateId)}`] : []),
			...(binding.systemPrompt ? [`    systemPrompt: ${quote(binding.systemPrompt)}`] : []),
			...(binding.maxRetries !== undefined ? [`    maxRetries: ${binding.maxRetries}`] : []),
			...(binding.tools ? [`    tools: ${inlineList(binding.tools)}`] : []),
			...(binding.parameters ? [`    parameters: ${inlineParameters(binding.parameters)}`] : []),
		]),
	];
}

export function quoteYamlString(value: string): string {
	return quote(value);
}

function swarmLines(protocol: string): string[] {
	if (protocol !== "hierarchical-swarm") return [];
	return [
		'hierarchicalSwarmBounds: { maxDepth: 2, maxChildrenPerNode: 3, maxTotalNodes: 8, maxWip: 3, maxRepairCycles: 3, ttlMs: 1800000, writeIsolationMode: "tree-global-exclusive" }',
		'hierarchicalSwarmRoleTemplates:',
		'  - role: "root"',
		'    bindingRole: "root_orchestrator"',
		'    reviewerRole: "root"',
		'    reviewRequired: true',
		'  - role: "manager"',
		'    bindingRole: "sub_orchestrator"',
		'    reviewerRole: "root"',
		'    reviewRequired: true',
		'  - role: "worker"',
		'    bindingRole: "leaf_worker"',
		'    reviewerRole: "manager"',
		'    reviewRequired: true',
	];
}

export function teamFileContent(args: TeamFormInput & { id: string; name: string }): string {
	const bindings = args.agentBindings ?? [];
	return [
		"---",
		"schemaVersion: 2",
		`id: ${quote(args.id)}`,
		`name: ${quote(args.name)}`,
		...(args.description ? [`description: ${quote(args.description)}`] : []),
		`protocol: ${quote(args.protocol)}`,
		...swarmLines(args.protocol),
		...promptLines(args.prompts),
		...agentBindingLines(bindings),
		...(args.limits?.maxFixPasses !== undefined ? [`maxFixPasses: ${args.limits.maxFixPasses}`] : []),
		...(args.limits?.timeoutMs !== undefined ? [`timeoutMs: ${args.limits.timeoutMs}`] : []),
		...(args.limits?.maxConcurrency !== undefined ? [`maxConcurrency: ${args.limits.maxConcurrency}`] : []),
		...(args.limits?.maxRetries !== undefined ? [`maxRetries: ${args.limits.maxRetries}`] : []),
		...(args.limits?.maxLoops !== undefined ? [`maxLoops: ${args.limits.maxLoops}`] : []),
		"---",
		"",
		`${args.name} team.`,
		"",
	].join("\n");
}
