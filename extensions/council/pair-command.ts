/**
 * PAIR-mode adapter for the ask_council tool.
 *
 * Resolves driver/navigator (from explicit params or fallback to the named
 * council's first member + chairman), runs the bounded review-then-fix loop
 * via runPairCoding, and formats the structured result for the tool reply.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import type { CouncilDefinition } from "./types.js";

/** @public */
export interface CouncilSlotLike {
	definition: CouncilDefinition;
	availableSnapshot: string[];
}

/** @public */
export interface AskCouncilPairInput {
	prompt: string;
	council?: string;
	files?: string[];
	specPath?: string;
	models?: { driver?: string; navigator?: string };
	limits?: { maxFixPasses?: number; timeoutMs?: number };
}

/** @public */
export interface PairToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

type ToolUpdate = (result: PairToolResult) => void;

interface ResolvedPair {
	driver: string;
	navigator: string;
	warnings: string[];
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `PAIR mode ${role} must be a model id, not an agent ref ("${value}"). Live agents are session-scoped and don't fit the PAIR Driver/Navigator contract — pass models.${role} explicitly or set a model-only council as default.`;
	}
	return undefined;
}

function pickPairModels(
	params: AskCouncilPairInput,
	councils: Map<string, CouncilSlotLike>,
): ResolvedPair {
	const slot = councils.get(params.council ?? "default");
	const requestedDriver = params.models?.driver?.trim();
	const requestedNavigator = params.models?.navigator?.trim();
	const driver = requestedDriver || slot?.definition.members[0];
	const navigator = requestedNavigator || slot?.definition.chairman;
	if (!driver || !navigator) {
		throw new Error(
			"PAIR mode needs models.driver and models.navigator (or a default council to fall back on).",
		);
	}
	const driverErr = rejectAgentRef("driver", driver);
	if (driverErr) throw new Error(driverErr);
	const navigatorErr = rejectAgentRef("navigator", navigator);
	if (navigatorErr) throw new Error(navigatorErr);
	const warnings: string[] = [];
	if (driver === navigator) {
		warnings.push(
			`driver and navigator are both "${driver}" — review will not surface independent perspective.`,
		);
	}
	return { driver, navigator, warnings };
}

function formatPairResult(result: PairResult, modelWarnings: string[]): PairToolResult {
	const sections: string[] = [];
	if (modelWarnings.length > 0) {
		sections.push(`Pre-flight warnings:\n${modelWarnings.map((w) => `- ${w}`).join("\n")}`);
	}
	if (result.context.warnings.length > 0) {
		sections.push(
			`Context warnings:\n${result.context.warnings.map((w) => `- ${w}`).join("\n")}`,
		);
	}
	if (result.errors.length > 0) {
		sections.push(`Errors:\n${result.errors.map((e) => `- ${e}`).join("\n")}`);
	}
	const body =
		sections.length > 0 ? `${result.summary}\n\n${sections.join("\n\n")}` : result.summary;
	const details: Record<string, unknown> = {
		mode: result.mode,
		ok: result.ok,
		phases: result.phases,
		context: result.context,
		warnings: [...modelWarnings, ...result.context.warnings],
	};
	return { content: [{ type: "text", text: body }], details };
}

interface RunPairArgs {
	params: AskCouncilPairInput;
	ctx: ExtensionContext;
	onUpdate: ToolUpdate | undefined;
	councils: Map<string, CouncilSlotLike>;
}

/** Adapter the ask_council tool calls when params.mode === "PAIR". */
export async function runPairMode(args: RunPairArgs): Promise<PairToolResult> {
	const picked = pickPairModels(args.params, args.councils);
	args.ctx.ui.notify(
		`PAIR-CODING: driver=${picked.driver} navigator=${picked.navigator}`,
		"info",
	);
	const result = await runPairCoding({
		ctx: args.ctx,
		prompt: args.params.prompt,
		driver: picked.driver,
		navigator: picked.navigator,
		files: args.params.files,
		specPath: args.params.specPath,
		maxFixPasses: args.params.limits?.maxFixPasses,
		timeoutMs: args.params.limits?.timeoutMs,
		onProgress: (label) => {
			args.ctx.ui.setStatus("council", `pair: ${label}`);
			args.onUpdate?.({ content: [{ type: "text", text: label }], details: {} });
		},
	});
	return formatPairResult(result, picked.warnings);
}
