/** Searchable team form pickers for models, subagents, and live agents. */

import { DynamicBorder, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, type Component, type Focusable, Input, matchesKey, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { availableLiveAgentNames } from "./live-agent.js";
import { currentPanopticonRecord } from "./runner.js";
import { loadTeamRegistry } from "./team-registry.js";

interface TeamTargetChoice {
	subagent: string;
	model?: string;
}

function choiceId(choice: string): string {
	return choice.split(" — ")[0]?.trim() ?? choice.trim();
}

function modelIds(ctx: ExtensionContext): string[] {
	const current = ctx.model ? [`${ctx.model.provider}/${ctx.model.id}`] : [];
	try {
		return [...new Set([
			...current,
			...ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
		])].sort((a, b) => a.localeCompare(b));
	} catch {
		return current;
	}
}

function findModelMatch(models: readonly string[], query: string): string | undefined {
	const normalized = query.toLowerCase();
	return models.find((model) => model.toLowerCase() === normalized)
		?? models.find((model) => model.toLowerCase().endsWith(`/${normalized}`))
		?? models.find((model) => model.toLowerCase().includes(normalized));
}

function searchableTheme(theme: ExtensionContext["ui"]["theme"]) {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

async function searchableSelect(ctx: ExtensionContext, title: string, items: SelectItem[], customPrefix?: string): Promise<SelectItem | undefined> {
	return ctx.ui.custom<SelectItem | undefined>((tui, theme, _kb, done) => {
		const input = new Input();
		const list = new SelectList(items, Math.min(Math.max(items.length, 1), 12), searchableTheme(theme));
		const customItem = (): SelectItem | undefined => {
			const value = input.getValue().trim();
			return customPrefix && value ? { value: `${customPrefix}${value}`, label: value } : undefined;
		};
		input.onEscape = () => done(undefined);
		input.onSubmit = () => {
			const selected = list.getSelectedItem() ?? customItem();
			if (selected) done(selected);
		};
		list.onCancel = () => done(undefined);
		list.onSelect = (item) => done(item);
		const component: Component & Focusable = {
			get focused() { return input.focused; },
			set focused(value: boolean) { input.focused = value; },
			render(width: number) {
				const container = new Container();
				const border = () => new DynamicBorder((text: string) => theme.fg("accent", text));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 1, 0));
				container.addChild(new Text(theme.fg("dim", " type to search · ↑/↓ select · enter choose · esc cancel"), 1, 0));
				container.addChild(input);
				container.addChild(list);
				container.addChild(border());
				return container.render(width);
			},
			invalidate() {
				input.invalidate();
				list.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, "up") || matchesKey(data, "down")) {
					list.handleInput(data);
				} else if (matchesKey(data, "enter") || matchesKey(data, "return")) {
					const selected = list.getSelectedItem() ?? customItem();
					if (selected) done(selected);
				} else {
					input.handleInput(data);
					list.setFilter(input.getValue());
				}
				tui.requestRender();
			},
		};
		return component;
	}, {
		overlay: true,
		overlayOptions: { width: "80%", minWidth: 70, maxHeight: "80%", anchor: "center", margin: 2 },
	});
}

export async function chooseModel(ctx: ExtensionContext, label: string): Promise<string | undefined> {
	const models = modelIds(ctx);
	if (models.length === 0) {
		const entered = await ctx.ui.input(`${label} model id (optional)`, "");
		return entered?.trim() || undefined;
	}
	const selected = await searchableSelect(ctx, label, [
		{ value: "", label: "(none)", description: "Do not bind a model for this role" },
		...models.map((model) => ({ value: model, label: model, description: "model" })),
	], "typed:");
	if (!selected?.value) return undefined;
	if (selected.value.startsWith("typed:")) {
		const typed = selected.value.slice("typed:".length);
		return findModelMatch(models, typed) ?? typed;
	}
	return selected.value;
}

export async function chooseTeamTarget(ctx: ExtensionContext, label: string, fallbackId: string): Promise<TeamTargetChoice | undefined> {
	const registry = loadTeamRegistry(undefined, { cwd: ctx.cwd });
	const current = await currentPanopticonRecord(ctx.cwd);
	const subagents = [...registry.subagents.values()]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((agent) => ({ value: `subagent:${agent.id}`, label: agent.id, description: agent.description ?? "subagent" }));
	const liveAgents = availableLiveAgentNames(current?.name)
		.map((name) => ({ value: `live:agent:${name}`, label: `agent:${name}`, description: "live peer agent" }));
	const models = modelIds(ctx)
		.map((model) => ({ value: `model:${model}`, label: model, description: `model using new ${fallbackId} subagent` }));
	const allModels = modelIds(ctx);
	const selected = await searchableSelect(ctx, label, [
		{ value: `new:${fallbackId}`, label: fallbackId, description: "new subagent stub" },
		...liveAgents,
		...subagents,
		...models,
		{ value: "custom", label: "custom...", description: "enter a subagent id or agent:<name>" },
	], "typed:");
	if (!selected) return undefined;
	if (selected.value.startsWith("typed:")) {
		const typed = selected.value.slice("typed:".length);
		const model = findModelMatch(allModels, typed);
		return model ? { subagent: fallbackId, model } : { subagent: typed };
	}
	if (selected.value === "custom") {
		const entered = await ctx.ui.input(`${label} id or agent:<name>`, fallbackId);
		const subagent = entered?.trim();
		return subagent ? { subagent } : undefined;
	}
	if (selected.value.startsWith("model:")) return { subagent: fallbackId, model: selected.value.slice("model:".length) };
	if (selected.value.startsWith("live:")) return { subagent: selected.value.slice("live:".length) };
	return { subagent: choiceId(selected.label) };
}
