/** Manifest compiler validation for declarative team specs. */

import type {
	HierarchicalSwarmBounds,
	HierarchicalSwarmConfig,
	HierarchicalSwarmRole,
	TeamAgentBinding,
	TeamApprovalConfig,
	TeamModelSlotSpec,
	TeamModels,
	TeamPromptContract,
	TeamSpec,
} from "./team-types.js";

interface TeamManifestValidationResult {
	ok: true;
}

function assertNonEmpty(value: string, label: string): void {
	if (value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function assertUnique(values: readonly string[], label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new Error(`${label} has duplicate id "${value}".`);
		seen.add(value);
	}
}

function validatePromptContracts(contracts: readonly TeamPromptContract[] | undefined): void {
	if (contracts === undefined) return;
	assertUnique(contracts.map((contract) => contract.id), "promptContracts");
	for (const contract of contracts) {
		assertNonEmpty(contract.id, "promptContracts.id");
		if (contract.kind !== "system" && contract.kind !== "template") {
			throw new Error(`promptContracts.${contract.id}.kind must be system or template.`);
		}
		if (contract.defaultPromptId !== undefined) assertNonEmpty(contract.defaultPromptId, `promptContracts.${contract.id}.defaultPromptId`);
		for (const role of contract.roles ?? []) assertNonEmpty(role, `promptContracts.${contract.id}.roles`);
	}
}

function validateModelId(model: string, label: string): void {
	assertNonEmpty(model, label);
	if (!model.includes("/")) throw new Error(`${label} must be provider/model.`);
}

function validateModels(models: TeamModels): void {
	for (const [index, model] of (models.members ?? []).entries()) validateModelId(model, `models.members[${index}]`);
	if (models.synthesis !== undefined) validateModelId(models.synthesis, "models.synthesis");
	if (models.driver !== undefined) validateModelId(models.driver, "models.driver");
	if (models.navigator !== undefined) validateModelId(models.navigator, "models.navigator");
}

function validateApproval(approval: TeamApprovalConfig | undefined): void {
	if (approval === undefined) return;
	if (approval.enabled !== undefined && typeof approval.enabled !== "boolean") throw new Error("approval.enabled must be boolean.");
	if (approval.enabled !== true) return;
	if (approval.owner === undefined || approval.owner.trim().length === 0) throw new Error("approval.owner is required when approval.enabled is true.");
	if (approval.source !== undefined && approval.source !== "human" && approval.source !== "orchestrator" && approval.source !== "policy") throw new Error("approval.source must be human, orchestrator, or policy.");
}

function validateModelSlots(slots: readonly TeamModelSlotSpec[] | undefined): void {
	if (slots === undefined) return;
	assertUnique(slots.map((slot) => slot.id), "modelSlots");
	for (const slot of slots) {
		assertNonEmpty(slot.id, "modelSlots.id");
		if (slot.kind !== "member" && slot.kind !== "synthesis" && slot.kind !== "driver" && slot.kind !== "navigator") {
			throw new Error(`modelSlots.${slot.id}.kind must be member, synthesis, driver, or navigator.`);
		}
		if (slot.count !== undefined && slot.count !== "dynamic" && (!Number.isInteger(slot.count) || slot.count < 1)) {
			throw new Error(`modelSlots.${slot.id}.count must be dynamic or a positive integer.`);
		}
		if (slot.label !== undefined) assertNonEmpty(slot.label, `modelSlots.${slot.id}.label`);
	}
}

function validateOptionalBound(value: number | undefined, label: string): void {
	if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
		throw new Error(`${label} must be a positive integer when configured.`);
	}
}

