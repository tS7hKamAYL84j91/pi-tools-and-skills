/** Manifest compiler validation for declarative team specs. */

import { validateTeamGraph, type GraphValidationResult } from "./team-graph.js";
import type { TeamModelSlotSpec, TeamPromptContract, TeamSpec } from "./team-types.js";

interface TeamManifestValidationResult {
	graph?: GraphValidationResult;
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

/** Validates compiled team manifest metadata and graph shape when present. */
export function validateTeamManifest(team: TeamSpec): TeamManifestValidationResult {
	if (team.schemaVersion !== 2) throw new Error(`Team manifest "${team.id}" must declare schemaVersion: 2.`);
	validatePromptContracts(team.promptContracts);
	validateModelSlots(team.modelSlots);
	const needsGraphValidation = team.protocol === "graph" || team.graph !== undefined;
	return needsGraphValidation ? { graph: validateTeamGraph(team) } : {};
}
