/** Valid team routing topologies. */

export type TeamRoute = "fusion-analysis" | "llm-council" | "navigator";

export function isTopology(value: string): value is TeamRoute {
	return value === "fusion-analysis" || value === "llm-council" || value === "navigator";
}
