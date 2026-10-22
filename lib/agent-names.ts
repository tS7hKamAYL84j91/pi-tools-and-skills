import type { AgentRecord } from "./agent-registry.js";

const SUFFIX_LENGTH = 6;

function normalizedName(name: string): string {
	return name.toLowerCase();
}

/**
 * Stable routing label for an agent. Records carrying a parent namespace are
 * qualified as `namespace/name` so supporting agents remain unambiguously
 * attributable to their lead and resolvable per-lead even when bare names
 * collide. Plain `/` never occurs in agent names (name charset excludes it),
 * so qualified labels cannot be spoofed by a plain name.
 */
export function agentBaseName(record: AgentRecord): string {
	return record.namespace ? `${record.namespace}/${record.name}` : record.name;
}

function duplicateNameCount(record: AgentRecord, records: readonly AgentRecord[]): number {
	const name = normalizedName(agentBaseName(record));
	return records.filter(
		(candidate) => normalizedName(agentBaseName(candidate)) === name,
	).length;
}

/** Return the stable, human-visible registry label for an agent. */
export function agentDisplayName(record: AgentRecord, records: readonly AgentRecord[]): string {
	if (duplicateNameCount(record, records) <= 1) {
		return agentBaseName(record);
	}
	return `${agentBaseName(record)}#${record.id.slice(0, SUFFIX_LENGTH)}`;
}

/** Name sources trusted as canonical claims when a bare name collides. */
const PREFERRED_UNQUALIFIED_SOURCES = new Set(["user", "declared"]);

/**
 * Resolve a user-supplied agent selector.
 *
 * Qualified labels (`"lead/helper"`) address namespaced records only — a
 * plain registry name can never contain "/", so the form cannot be spoofed.
 *
 * Unqualified labels address namespace-less records only: a namespaced helper
 * that renamed itself to its lead's label can never capture the lead's bare
 * routing label, even while the lead is down. Duplicated bare names prefer a
 * trusted user/declared claim over a generated one, and the immutable spawn
 * name from the trusted spawner remains reachable as a legacy alias.
 */
export function findAgentByDisplayName(
	records: readonly AgentRecord[],
	target: string,
): AgentRecord | undefined {
	const selector = normalizedName(target.replace(/^@/, "").trim());
	if (!selector) {
		return undefined;
	}

	if (selector.includes("/")) {
		const displayMatch = records.find(
			(record) => normalizedName(agentDisplayName(record, records)) === selector,
		);
		if (displayMatch) {
			return displayMatch;
		}
		const baseMatches = records.filter(
			(record) => normalizedName(agentBaseName(record)) === selector,
		);
		return baseMatches.length === 1 ? baseMatches[0] : undefined;
	}

	const displayMatch = records.find(
			(record) =>
				!record.namespace &&
				normalizedName(agentDisplayName(record, records)) === selector,
		);
	if (displayMatch) {
		return displayMatch;
	}

	const nameMatches = records.filter(
		(record) => !record.namespace && normalizedName(record.name) === selector,
	);
	if (nameMatches.length === 1) {
		return nameMatches[0];
	}
	if (nameMatches.length > 1) {
		const preferred = nameMatches.filter((record) =>
			PREFERRED_UNQUALIFIED_SOURCES.has(record.name_source ?? ""),
		);
		return preferred.length === 1 ? preferred[0] : undefined;
	}

	const spawnMatches = records.filter(
		(record) =>
			!!record.spawn_name && normalizedName(record.spawn_name) === selector,
	);
	return spawnMatches.length === 1 ? spawnMatches[0] : undefined;
}
