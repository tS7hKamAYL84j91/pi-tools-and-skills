/** Runtime control-plane views shared with panopticon's runtime tools. */

import type { RuntimeControlPlane } from "../../../lib/runtime-control-plane.js";
import { ok, type ToolResult } from "../../../lib/tool-result.js";

export function inspectSwarmRuntime(
	runtime: RuntimeControlPlane,
	id?: string,
): ToolResult {
	const entities = runtime.listEntities().filter((entity) => entity.kind === "swarm");
	if (!id) return ok(`${entities.length} runtime swarm(s).`, { entities });
	const entity = runtime.inspectEntity({ kind: "swarm", id });
	if (!entity) throw new Error(`No runtime swarm ${id}`);
	return ok(`swarm ${id} ${entity.status}`, { entities: [entity] });
}

export function stopSwarmRuntime(
	runtime: RuntimeControlPlane,
	id: string,
	reason: string,
): ToolResult {
	if (!runtime.stopEntity({ kind: "swarm", id }, reason)) {
		throw new Error(`No runtime swarm ${id}`);
	}
	return ok(`swarm ${id} stopping: ${reason}`, {
		kind: "swarm",
		id,
		reason,
		status: "stopping",
	});
}
