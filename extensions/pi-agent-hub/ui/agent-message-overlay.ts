/**
 * Direct-message overlay for panopticon peer agents.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Component,
	type Focusable,
	Input,
	matchesKey,
	Text,
} from "@earendil-works/pi-tui";
import { findAgentByDisplayName } from "./display-name.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import type { AgentRecord } from "../types.js";
import { visibleRecords } from "../registry/visibility.js";
import type { ThemeColor } from "./ui-format.js";

interface AgentMessageEntry {
	kind: "you" | "system" | "error";
	text: string;
}

interface RenderAgentMessageOverlayArgs {
	record: AgentRecord;
	entries: readonly AgentMessageEntry[];
	sending: boolean;
	theme: Theme;
	width: number;
}

interface AgentMessageState {
	currentRecord: AgentRecord;
	entries: AgentMessageEntry[];
	sending: boolean;
}

function messageEntryColor(kind: AgentMessageEntry["kind"]): ThemeColor {
	if (kind === "error") return "error";
	if (kind === "you") return "accent";
	return "dim";
}

function createAgentMessageView(
	args: Omit<RenderAgentMessageOverlayArgs, "width">,
	input?: Input,
): Container {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	const add = (s: string) => container.addChild(new Text(s, 1, 0));
	const visibleEntries = args.entries.slice(-8);

	container.addChild(border());
	add(`  ${args.theme.fg("accent", args.theme.bold(`Message ${args.record.name}`))} ${args.theme.fg("muted", args.record.status)}`);
	add(`  ${args.theme.fg("dim", "Send a direct message. Replies arrive through normal unread messages.")}`);
	add(args.theme.fg("dim", " ─────────────────────────────────────────────────────"));

	if (visibleEntries.length === 0) {
		add(`  ${args.theme.fg("dim", "No messages sent from this overlay yet.")}`);
	} else {
		for (const entry of visibleEntries) {
			const label = entry.kind === "you" ? "you" : entry.kind;
			add(`  ${args.theme.fg(messageEntryColor(entry.kind), `${label}:`)} ${args.theme.fg("text", entry.text)}`);
		}
	}

	add("");
	add(`  ${args.theme.fg("accent", args.theme.bold(args.sending ? "Sending..." : "Message"))}`);
	if (input) {
		container.addChild(input);
	} else {
		add("  ");
	}
	add(`  ${args.theme.fg("dim", "enter send · esc close")}`);
	container.addChild(border());
	return container;
}

export function renderAgentMessageOverlay(args: RenderAgentMessageOverlayArgs): string[] {
	return createAgentMessageView(args).render(args.width);
}

function resolveVisibleAgent(agentName: string, deps: AgentOverlayDeps): AgentRecord | undefined {
	const self = deps.registry.getRecord();
	const records = visibleRecords(self, deps.registry.readAllPeers());
	return findAgentByDisplayName(records, agentName);
}

async function submitAgentMessage(
	state: AgentMessageState,
	agentName: string,
	message: string,
	deps: AgentOverlayDeps,
): Promise<void> {
	const resolvedRecord = resolveVisibleAgent(agentName, deps);
	if (!resolvedRecord) {
		state.entries.push({ kind: "error", text: `Agent "${agentName}" is no longer visible.` });
		return;
	}

	state.currentRecord = resolvedRecord;
	state.entries.push({ kind: "you", text: message });
	state.sending = true;
	try {
		const result = await deps.sendAgentMessage(state.currentRecord, message);
		if (result.accepted) {
			state.entries.push({
				kind: "system",
				text: `sent${result.reference ? ` (${result.reference})` : ""}`,
			});
		} else {
			state.entries.push({ kind: "error", text: result.error ?? "send failed" });
		}
	} catch (err) {
		state.entries.push({ kind: "error", text: String(err) });
	} finally {
		state.sending = false;
	}
}

export async function openAgentMessageOverlay(
	ctx: ExtensionContext,
	agentName: string,
	initialRecord: AgentRecord,
	deps: AgentOverlayDeps,
): Promise<void> {
	const state: AgentMessageState = {
		currentRecord: initialRecord,
		entries: [],
		sending: false,
	};

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const input = new Input();
		const submit = async (rawMessage: string): Promise<void> => {
			if (state.sending) return;
			const message = rawMessage.trim();
			if (!message) return;
			input.setValue("");
			const sendPromise = submitAgentMessage(state, agentName, message, deps);
			tui.requestRender();
			await sendPromise;
			tui.requestRender();
		};

		input.onSubmit = (value) => {
			void submit(value);
		};
		input.onEscape = () => done();

		const component: Component & Focusable = {
			get focused() { return input.focused; },
			set focused(value: boolean) { input.focused = value; },
			render(width: number): string[] {
				return createAgentMessageView({
					record: state.currentRecord,
					entries: state.entries,
					sending: state.sending,
					theme,
				}, input).render(width);
			},
			invalidate(): void {
				input.invalidate();
			},
			handleInput(data: string): void {
				if (matchesKey(data, "escape")) {
					done();
					return;
				}
				input.handleInput(data);
				tui.requestRender();
			},
		};
		return component;
	}, {
		overlay: true,
		overlayOptions: {
			width: "70%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});
}
