/**
 * Cockpit TUI layer.
 *
 * Dumb renderers over the pure transcript/decision models. This module owns
 * terminal presentation only: it never talks to the child process and never
 * mutates agent state — key handling is turned into callbacks the entrypoint
 * interprets.
 */
import {
	type Component,
	Input,
	matchesKey,
	SelectList,
	type SelectItem,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { CockpitTranscript, TranscriptRow } from "./conversation.ts";
import type { DecisionEntry } from "./decisions.ts";
import { decisionLabel } from "./decisions.ts";

// --- styling (ANSI, no pi ExtensionContext dependency) ---

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

interface Palette {
	accent: (text: string) => string;
	dim: (text: string) => string;
	bold: (text: string) => string;
	ok: (text: string) => string;
	warn: (text: string) => string;
	error: (text: string) => string;
	user: (text: string) => string;
	assistant: (text: string) => string;
}

export const palette: Palette = {
	accent: (t) => `${ESC}36m${t}${RESET}`,
	dim: (t) => `${ESC}2m${t}${RESET}`,
	bold: (t) => `${ESC}1m${t}${RESET}`,
	ok: (t) => `${ESC}32m${t}${RESET}`,
	warn: (t) => `${ESC}33m${t}${RESET}`,
	error: (t) => `${ESC}31m${t}${RESET}`,
	user: (t) => `${ESC}35m${t}${RESET}`,
	assistant: (t) => `${ESC}34m${t}${RESET}`,
};

export type ConnectionState =
	| { kind: "connected" }
	| {
			kind: "disconnected";
			/** Distinguishes control loss from an intentional cockpit shutdown. */
			cause: import("./rpc-client.ts").DisconnectCause;
			fault: boolean;
			reason: string;
			uncertainIds: string[];
	  };

/** Wrap text to `width` columns at word boundaries, hard-breaking overlong tokens. */
export function wrapPlainText(text: string, width: number): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.length === 0) {
			lines.push("");
			continue;
		}
		let line = "";
		for (const word of paragraph.split(" ")) {
			let rest = word;
			while (rest.length > width) {
				if (line !== "") {
					lines.push(line);
					line = "";
				}
				lines.push(rest.slice(0, width));
				rest = rest.slice(width);
			}
			if (line === "") {
				line = rest;
			} else if (line.length + 1 + rest.length <= width) {
				line += ` ${rest}`;
			} else {
				lines.push(line);
				line = rest;
			}
		}
		if (line !== "") lines.push(line);
	}
	return lines;
}

/** Prefix every line of a row and wrap to the remaining width. */
function rowLines(row: TranscriptRow, width: number, style: Palette): string[] {
	const prefixWidth = 2;
	const bodyWidth = Math.max(10, width - prefixWidth);
	const indent = " ".repeat(prefixWidth);
	const lines: string[] = [];

	const header = rowHeader(row, style);
	if (header !== "") lines.push(header);

	if (row.thinking.trim().length > 0) {
		const label = style.dim(`${indent}thought:`);
		for (const line of wrapPlainText(row.thinking.trim(), bodyWidth - indent.length)) {
			lines.push(`${indent}${style.dim(line)}`);
		}
		lines.push(label === "" ? "" : "");
	}

	if (row.tool !== undefined) {
		const status = row.tool.status === "running" ? style.warn("running") : row.tool.status === "error" ? style.error("error") : style.ok("ok");
		const duration = row.tool.durationMs === undefined ? "" : style.dim(` ${row.tool.durationMs}ms`);
		lines.push(`${indent}${style.dim("$")} ${style.bold(row.tool.name)} ${status}${duration}`);
		if (row.tool.args !== "") {
			for (const line of wrapPlainText(row.tool.args, bodyWidth - indent.length - 2)) {
				lines.push(`${indent}${style.dim(`  ${line}`)}`);
			}
		}
		for (const line of wrapPlainText(row.text.trim(), bodyWidth - indent.length - 2).slice(0, 6)) {
			lines.push(`${indent}${style.dim(`  ${line}`)}`);
		}
		return lines;
	}

	for (const line of wrapPlainText(row.text, bodyWidth - indent.length)) {
		lines.push(`${indent}${line}`);
	}
	if (row.text.length === 0 && row.streaming) lines.push(`${indent}${style.dim("…")}`);
	return lines;
}

function rowHeader(row: TranscriptRow, style: Palette): string {
	switch (row.role) {
		case "user":
			return style.user(style.bold("you"));
		case "assistant":
			return style.assistant(style.bold("agent"));
		case "system":
			return style.dim("system");
		case "error":
			return style.error(style.bold("error"));
		case "tool":
			return "";
	}
}

