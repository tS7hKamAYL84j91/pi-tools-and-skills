/** Session-model tracking for the pi-coas schedule drift guard. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatModelLabel } from "./scheduler-util.js";

/**
 * Subscribe to session model changes so schedules snapshotted at creation can
 * fail closed instead of silently inheriting a changed default model. The
 * runtime guard keeps lightweight test doubles without an event bus
 * constructible; without a subscription the drift guard stays inert.
 */
export function subscribeModelSelect(pi: ExtensionAPI, onModel: (label: string | undefined) => void): void {
	if (typeof pi.on !== "function") return;
	pi.on("model_select", (event) => {
		onModel(formatModelLabel(event.model));
	});
}