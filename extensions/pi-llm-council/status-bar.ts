/**
 * Powerline status + persistent overview widget for the council extension.
 *
 * The widget shows the session's councils and pairs at a glance — not
 * deliberation transcripts or pair artifacts. Explicit `/council-list`,
 * `/pair-list`, `/council-last`, and `/pair-last` overlay detail on top.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PairDefinition } from "./pair-commands.js";
import type { CouncilDefinition } from "./types.js";

export interface CouncilSlot {
	definition: CouncilDefinition;
	availableSnapshot: string[];
}

function statusText(
	councils: Map<string, CouncilSlot>,
	pairs: Map<string, PairDefinition>,
): string | undefined {
	const parts: string[] = [];
	if (councils.size > 0) parts.push(`⚖ ${councils.size}`);
	if (pairs.size > 0) parts.push(`⇄ ${pairs.size}`);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function overviewLines(
	councils: Map<string, CouncilSlot>,
	pairs: Map<string, PairDefinition>,
): string[] {
	const lines: string[] = [];
	if (councils.size > 0) {
		lines.push(`Councils (${councils.size}): ${[...councils.keys()].sort().join(", ")}`);
	}
	if (pairs.size > 0) {
		lines.push(`Pairs (${pairs.size}): ${[...pairs.keys()].sort().join(", ")}`);
	}
	if (lines.length === 0) lines.push("(no councils or pairs in this session)");
	return lines;
}

export function refreshCouncilStatus(
	ctx: ExtensionContext,
	councils: Map<string, CouncilSlot>,
	pairs: Map<string, PairDefinition>,
): void {
	ctx.ui.setStatus("council", statusText(councils, pairs));
	ctx.ui.setWidget("council", overviewLines(councils, pairs));
}
