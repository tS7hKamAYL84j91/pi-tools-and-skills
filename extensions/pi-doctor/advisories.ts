/**
 * Known supply-chain compromise advisories for pi-doctor.
 *
 * Advisory-only data: entries flag, never patch. Ids are stable; dismissal is
 * keyed on the id so catalog text can be refined without resetting acks.
 * Maintain: add an entry per confirmed compromise event, verify version claims
 * against the vendor advisory, and never remove an id (retire by dismissal).
 */

interface SupplyChainAdvisory {
	readonly id: string;
	readonly packageName: string;
	/** Comma-separated exact versions known to be compromised; omit to flag all versions. */
	readonly compromisedVersions?: string;
	readonly summary: string;
}

export const SUPPLY_CHAIN_ADVISORIES: readonly SupplyChainAdvisory[] = [
	{
		id: "SCA-NPM-2025-09-08-CHALK",
		packageName: "chalk",
		compromisedVersions: "5.6.0,5.6.1",
		summary: "Compromised in the September 2025 npm takeover wave; verify against the vendor advisory before use.",
	},
	{
		id: "SCA-NPM-2025-09-08-DEBUG",
		packageName: "debug",
		compromisedVersions: "4.4.2",
		summary: "Compromised in the September 2025 npm takeover wave; verify against the vendor advisory.",
	},
	{
		id: "SCA-NPM-2025-09-08-ANSI-STYLES",
		packageName: "ansi-styles",
		compromisedVersions: "6.2.1",
		summary: "Compromised in the September 2025 npm takeover wave; verify against the vendor advisory.",
	},
	{
		id: "SCA-NPM-2025-SHAI-HULUD-TINYCOLOR",
		packageName: "@ctrl/tinycolor",
		summary: "Distributed a credential-stealing payload via the Shai-Hulud npm worm; treat any install as suspect.",
	},
];

function advisoryMatchesDependency(advisory: SupplyChainAdvisory, version: string): boolean {
	if (advisory.compromisedVersions === undefined) return true;
	const installed = version.replace(/^[\^~>=<\s]+/, "");
	return advisory.compromisedVersions.split(",").includes(installed);
}

/** Pure matcher: advisories that apply to a dependencies map, minus dismissed ids. */
export function advisoriesForDependencies(
	dependencies: Record<string, unknown>,
	dismissed: ReadonlySet<string>,
): SupplyChainAdvisory[] {
	const matches: SupplyChainAdvisory[] = [];
	for (const advisory of SUPPLY_CHAIN_ADVISORIES) {
		if (dismissed.has(advisory.id)) continue;
		const version = dependencies[advisory.packageName];
		if (typeof version !== "string") continue;
		if (advisoryMatchesDependency(advisory, version)) matches.push(advisory);
	}
	return matches;
}

export function isKnownAdvisoryId(id: string): boolean {
	return SUPPLY_CHAIN_ADVISORIES.some((advisory) => advisory.id === id);
}