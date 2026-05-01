/**
 * Agent list-mode tool and command registrations.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@mariozechner/pi-tui";
import { ok, fail, type ToolResult } from "./types.js";
import type { Registry } from "./types.js";
import type { AgentListModeStore } from "./list-mode.js";
import { filterAgentList, isAgentListMode } from "./visibility.js";

const MODE_ITEMS: SelectItem[] = [
	{ value: "all", label: "all", description: "Show every agent allowed by visibility rules" },
	{ value: "children", label: "children", description: "Show roots plus my own children; hide other agents' children" },
	{ value: "roots", label: "roots", description: "Show root/manual agents plus direct family" },
	{ value: "scope", label: "scope", description: "Show parent, siblings, and my children" },
];

function setAgentListMode(
	mode: string,
	registry: Registry,
	listMode: AgentListModeStore,
): ToolResult {
	if (!isAgentListMode(mode)) {
		return fail(
			`Invalid agent list mode "${mode}". Use: all, children, roots, scope`,
			{ reason: "invalid_mode" },
		);
	}
	listMode.set(mode);
	const self = registry.getRecord();
	const visibleCount = filterAgentList(self, registry.readAllPeers(), listMode.get(self)).length;
	return ok(
		`Agent list mode set to ${mode}. ${visibleCount} agent${visibleCount === 1 ? "" : "s"} visible.`,
		{ mode, visibleCount },
	);
}

async function openAgentListModeOverlay(
	ctx: ExtensionContext,
	registry: Registry,
	listMode: AgentListModeStore,
): Promise<void> {
	const current = listMode.get(registry.getRecord());
	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		container.addChild(border());
		container.addChild(new Text(theme.fg("accent", theme.bold(" Agent List Mode")) + theme.fg("dim", ` - current: ${current}`), 1, 0));
		container.addChild(new Text(theme.fg("dim", " Type to search • enter select • esc cancel"), 1, 0));
		const selectList = new SelectList(MODE_ITEMS, MODE_ITEMS.length, {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(border());
		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
	if (!selected) return;
	const result = setAgentListMode(selected, registry, listMode);
	ctx.ui.notify(result.content[0]?.text ?? "", result.isError ? "warning" : "info");
}

export function registerAgentListModeControls(
	pi: ExtensionAPI,
	registry: Registry,
	listMode: AgentListModeStore,
): void {
	async function handleCommand(args: string | undefined, ctx: ExtensionContext): Promise<void> {
		const mode = args?.trim();
		if (!mode) {
			await openAgentListModeOverlay(ctx, registry, listMode);
			return;
		}
		const result = setAgentListMode(mode, registry, listMode);
		ctx.ui.notify(result.content[0]?.text ?? "", result.isError ? "warning" : "info");
	}

	pi.registerCommand("agent-list-mode", {
		description: "Choose agent list/widget mode. Usage: /agent-list-mode [all|children|roots|scope]",
		handler: handleCommand,
	});

	pi.registerCommand("agents-mode", {
		description: "Set agent list/widget mode. Usage: /agents-mode [all|children|roots|scope]",
		handler: handleCommand,
	});
}
