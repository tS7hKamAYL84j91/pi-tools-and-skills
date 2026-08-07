/**
 * Agent panopticon overlay and detail view.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import { openAgentListOverlay } from "./agent-list.js";
import { showAgentDetail } from "./agent-detail.js";

export {
	renderAgentListOverlay,
	sortAgentOverlayRecords,
} from "./agent-list.js";
export {
	renderAgentDetailOverlay,
	isAgentDetailBackInput,
	agentStopConfirmationView,
} from "./agent-detail.js";

export async function openAgentOverlay(
	ctx: ExtensionContext,
	deps: AgentOverlayDeps,
): Promise<void> {
	while (true) {
		let selected: string | null = null;
		await openAgentListOverlay(ctx, deps, (value) => {
			selected = value;
		});
		if (!selected) return;
		const detailAction = await showAgentDetail(ctx, selected, deps);
		if (detailAction !== "back") return;
	}
}
