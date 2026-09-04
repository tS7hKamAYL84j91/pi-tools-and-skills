/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPostAppendPipeline } from "./automator.js";
import { loadEventLoopConfig } from "./config.js";
import { buildDescriptionFromProfile, registerEmitTool } from "./event-ingress-tool.js";
import { createEventLoopRuntime } from "./runtime.js";

export default function eventLoopExtension(pi: ExtensionAPI): void {
	const runtime = createEventLoopRuntime();
	registerEmitTool(
		pi,
		runtime,
		createPostAppendPipeline(runtime),
		buildDescriptionFromProfile(process.cwd()),
	);

	pi.on("session_start", async (_event, ctx) => {
		const result = await loadEventLoopConfig(ctx.cwd);
		if (!result.ok && !result.missing && result.errors.length > 0) {
			ctx.ui.notify(
				`pi-event-loop: invalid configuration — ${result.errors.join("; ")}`,
				"error",
			);
		}
	});
}
