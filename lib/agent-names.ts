import type { AgentRecord } from "./agent-registry.js";

const SUFFIX_LENGTH = 6;

function normalizedName(name: string): string {
	return name.toLowerCase();
}

function duplicateNameCount(record: AgentRecord, records: readonly AgentRecord[]): number {
	const name = normalizedName(record.name);
	return records.filter((candidate) => normalizedName(candidate.name) === name).length;
}

/** Return the stable, human-visible registry label for an agent. */
export function agentDisplayName(record: AgentRecord, records: readonly AgentRecord[]): string {
	if (duplicateNameCount(record, records) <= 1) {
		return record.name;
	}
	return `${record.name}#${record.id.slice(0, SUFFIX_LENGTH)}`;
}

/** Resolve a user-supplied agent selector by display label, or by name when unique. */
export function findAgentByDisplayName(
	records: readonly AgentRecord[],
	target: string,
): AgentRecord | undefined {
	const selector = normalizedName(target.replace(/^@/, "").trim());
	if (!selector) {
		return undefined;
	}

	const displayMatch = records.find(
		(record) => normalizedName(agentDisplayName(record, records)) === selector,
	);
	if (displayMatch) {
		return displayMatch;
	}

	const nameMatches = records.filter((record) => normalizedName(record.name) === selector);
	return nameMatches.length === 1 ? nameMatches[0] : undefined;
}
