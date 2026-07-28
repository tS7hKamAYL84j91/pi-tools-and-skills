/** Compiler for hierarchical-swarm manifest configuration. */

import type {
	HierarchicalSwarmConfig,
	HierarchicalSwarmReviewBinding,
	HierarchicalSwarmRole,
	HierarchicalSwarmRoleTemplate,
	HierarchicalSwarmWriteIsolation,
} from "./team-types.js";

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hierarchicalSwarmRole(value: unknown): HierarchicalSwarmRole | undefined {
	const role = optionalString(value);
	return role === "root" || role === "manager" || role === "worker" ? role : undefined;
}

/** Compiles the strict hierarchical-swarm front-matter section. */
export function compileHierarchicalSwarmConfig(value: unknown): HierarchicalSwarmConfig | undefined {
	if (!isRecord(value) || !Array.isArray(value.roleTemplates) || !isRecord(value.bounds)) return undefined;
	const parsedTemplates = value.roleTemplates.map((entry) => {
		if (!isRecord(entry)) return undefined;
		const role = hierarchicalSwarmRole(entry.role);
		const bindingRole = optionalString(entry.bindingRole);
		const review = isRecord(entry.review) ? entry.review : entry;
		const reviewerRole = hierarchicalSwarmRole(review.reviewerRole);
		const required = review.required ?? entry.reviewRequired;
		if (!role || !bindingRole || (reviewerRole !== "root" && reviewerRole !== "manager") || typeof required !== "boolean") return undefined;
		const reviewBinding: HierarchicalSwarmReviewBinding = { reviewerRole, required };
		const template: HierarchicalSwarmRoleTemplate = { role, bindingRole, review: reviewBinding };
		return template;
	});
	const roleTemplates = parsedTemplates.filter((template): template is HierarchicalSwarmRoleTemplate => template !== undefined);
	if (roleTemplates.length !== value.roleTemplates.length) return undefined;

	const bounds = value.bounds;
	const maxDepth = optionalNumber(bounds.maxDepth);
	const maxChildrenPerNode = optionalNumber(bounds.maxChildrenPerNode);
	const maxTotalNodes = optionalNumber(bounds.maxTotalNodes);
	const maxWip = optionalNumber(bounds.maxWip);
	const maxRepairCycles = optionalNumber(bounds.maxRepairCycles);
	const ttlMs = optionalNumber(bounds.ttlMs);
	const writeIsolation = isRecord(bounds.writeIsolation) ? bounds.writeIsolation : undefined;
	const mode = optionalString(writeIsolation?.mode ?? bounds.writeIsolationMode);
	if (mode !== "tree-global-exclusive") return undefined;
	const approvedWorktreePolicy = optionalString(writeIsolation?.approvedWorktreePolicy ?? bounds.approvedWorktreePolicy);
	const writeIsolationPolicy: HierarchicalSwarmWriteIsolation = {
		mode,
		...(approvedWorktreePolicy ? { approvedWorktreePolicy } : {}),
	};
	return {
		roleTemplates,
		bounds: {
			...(maxDepth !== undefined ? { maxDepth } : {}),
			...(maxChildrenPerNode !== undefined ? { maxChildrenPerNode } : {}),
			...(maxTotalNodes !== undefined ? { maxTotalNodes } : {}),
			...(maxWip !== undefined ? { maxWip } : {}),
			...(maxRepairCycles !== undefined ? { maxRepairCycles } : {}),
			...(ttlMs !== undefined ? { ttlMs } : {}),
			writeIsolation: writeIsolationPolicy,
		},
	};
}
