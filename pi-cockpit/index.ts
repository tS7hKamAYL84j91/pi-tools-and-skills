#!/usr/bin/env node
/**
 * pi-cockpit — a TUI front-end over a Pi RPC child process.
 *
 * One explicitly configured session, one terminal: streamed conversation and
 * tool activity, a composer that sends or steers, extension dialog handling,
 * cancellation, read-only decision navigation, and a visible disconnect state
 * that never silently retries a side effect.
 *
 * Run:
 *   COCKPIT_CONFIG=/path/to/cockpit.json node pi-cockpit/index.ts
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
	matchesKey,
	ProcessTerminal,
	type TUI,
	TuiMainScreen,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { buildChildArgs, loadCockpitConfig, type CockpitConfig } from "./cockpit-config.ts";
import { CockpitTranscript } from "./conversation.ts";
import { loadDecisionLog, type DecisionEntry } from "./decisions.ts";
import { CockpitRpc, type CockpitEvent, type RpcRecord } from "./rpc-client.ts";
import {
	ChoiceDialog,
	type ConnectionState,
	Composer,
	DecisionsPanel,
	headerLines,
	palette,
	statusLines,
	TextDialog,
	TranscriptView,
	wrapPlainText,
} from "./ui.ts";

export type Dialog =
	| {
			kind: "choice";
			requestId: string;
			mode: "select" | "confirm";
			component: ChoiceDialog;
	  }
	| { kind: "text"; requestId: string; component: TextDialog; multiline: boolean };

export interface UiState {
	workspace: string;
	connection: ConnectionState;
	transcript: CockpitTranscript;
	decisions: DecisionEntry[] | undefined;
	dialog: Dialog | undefined;
	decisionsOpen: boolean;
}

function configPathFromArgv(argv: readonly string[]): string {
	const fromEnv = process.env.COCKPIT_CONFIG;
	if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
	const explicit = argv.find((arg) => !arg.startsWith("-"));
	if (explicit !== undefined) return resolve(explicit);
	throw new Error(
		"no config: set COCKPIT_CONFIG=/path/to/cockpit.json or pass a config path as the first argument",
	);
}

/** Root component: owns layout, input routing, and viewport math. */
class CockpitRoot {
	readonly state: UiState;
	private readonly view: TranscriptView;
	private readonly composer = new Composer();
	private readonly terminal: { rows: number };
	private requestRender: () => void = () => {};
	onSubmit?: (text: string) => void;
	onAbort?: () => void;
	onQuit?: () => void;
	onToggleDecisions?: () => void;
	onDialogResponse?: (dialog: Dialog, value: string | undefined) => void;

	constructor(state: UiState, terminal: { rows: number }) {
		this.state = state;
		this.terminal = terminal;
		this.view = new TranscriptView(state.transcript);
		this.composer.input.focused = true;
		this.composer.input.onSubmit = (value) => this.onSubmit?.(value);
	}

	setRenderRequester(fn: () => void): void {
		this.requestRender = fn;
	}

	get transcriptView(): TranscriptView {
		return this.view;
	}

	invalidate(): void {
		this.composer.invalidate();
		this.view.invalidate();
	}

	handleInput(data: string): void {
		const { state } = this;

		if (state.dialog !== undefined) {
			this.handleDialogInput(state.dialog, data);
			return;
		}

		if (matchesKey(data, "ctrl+d")) {
			this.onQuit?.();
			return;
		}
		if (matchesKey(data, "ctrl+o")) {
			this.onToggleDecisions?.();
			return;
		}
		if (state.decisionsOpen) {
			const panel = this.decisionsPanel();
			panel?.handleInput(data);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.view.scrollUp(10);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.view.scrollDown(10);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "escape")) {
			this.onAbort?.();
			return;
		}
		this.composer.handleInput(data);
	}

	private handleDialogInput(dialog: Dialog, data: string): void {
		const { state } = this;
		if (dialog.kind === "choice") {
			dialog.component.onCancel = () => {
				state.dialog = undefined;
				this.composer.input.focused = true;
				this.onDialogResponse?.(dialog, undefined);
				this.requestRender();
			};
			dialog.component.handleInput(data);
			this.requestRender();
			return;
		}
		const input = dialog.component.input;
		input.onSubmit = (value) => {
			state.dialog = undefined;
			this.composer.input.focused = true;
			this.onDialogResponse?.(dialog, value.trim().length > 0 ? value : undefined);
			this.requestRender();
		};
		input.onEscape = () => {
			state.dialog = undefined;
			this.composer.input.focused = true;
			this.onDialogResponse?.(dialog, undefined);
			this.requestRender();
		};
		dialog.component.handleInput(data);
		this.requestRender();
	}

	private decisionsPanel(): DecisionsPanel | undefined {
		const entries = this.state.decisions;
		if (entries === undefined) return undefined;
		const panel = new DecisionsPanel(entries);
		panel.onClose = () => this.onToggleDecisions?.();
		return panel;
	}

	render(width: number): string[] {
		const rows = Math.max(12, this.terminal.rows);
		const header = headerLines(
			{
				workspace: this.state.workspace,
				sessionName: this.state.transcript.runState.sessionName,
				connection: this.state.connection,
				transcript: this.state.transcript,
			},
			width,
		);
		const status = statusLines(
			{ workspace: this.state.workspace, connection: this.state.connection, transcript: this.state.transcript },
			width,
		);
		const bodyHeight = Math.max(4, rows - header.length - status.length - 2);

		const out: string[] = [...header, palette.dim("─".repeat(Math.max(1, Math.min(width, 120))))];

		if (this.state.dialog !== undefined) {
			out.push(...this.state.dialog.component.render(width).slice(0, bodyHeight));
		} else if (this.state.decisionsOpen) {
			const panel = this.decisionsPanel();
			out.push(
				...(panel === undefined
					? this.placeholder("no decisions file configured", width, bodyHeight)
					: panel.render(width).slice(0, bodyHeight)),
			);
		} else {
			out.push(...this.view.viewport(width, bodyHeight));
		}

		// Keep the composer pinned to the bottom of the viewport.
		const used = out.length - header.length - 1;
		for (let i = used; i < bodyHeight; i += 1) out.push("");
		out.push(...status);
		out.push(...this.composer.render(width));
		return out.map((line) => truncateToWidth(line, width));
	}

	private placeholder(text: string, width: number, height: number): string[] {
		const lines = wrapPlainText(palette.dim(text), width);
		while (lines.length < height) lines.push("");
		return lines.slice(0, height);
	}
}

