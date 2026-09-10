/**
 * Interactive /file-watch settings overlay: edit the watched-file list and
 * watcher options with Pi's SettingsList. Every change is persisted to
 * .pi/file-watch.json (unknown keys preserved) and the watchers reload
 * immediately; the status line refreshes with the new state.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Component,
	type Focusable,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { queueSaveFileWatchConfig } from "./config.js";
import type { FileWatchConfig, WatcherRuntimeState } from "./types.js";
import { renderStatus, startFileWatch } from "./watcher.js";
import { WatchListEditor } from "./watch-list-editor.js";

const MAX_BYTES_VALUES = [1024, 4096, 8192, 12_000, 32_768, 65_536];
const DEBOUNCE_VALUES = [250, 500, 1000, 2000, 5000];
const BATCH_WINDOW_VALUES = [0, 30_000, 120_000, 300_000, 600_000];
const MAX_WATCH_ENTRIES = 32;

function labelForBytes(value: number): string {
	return `${Math.round(value / 1024)}k`;
}

function labelForMs(value: number): string {
	if (value === 0) return "off";
	if (value < 60_000) return `${Math.round(value / 1000)}s`;
	return `${value / 60_000}m`;
}

function valueFromLabel(values: readonly number[], labels: readonly string[], label: string): number {
	const index = labels.indexOf(label);
	return index >= 0 ? (values[index] as number) : (values[0] as number);
}

function countLabel(count: number): string {
	return `${count} file${count === 1 ? "" : "s"}`;
}

// ── Overlay ──────────────────────────────────────────────────────

export async function openFileWatchSettings(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: WatcherRuntimeState,
): Promise<void> {
	const initial = state.config;
	if (!initial) return;

	let draft: FileWatchConfig = initial;
	let editor: WatchListEditor | null = null;

	const persist = (next: FileWatchConfig): Promise<void> => {
		draft = next;
		// Saving is serialized, so rapid toggles cannot clobber each other's
		// read-modify-write cycles; watchers hot-reload on every change.
		return queueSaveFileWatchConfig(ctx.cwd, next).then(() => {
			startFileWatch(pi, ctx, next, state);
			if (ctx.hasUI) {
				ctx.ui.setStatus("file-watch", renderStatus(next, state.files, state));
			}
		});
	};

	const watchItem: SettingItem = {
		id: "watch",
		label: "Watched files",
		currentValue: countLabel(draft.watch.length),
		description: "Enter to edit the watched-file list.",
		submenu: (_current, close) => {
			const live = new WatchListEditor(() => draft.watch, {
				onAdd: (path) => {
					if (draft.watch.includes(path) || draft.watch.length >= MAX_WATCH_ENTRIES) {
						return;
					}
					const watch = [...draft.watch, path];
					watchItem.currentValue = countLabel(watch.length);
					void persist({ ...draft, watch });
				},
				onRemove: (index) => {
					const watch = draft.watch.filter((_path, i) => i !== index);
					watchItem.currentValue = countLabel(watch.length);
					void persist({ ...draft, watch });
				},
				onClose: () => close(),
			});
			editor = live;
			return live;
		},
	};

	const maxBytesLabels = MAX_BYTES_VALUES.map(labelForBytes);
	const debounceLabels = DEBOUNCE_VALUES.map(labelForMs);
	const batchWindowLabels = BATCH_WINDOW_VALUES.map(labelForMs);

	const items: SettingItem[] = [
		watchItem,
		{
			id: "triggerTurn",
			label: "Trigger agent turn",
			currentValue: draft.triggerTurn ? "on" : "off",
			values: ["on", "off"],
			description: "Emit a firewatch_batch message that triggers an agent turn on batch flush.",
		},
		{
			id: "allowExternalPaths",
			label: "Allow external paths",
			currentValue: draft.allowExternalPaths ? "on" : "off",
			values: ["on", "off"],
			description: "Allow watching files outside the workspace root.",
		},
		{
			id: "followSymlinks",
			label: "Follow symlinks",
			currentValue: draft.followSymlinks ? "on" : "off",
			values: ["on", "off"],
			description: "Resolve symlinked targets when enabled; disabled rejects symlinked paths.",
		},
		{
			id: "maxBytes",
			label: "Hash byte limit",
			currentValue: labelForBytes(draft.maxBytes),
			values: maxBytesLabels,
			description: "Maximum bytes hashed per change; larger files emit metadata without a hash.",
		},
		{
			id: "debounceMs",
			label: "Debounce",
			currentValue: labelForMs(draft.debounceMs),
			values: debounceLabels,
			description: "Coalesce rapid file-system events before hashing.",
		},
		{
			id: "batchWindowMs",
			label: "Batch window",
			currentValue: labelForMs(draft.batchWindowMs),
			values: batchWindowLabels,
			description: "Window for coalescing repeated changes into one batch (off = flush immediately).",
		},
	];

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold(" File Watch Settings")), 1, 0),
		);

		const settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "triggerTurn") {
					void persist({ ...draft, triggerTurn: newValue === "on" });
				} else if (id === "allowExternalPaths") {
					void persist({ ...draft, allowExternalPaths: newValue === "on" });
				} else if (id === "followSymlinks") {
					void persist({ ...draft, followSymlinks: newValue === "on" });
				} else if (id === "maxBytes") {
					void persist({ ...draft, maxBytes: valueFromLabel(MAX_BYTES_VALUES, maxBytesLabels, newValue) });
				} else if (id === "debounceMs") {
					void persist({ ...draft, debounceMs: valueFromLabel(DEBOUNCE_VALUES, debounceLabels, newValue) });
				} else if (id === "batchWindowMs") {
					void persist({ ...draft, batchWindowMs: valueFromLabel(BATCH_WINDOW_VALUES, batchWindowLabels, newValue) });
				}
				tui.requestRender();
			},
			() => done(undefined),
		);

		container.addChild(settingsList);

		const component: Component & Focusable = {
			get focused() {
				return editor?.focused ?? false;
			},
			set focused(value: boolean) {
				if (editor) editor.focused = value;
			},
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				settingsList.handleInput(data);
				tui.requestRender();
			},
		};
		return component;
	});
}