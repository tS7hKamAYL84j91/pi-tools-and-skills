/**
 * pi-file-watch extension entrypoint.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { loadFileWatchConfig } from "./config.js";
import { createRuntimeState, formatWatchList, renderStatus, startFileWatch, stopFileWatch } from "./watcher.js";

export default function fileWatchExtension(pi: ExtensionAPI): void {
	const state = createRuntimeState();

	async function reload(ctx: ExtensionContext): Promise<void> {
		const config = await loadFileWatchConfig(ctx.cwd);
		startFileWatch(pi, ctx, config, state);
	}

	pi.on("session_start", async (_event, ctx) => {
		await reload(ctx);
		if (ctx.hasUI && state.config) ctx.ui.setStatus("file-watch", renderStatus(state.config, state.files, state));
	});
	pi.on("session_shutdown", async () => {
		stopFileWatch(state);
	});

	pi.registerTool({
		name: "file_watch_list",
		label: "File Watch List",
		description: "List explicitly configured watched files and whether they are active, missing, external, or invalid.",
		promptSnippet: "List configured file watch files",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				await reload(ctx);
				return ok(formatWatchList(state.files), { count: state.files.length, files: state.files });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});

	pi.registerTool({
		name: "file_watch_reload",
		label: "File Watch Reload",
		description: "Reload .pi/file-watch.json and restart file watchers for the current session.",
		promptSnippet: "Reload configured file watch files",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				await reload(ctx);
				return ok(formatWatchList(state.files), { count: state.files.length, files: state.files });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});

	pi.registerCommand("file-watch", {
		description: "Reload file watch state and refresh the status line. Use file_watch_list for details.",
		handler: async (_args, ctx) => {
			await reload(ctx);
			if (ctx.hasUI && state.config) ctx.ui.setStatus("file-watch", renderStatus(state.config, state.files, state));
		},
	});
}