/** Apply one transport event: records go to the reducer, failures become visible. */
export function applyTransportEvent(
	state: UiState,
	event: CockpitEvent,
	handlers: { onDialog: (dialog: Dialog) => void },
): void {
	switch (event.kind) {
		case "record":
			applyRecord(state, event.record, handlers);
			return;
		case "stderr":
			// Diagnostics stay out of the transcript; the child's stderr is not protocol data.
			return;
		case "parse-error":
			state.transcript.noteError(`protocol parse error: ${event.error}`);
			return;
		case "disconnected":
			state.connection = {
				kind: "disconnected",
				cause: event.cause,
				fault: event.fault,
				reason: event.reason,
				uncertainIds: event.uncertainIds,
			};
			// An intentional cockpit shutdown is not an error; a control loss is.
			if (event.fault) state.transcript.noteError(`disconnected: ${event.reason}`);
			if (event.uncertainIds.length > 0) {
				state.transcript.noteError(
					`${event.uncertainIds.length} unanswered command(s) — effects unknown, not retried automatically`,
				);
			}
			return;
	}
}

function applyRecord(
	state: UiState,
	record: RpcRecord,
	handlers: { onDialog: (dialog: Dialog) => void },
): void {
	if (record.type === "response") {
		if (record.success === false) {
			const command = typeof record.command === "string" ? record.command : "command";
			const error = typeof record.error === "string" ? record.error : "unknown error";
			state.transcript.noteError(`${command}: ${error}`);
			return;
		}
		if (record.command === "get_state") {
			syncSessionState(state, record.data);
		}
		return;
	}
	if (record.type === "extension_ui_request") {
		const dialog = dialogFor(record);
		if (dialog !== undefined) {
			handlers.onDialog(dialog);
			return;
		}
		if (isFireAndForget(record)) {
			noteFireAndForget(state, record);
			return;
		}
		const method = typeof record.method === "string" ? record.method : "unknown";
		state.transcript.noteSystem(
			`unsupported extension UI request "${method}" — ignored (custom() and terminal-only calls are unavailable in RPC mode)`,
		);
		return;
	}
	state.transcript.apply(record);
}

const FIRE_AND_FORGET_METHODS = new Set([
	"notify",
	"setStatus",
	"setWidget",
	"setTitle",
	"set_editor_text",
]);

function isFireAndForget(record: RpcRecord): boolean {
	return typeof record.method === "string" && FIRE_AND_FORGET_METHODS.has(record.method);
}

/** Seed the header from `get_state` without inventing a second state model. */
function syncSessionState(state: UiState, data: unknown): void {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return;
	const record = data as Record<string, unknown>;
	if (typeof record.sessionName === "string") {
		state.transcript.apply({ type: "session_info_changed", name: record.sessionName });
	}
	state.transcript.apply({ type: record.isStreaming === true ? "agent_start" : "agent_settled" });
}