/** Scrollable transcript viewport. Auto-follows the tail unless the operator scrolled up. */
export class TranscriptView implements Component {
	private transcript: CockpitTranscript;
	private readonly style: Palette;
	private scrollFromBottom = 0;

	constructor(transcript: CockpitTranscript, style: Palette = palette) {
		this.transcript = transcript;
		this.style = style;
	}

	setTranscript(transcript: CockpitTranscript): void {
		this.transcript = transcript;
	}

	get followingTail(): boolean {
		return this.scrollFromBottom === 0;
	}

	scrollUp(lines: number): void {
		this.scrollFromBottom += lines;
	}

	scrollDown(lines: number): void {
		this.scrollFromBottom = Math.max(0, this.scrollFromBottom - lines);
	}

	followTail(): void {
		this.scrollFromBottom = 0;
	}

	invalidate(): void {}

	/** Full transcript as styled lines; trailing padding is trimmed so the tail is real content. */
	allLines(width: number): string[] {
		const lines: string[] = [];
		for (const row of this.transcript.rowsView) {
			lines.push(...rowLines(row, width, this.style));
			lines.push("");
		}
		while (lines.length > 0 && lines.at(-1) === "") lines.pop();
		if (lines.length === 0) {
			lines.push(this.style.dim("  no messages yet — type below and press enter"));
		}
		return lines;
	}

	render(width: number): string[] {
		return this.allLines(width);
	}

	/** Visible tail slice for a bounded height, honouring manual scroll. */
	viewport(width: number, height: number): string[] {
		const all = this.allLines(width);
		const bounded = Math.max(1, height);
		const end = Math.max(0, all.length - this.scrollFromBottom);
		const start = Math.max(0, end - bounded);
		return all.slice(start, end).map((line) => truncateToWidth(line, width));
	}
}

interface HeaderState {
	workspace: string;
	sessionName?: string;
	connection: ConnectionState;
	transcript: CockpitTranscript;
}

/** One-line header. Connection state comes first so narrow terminals never hide it. */
export function headerLines(state: HeaderState, width: number, style: Palette = palette): string[] {
	const run = state.transcript.runState;

	let connection: string;
	if (state.connection.kind === "connected") {
		connection = style.ok("● connected");
	} else if (state.connection.uncertainIds.length > 0) {
		connection = style.error(`● disconnected (${state.connection.uncertainIds.length} uncertain)`);
	} else {
		connection = style.error("● disconnected");
	}

	const parts: string[] = [style.accent(style.bold(" cockpit")), connection];
	if (run.streaming) parts.push(style.warn("streaming"));
	if (run.retrying) parts.push(style.warn("retrying"));
	if (run.compacting) parts.push(style.warn("compacting"));
	const queued = run.queued.steering.length + run.queued.followUp.length;
	if (queued > 0) parts.push(style.dim(`queued:${queued}`));
	parts.push(style.dim(state.workspace));
	if (state.sessionName !== undefined) parts.push(style.dim(`· ${state.sessionName}`));

	return [truncateToWidth(parts.join(" "), width)];
}

/** Status footer. Critical warnings wrap instead of being truncated; the hint is cut. */
export function statusLines(state: HeaderState, width: number, style: Palette = palette): string[] {
	const lines: string[] = [];
	if (state.connection.kind === "disconnected" && state.connection.fault) {
		const uncertain = state.connection.uncertainIds;
		const suffix = uncertain.length > 0
			? ` — effects UNKNOWN for ${uncertain.join(", ")}; not retried automatically`
			: "";
		for (const line of wrapPlainText(`! ${state.connection.reason}${suffix}`, width)) {
			lines.push(style.error(line));
		}
	}
	const error = state.transcript.runState.lastError;
	if (error !== undefined) {
		for (const line of wrapPlainText(`! ${error}`, width)) lines.push(style.error(line));
	}
	const hint = state.transcript.runState.streaming
		? "enter steer/queue · esc abort · ctrl+o decisions · pgup/pgdn scroll · ctrl+d quit"
		: "enter send · ctrl+o decisions · pgup/pgdn scroll · ctrl+d quit";
	lines.push(truncateToWidth(style.dim(hint), width));
	return lines;
}

// --- dialogs (extension_ui_request) ---

interface DialogChoice {
	kind: "select" | "confirm";
	title: string;
	message?: string;
	options: string[];
	onDone: (value: string | undefined) => void;
}

/** Modal chooser for `select`/`confirm` requests. */
export class ChoiceDialog implements Component {
	private readonly list: SelectList;
	readonly title: string;
	readonly message?: string;
	onCancel?: () => void;

