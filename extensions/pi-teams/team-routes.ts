/** Valid team routing topologies. */

export type TeamRoute = "llm-council" | "navigator";

export function isTopology(value: string): value is TeamRoute {
	return value === "llm-council" || value === "navigator";
}
