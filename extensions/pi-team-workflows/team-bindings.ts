/**
 * Role-binding lookup helpers for team execution planning.
 */

import type { TeamAgentBinding } from "./team-types.js";

function roleMatches(binding: TeamAgentBinding, roles: readonly string[]): boolean {
	const normalized = binding.role.toLowerCase().replaceAll("-", "_");
	return roles.some((role) => normalized === role || normalized.startsWith(`${role}_`));
}

export function bindingForRole(bindings: readonly TeamAgentBinding[], roles: readonly string[]): TeamAgentBinding | undefined {
	return bindings.find((binding) => roleMatches(binding, roles));
}

export function roleBindings(bindings: readonly TeamAgentBinding[], roles: readonly string[]): TeamAgentBinding[] {
	return bindings.filter((binding) => roleMatches(binding, roles));
}
