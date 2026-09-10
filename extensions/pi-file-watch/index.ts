/**
 * pi-file-watch extension entrypoint.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { loadFileWatchConfig } from "./config.js";
import { openFileWatchSettings } from "./settings-overlay.js";
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
		description: "Open the file-watch settings overlay (edit watched files and options); reloads first. Non-interactive sessions refresh the status line.",
		handler: async (_args, ctx) => {
			await reload(ctx);
			if (!state.config) return;
			if (ctx.mode === "tui") {
				await openFileWatchSettings(pi, ctx, state);
				return;
			}
			if (ctx.hasUI) {
				ctx.ui.setStatus("file-watch", renderStatus(state.config, state.files, state));
				ctx.ui.notify(formatWatchList(state.files) || "No files watched. Use /file-watch in an interactive session to add some.", "info");
			}
		},
	});
}
