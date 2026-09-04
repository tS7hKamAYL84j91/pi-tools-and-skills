/** Custom TUI renderers for pi-event-loop command messages and tools (SPEC §10; TODO P13). */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface CommandMessageDetails {
	readonly commandId?: string;
	readonly commandType?: string;
	readonly workItemId?: string;
	readonly correlationId?: string;
	readonly causedBy?: string;
	readonly workItem?: Readonly<Record<string, unknown>>;
	readonly expectedEvents?: readonly string[];
}

interface CommandMessageLike {
	readonly details?: CommandMessageDetails;
	readonly content?: string;
}

interface RenderContextLike {
	readonly expanded?: boolean;
	readonly lastComponent?: unknown;
}

interface EmitCallArgs {
	readonly event?: string;
	readonly dedupeKey?: string;
	readonly payload?: Readonly<Record<string, unknown>>;
}

interface EmitResultDetails {
	readonly accepted?: boolean;
	readonly eventId?: string;
	readonly type?: string;
	readonly workItemId?: string;
	readonly commandId?: string;
}

interface EmitResultLike {
	readonly content?: ReadonlyArray<{ type: string; text?: string }>;
	readonly details?: EmitResultDetails;
}

interface ContextResultDetails {
	readonly profileName?: string;
	readonly profile?: string;
	readonly paused?: boolean;
	readonly pauseReason?: string;
	readonly activeCommand?: { readonly type: string; readonly commandId: string };
	readonly pendingCommandCount?: number;
	readonly openItemCount?: number;
	readonly viewRows?: Readonly<Record<string, unknown[]>>;
}

interface ContextResultLike {
	readonly content?: ReadonlyArray<{ type: string; text?: string }>;
	readonly details?: ContextResultDetails;
}

function resolveTextComponent(context?: RenderContextLike): Text {
	if (context?.lastComponent instanceof Text) {
		return context.lastComponent;
	}
	return new Text("", 0, 0);
}

export function renderCommandMessage(
	message: CommandMessageLike,
	options: { readonly expanded: boolean },
	theme: Theme,
): Text {
	const details = message.details;
	const commandType = details?.commandType ?? "command";
	const commandId = details?.commandId ?? "unknown";

	if (!options.expanded) {
		const label = theme.fg("accent", "[event-loop command]");
		const title = theme.fg("toolTitle", commandType);
		const id = theme.fg("muted", `(${commandId})`);
		return new Text(`${label} ${title} ${id}`, 0, 0);
	}

	const lines: string[] = [
		`${theme.fg("accent", "[event-loop command]")} ${theme.fg("toolTitle", commandType)} ${theme.fg("muted", `(${commandId})`)}`,
		`${theme.fg("muted", "workItemId:")} ${details?.workItemId ?? "none"}`,
		`${theme.fg("muted", "correlationId:")} ${details?.correlationId ?? "none"}`,
		`${theme.fg("muted", "expected outcomes:")} ${details?.expectedEvents?.join(", ") ?? "none"}`,
	];

	if (details?.workItem !== undefined) {
		lines.push(
			`${theme.fg("warning", "[untrusted data] workItem:")} ${JSON.stringify(details.workItem, null, 2)}`,
		);
	}

	return new Text(lines.join("\n"), 0, 0);
}

export function renderEmitCall(
	args: EmitCallArgs,
	theme: Theme,
	context?: RenderContextLike,
): Text {
	const text = resolveTextComponent(context);
	const toolLabel = theme.fg("toolTitle", "event_loop_emit");
	const eventLabel = theme.fg("accent", args.event ?? "unknown");
	const keyLabel = theme.fg("muted", `(${args.dedupeKey ?? ""})`);

	if (!context?.expanded) {
		text.setText(`${toolLabel} ${eventLabel} ${keyLabel}`);
		return text;
	}

	const lines = [`${toolLabel} ${eventLabel} ${keyLabel}`];
	if (args.payload !== undefined) {
		lines.push(`${theme.fg("muted", "payload:")} ${JSON.stringify(args.payload, null, 2)}`);
	}
	text.setText(lines.join("\n"));
	return text;
}

export function renderEmitResult(
	result: EmitResultLike,
	options: { readonly expanded: boolean },
	theme: Theme,
	context?: RenderContextLike,
): Text {
	const text = resolveTextComponent(context);
	const details = result.details;

	if (!options.expanded) {
		if (details?.accepted) {
			const check = theme.fg("success", "✓");
			const action = theme.fg("text", "emitted");
			const eventName = theme.fg("accent", details.type ?? "");
			const eventId = theme.fg("muted", `(${details.eventId ?? ""})`);
			text.setText(`${check} ${action} ${eventName} ${eventId}`);
		} else {
			const firstLine = result.content?.[0]?.text ?? "event emitted";
			text.setText(theme.fg("text", firstLine));
		}
		return text;
	}

	const lines: string[] = [];
	if (details?.eventId) {
		lines.push(`${theme.fg("muted", "eventId:")} ${details.eventId}`);
	}
	if (details?.type) {
		lines.push(`${theme.fg("muted", "type:")} ${details.type}`);
	}
	if (details?.workItemId) {
		lines.push(`${theme.fg("muted", "workItemId:")} ${details.workItemId}`);
	}
	if (details?.commandId) {
		lines.push(`${theme.fg("muted", "commandId:")} ${details.commandId}`);
	}
	if (result.content?.[0]?.text) {
		lines.push(result.content[0].text);
	}
	text.setText(lines.join("\n"));
	return text;
}

export function renderContextCall(
	_args: unknown,
	theme: Theme,
	context?: RenderContextLike,
): Text {
	const text = resolveTextComponent(context);
	text.setText(theme.fg("toolTitle", "event_loop_context"));
	return text;
}

export function renderContextResult(
	result: ContextResultLike,
	options: { readonly expanded: boolean },
	theme: Theme,
	context?: RenderContextLike,
): Text {
	const text = resolveTextComponent(context);
	const details = result.details;

	if (!options.expanded) {
		const profile = details?.profileName ?? details?.profile ?? "default";
		const active = details?.activeCommand
			? theme.fg("toolTitle", `${details.activeCommand.type} (${details.activeCommand.commandId})`)
			: theme.fg("muted", "none");
		const openCount =
			details?.openItemCount ??
			(details?.viewRows
				? Object.values(details.viewRows).reduce(
						(acc, rows) => acc + (rows as unknown[]).length,
						0,
					)
				: 0);
		text.setText(
			`${theme.fg("accent", "event-loop context:")} profile=${theme.fg("text", profile)}, active=${active}, open=${theme.fg("text", String(openCount))}`,
		);
		return text;
	}

	const lines: string[] = [];
	if (details) {
		lines.push(theme.fg("accent", "Event Loop Context:"));
		lines.push(`  ${theme.fg("muted", "profile:")} ${details.profileName ?? details.profile ?? "default"}`);
		lines.push(`  ${theme.fg("muted", "paused:")} ${String(details.paused ?? false)}`);
		if (details.activeCommand) {
			lines.push(
				`  ${theme.fg("muted", "activeCommand:")} ${details.activeCommand.type} (${details.activeCommand.commandId})`,
			);
		}
		if (details.openItemCount !== undefined) {
			lines.push(`  ${theme.fg("muted", "openItems:")} ${details.openItemCount}`);
		}
	}
	if (result.content?.[0]?.text) {
		lines.push(result.content[0].text);
	}
	text.setText(lines.join("\n"));
	return text;
}