function validateHierarchicalBounds(bounds: HierarchicalSwarmBounds): void {
	validateOptionalBound(bounds.maxDepth, "hierarchicalSwarm.bounds.maxDepth");
	validateOptionalBound(bounds.maxChildrenPerNode, "hierarchicalSwarm.bounds.maxChildrenPerNode");
	validateOptionalBound(bounds.maxTotalNodes, "hierarchicalSwarm.bounds.maxTotalNodes");
	validateOptionalBound(bounds.maxWip, "hierarchicalSwarm.bounds.maxWip");
	validateOptionalBound(bounds.maxRepairCycles, "hierarchicalSwarm.bounds.maxRepairCycles");
	validateOptionalBound(bounds.ttlMs, "hierarchicalSwarm.bounds.ttlMs");
	if (bounds.writeIsolation.mode !== "tree-global-exclusive") {
		throw new Error("hierarchicalSwarm.bounds.writeIsolation.mode must be tree-global-exclusive.");
	}
	if (bounds.writeIsolation.approvedWorktreePolicy !== undefined) {
		assertNonEmpty(bounds.writeIsolation.approvedWorktreePolicy, "hierarchicalSwarm.bounds.writeIsolation.approvedWorktreePolicy");
	}
}

function validateWorkerCapabilities(binding: TeamAgentBinding): void {
	const forbidden = binding.tools?.find((tool) => /spawn|team|swarm/i.test(tool));
	if (forbidden) {
		throw new Error(`hierarchicalSwarm worker binding must not expose spawn/team/swarm capability "${forbidden}".`);
	}
}

function validateHierarchicalSwarm(config: HierarchicalSwarmConfig, team: TeamSpec): void {
	const roles: HierarchicalSwarmRole[] = ["root", "manager", "worker"];
	assertUnique(config.roleTemplates.map((template) => template.role), "hierarchicalSwarm.roleTemplates");
	for (const role of roles) {
		const template = config.roleTemplates.find((entry) => entry.role === role);
		if (!template) throw new Error(`hierarchicalSwarm.roleTemplates must define ${role}.`);
		assertNonEmpty(template.bindingRole, `hierarchicalSwarm.roleTemplates.${role}.bindingRole`);
		if (!team.agentBindings.some((binding) => binding.role === template.bindingRole)) {
			throw new Error(`hierarchicalSwarm.roleTemplates.${role}.bindingRole must reference an agent binding.`);
		}
		const reviewerRole = template.review.reviewerRole;
		if ((role === "worker" && reviewerRole !== "manager") || (role !== "worker" && reviewerRole !== "root")) {
			throw new Error(`hierarchicalSwarm.roleTemplates.${role}.review.reviewerRole violates hierarchy authority.`);
		}
		if (template.review.required !== true) {
			throw new Error(`hierarchicalSwarm.roleTemplates.${role}.review.required must be true.`);
		}
	}
	const workerTemplate = config.roleTemplates.find((entry) => entry.role === "worker");
	const workerBinding = workerTemplate && team.agentBindings.find((binding) => binding.role === workerTemplate.bindingRole);
	if (!workerBinding) throw new Error("hierarchicalSwarm worker binding is unavailable.");
	validateWorkerCapabilities(workerBinding);
	validateHierarchicalBounds(config.bounds);
}

/** Validates compiled team manifest metadata. */
export function validateTeamManifest(team: TeamSpec): TeamManifestValidationResult {
	if (team.schemaVersion !== 2) throw new Error(`Team manifest "${team.id}" must declare schemaVersion: 2.`);
	assertNonEmpty(team.id, "id");
	assertNonEmpty(team.name, "name");
	assertNonEmpty(team.protocol, "protocol");
	validateModels(team.models);
	validateApproval(team.approval);
	validatePromptContracts(team.promptContracts);
	validateModelSlots(team.modelSlots);
	if (team.protocol === "hierarchical-swarm") {
		if (team.hierarchicalSwarm === undefined) throw new Error("hierarchical-swarm protocol requires hierarchicalSwarm.");
		validateHierarchicalSwarm(team.hierarchicalSwarm, team);
	} else if (team.hierarchicalSwarm !== undefined) {
		throw new Error("hierarchicalSwarm is only valid for protocol hierarchical-swarm.");
	}
	return { ok: true };
}