function dialogFor(record: RpcRecord): Dialog | undefined {
	const requestId = typeof record.id === "string" ? record.id : "";
	const method = typeof record.method === "string" ? record.method : "";
	const title = typeof record.title === "string" ? record.title : method;

	switch (method) {
		case "select": {
			const options = Array.isArray(record.options)
				? record.options.filter((option): option is string => typeof option === "string")
				: [];
			return {
				kind: "choice",
				requestId,
				mode: "select",
				component: new ChoiceDialog({ kind: "select", title, options, onDone: () => {} }),
			};
		}
		case "confirm": {
			const message = typeof record.message === "string" ? record.message : undefined;
			return {
				kind: "choice",
				requestId,
				mode: "confirm",
				component: new ChoiceDialog({
					kind: "confirm",
					title,
					message,
					options: ["Yes", "No"],
					onDone: () => {},
				}),
			};
		}
		case "input":
		case "editor": {
			const prefill = typeof record.prefill === "string" ? record.prefill : undefined;
			return {
				kind: "text",
				requestId,
				component: new TextDialog(title, prefill, method === "editor"),
				multiline: method === "editor",
			};
		}
		default:
			return undefined;
	}
}

/** Translate a dialog result into the documented `extension_ui_response` shape. */
export function dialogResponse(
	dialog: Dialog,
	value: string | undefined,
): Record<string, unknown> {
	if (dialog.kind === "choice" && dialog.mode === "confirm") {
		if (value === undefined) {
			return { type: "extension_ui_response", id: dialog.requestId, cancelled: true };
		}
		return { type: "extension_ui_response", id: dialog.requestId, confirmed: value === "Yes" };
	}
	if (value === undefined) {
		return { type: "extension_ui_response", id: dialog.requestId, cancelled: true };
	}
	return { type: "extension_ui_response", id: dialog.requestId, value };
}

/** Fire-and-forget extension UI calls that RPC supports: surface, never respond. */
export function noteFireAndForget(state: UiState, record: RpcRecord): void {
	const method = typeof record.method === "string" ? record.method : "unknown";
	const detail =
		typeof record.statusText === "string"
			? record.statusText
			: Array.isArray(record.widgetLines)
				? `${record.widgetLines.length} line(s)`
				: typeof record.title === "string"
					? record.title
					: typeof record.text === "string"
						? record.text
						: typeof record.message === "string"
							? record.message
							: "";
	state.transcript.noteSystem(`${method}${detail === "" ? "" : `: ${detail}`}`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const config: CockpitConfig = loadCockpitConfig(configPathFromArgv(argv));
	const workspace = config.cwd ?? process.cwd();
	const decisions =
		config.decisionsPath === undefined ? undefined : loadDecisionLog(resolve(config.decisionsPath));

	const state: UiState = {
		workspace,
		connection: { kind: "connected" },
		transcript: new CockpitTranscript(),
		decisions,
		dialog: undefined,
		decisionsOpen: false,
	};

	const child = spawn(config.command ?? "pi", buildChildArgs(config), {
		cwd: workspace,
		stdio: ["pipe", "pipe", "pipe"],
		env: process.env,
	});

	const terminal = new ProcessTerminal();
	const tui: TUI = new TuiMainScreen(terminal);
	const root = new CockpitRoot(state, terminal);

	const rpc: CockpitRpc = new CockpitRpc(child, {
		onEvent: (event: CockpitEvent) => {
			applyTransportEvent(state, event, {
				onDialog: (dialog) => {
					state.dialog = dialog;
					tui.setFocus(root);
				},
			});
			tui.requestRender();
		},
	});

	root.setRenderRequester(() => tui.requestRender());
	root.onSubmit = (value) => {
		const text = value.trim();
		if (text.length === 0) return;
		const streaming = state.transcript.runState.streaming;
		const result = rpc.send({
			type: "prompt",
			message: text,
			...(streaming ? { streamingBehavior: "steer" } : {}),
		});
		if (result.outcome !== "written") {
			const label = result.outcome === "uncertain" ? "send uncertain, not retried" : "not sent";
			state.transcript.noteError(`${label}: ${result.reason ?? "control channel down"}`);
		}
	};
	root.onAbort = () => {
		// Interactive Esc: clear the queue first so abort cannot resume it, then abort.
		rpc.send({ type: "clear_queue" });
		rpc.send({ type: "abort" });
	};
	root.onQuit = () => void shutdown();
	root.onToggleDecisions = () => {
		state.decisionsOpen = !state.decisionsOpen;
		tui.requestRender();
	};
	root.onDialogResponse = (dialog, value) => {
		const result = rpc.respond(dialogResponse(dialog, value));
		if (result.outcome !== "written") {
			const label = result.outcome === "uncertain" ? "dialog reply uncertain" : "dialog reply not sent";
			state.transcript.noteError(`${label}: ${result.reason ?? "control channel down"}`);
		}
		tui.requestRender();
	};

	tui.addChild(root);
	tui.setFocus(root);

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		await rpc.stop();
		tui.stop();
		process.exit(0);
	}

	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());

	// Ask for session identity so the header shows what this cockpit is bound to.
	rpc.send({ type: "get_state" });
	tui.start();
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
	main().catch((error: unknown) => {
		process.stderr.write(`pi-cockpit: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}