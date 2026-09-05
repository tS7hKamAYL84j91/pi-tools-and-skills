/** Manifest compiler validation for declarative team specs. */

import type {
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
	return { ok: true };
}