	constructor(choice: DialogChoice, style: Palette = palette) {
		this.title = choice.title;
		this.message = choice.message;
		const items: SelectItem[] = choice.options.map((option) => ({ value: option, label: option }));
		this.list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (t) => style.accent(t),
			selectedText: (t) => style.accent(t.replace(/^→\s?/, "> ")),
			description: (t) => style.dim(t),
			scrollInfo: (t) => style.dim(t),
			noMatch: (t) => style.warn(t),
		});
		this.list.onSelect = (item) => choice.onDone(item.value);
		this.list.onCancel = () => this.onCancel?.();
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}

	invalidate(): void {
		this.list.invalidate();
	}

	render(width: number): string[] {
		const style = palette;
		return [
			truncateToWidth(style.accent(style.bold(this.title)), width),
			...(this.message === undefined ? [] : [truncateToWidth(style.dim(this.message), width)]),
			...this.list.render(width),
			truncateToWidth(style.dim("↑/↓ choose · enter confirm · esc cancel"), width),
		];
	}
}

/** Free-text dialog for `input`/`editor` requests. */
export class TextDialog implements Component {
	readonly input = new Input();
	private readonly title: string;
	private readonly multiline: boolean;

	constructor(title: string, prefill: string | undefined, multiline: boolean) {
		this.title = title;
		this.multiline = multiline;
		if (prefill !== undefined) this.input.setValue(prefill.replace(/\n/g, " "));
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}

	render(width: number): string[] {
		const style = palette;
		return [
			truncateToWidth(style.accent(style.bold(this.title)), width),
			...this.input.render(width),
			truncateToWidth(style.dim(this.multiline ? "enter submit (single line) · esc cancel" : "enter submit · esc cancel"), width),
		];
	}
}

// --- decisions panel ---

/** Read-only decisions browser: list, filter, and expanded detail. */
export class DecisionsPanel implements Component {
	private readonly entries: readonly DecisionEntry[];
	private readonly list: SelectList;
	private readonly filter = new Input({ placeholder: "filter decisions…" });
	private detail: DecisionEntry | undefined;
	private filterActive = false;
	onClose?: () => void;

	constructor(entries: readonly DecisionEntry[], style: Palette = palette) {
		this.entries = entries;
		this.list = new SelectList(
			entries.map((entry) => ({ value: entry.number, label: decisionLabel(entry) })),
			Math.min(entries.length, 14),
			{
				selectedPrefix: (t) => style.accent(t),
				selectedText: (t) => style.accent(t.replace(/^→\s?/, "> ")),
				description: (t) => style.dim(t),
				scrollInfo: (t) => style.dim(t),
				noMatch: (t) => style.warn(t),
			},
		);
		this.list.onSelect = (item) => {
			this.detail = this.entries.find((entry) => entry.number === item.value);
		};
		this.list.onCancel = () => this.onClose?.();
	}

	set focused(value: boolean) {
		this.filter.focused = value && this.filterActive;
	}

	handleInput(data: string): void {
		if (this.detail !== undefined) {
			if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "enter")) {
				this.detail = undefined;
			}
			return;
		}
		if (this.filterActive) {
			if (matchesKey(data, "escape")) {
				this.filterActive = false;
				this.filter.setValue("");
				this.filter.focused = false;
				this.list.setFilter("");
				return;
			}
			if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "return") || matchesKey(data, "enter")) {
				this.list.handleInput(data);
				return;
			}
			this.filter.handleInput(data);
			this.list.setFilter(this.filter.getValue());
			return;
		}
		if (data === "/") {
			this.filterActive = true;
			this.filter.setValue("");
			this.filter.focused = true;
			this.list.setFilter("");
			return;
		}
		this.list.handleInput(data);
	}

	invalidate(): void {
		this.list.invalidate();
		this.filter.invalidate();
	}

	render(width: number): string[] {
		const style = palette;
		const out: string[] = [truncateToWidth(style.accent(style.bold(" decisions")) + style.dim(` — ${this.entries.length} entries (read-only)`), width)];
		if (this.detail !== undefined) {
			out.push(truncateToWidth(style.accent(style.bold(decisionLabel(this.detail))), width));
			for (const line of wrapPlainText(this.detail.facts, Math.max(10, width - 2))) {
				out.push(` ${line}`);
			}
			out.push(truncateToWidth(style.dim("enter/esc back"), width));
			return out;
		}
		if (this.filterActive) out.push(...this.filter.render(width));
		out.push(...this.list.render(width));
		out.push(truncateToWidth(style.dim("/ filter · enter detail · esc close · ↑/↓ navigate"), width));
		return out;
	}
}

/** Composer: single-line input with a visible prompt. */
export class Composer implements Component {
	readonly input = new Input({ prompt: "› " });

	set focused(value: boolean) {
		this.input.focused = value;
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}

	render(width: number): string[] {
		return this.input.render(width);
	}
}
