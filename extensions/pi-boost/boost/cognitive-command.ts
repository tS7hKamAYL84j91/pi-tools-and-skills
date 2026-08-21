/** Slash-command adapter for bounded CognitiveLease execution and feedback. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
	BoostFusionRequest,
	CognitiveLeaseResult,
} from "./cognitive-types.js";

type BoostNotificationLevel = "info" | "warning" | "error";

/** Execute a parsed fusion request and emit bounded user-facing feedback. */
export async function handleCognitiveFusionCommand(
	ctx: ExtensionCommandContext,
	input: BoostFusionRequest,
	cognitive: (
		input: BoostFusionRequest,
		ctx: ExtensionCommandContext,
	) => Promise<CognitiveLeaseResult>,
	notify: (
		ctx: ExtensionCommandContext,
		message: string,
		level: BoostNotificationLevel,
	) => void,
): Promise<void> {
	try {
		const result = await cognitive(input, ctx);
		if (!result.ok && result.failureReason === "all_panels_failed") {
			notify(ctx, `Boost fusion failed: ${result.answer}`, "error");
			return;
		}
		const statusNote = result.degraded ? " (degraded)" : "";
		notify(
			ctx,
			`Boost fusion completed${statusNote}:\n\n${result.answer}`,
			"info",
		);
	} catch (error) {
		notify(
			ctx,
			`Boost fusion error: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
}
