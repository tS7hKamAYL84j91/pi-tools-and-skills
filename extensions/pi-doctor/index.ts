/**
 * pi-doctor extension entrypoint.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { formatDoctorReport, dismissAdvisory, readDismissedAdvisories, runDoctor } from "./doctor.js";

function parseAckArgument(args: string): string | undefined {
	const match = args.match(/(?:^|\s)--ack[=\s]+([A-Za-z0-9._-]+)/);
	return match?.[1];
}

interface PiDoctorInput {
	includeFindings?: boolean;
	gateCommand?: string;
}

async function doctorResult(cwd: string, input: PiDoctorInput): Promise<ToolResult> {
	const report = await runDoctor(cwd);
	const deprecation = input.gateCommand === undefined
		? ""
		: "Deprecated gateCommand was ignored; pi-doctor never executes commands.\n";
	return ok(`${deprecation}${formatDoctorReport(report)}`, {
		ok: report.ok,
		summary: report.summary,
		...(input.gateCommand === undefined ? {} : { deprecatedGateCommandIgnored: true }),
		...(input.includeFindings ? { findings: report.findings } : {}),
	});
}

function usesDeprecatedGateArgument(args: unknown): boolean {
	return typeof args === "string" && /(?:^|\s)--gate(?:\s|=|$)/.test(args);
}

export default function piDoctorExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "pi_doctor",
		label: "Pi Doctor",
		description: "Read-only diagnostics for pi-tools extension manifests, command namespaces, required package scripts/dependencies, and known supply-chain compromise advisories (advisory only).",
		promptSnippet: "Run read-only pi extension diagnostics",
		parameters: Type.Object({
			includeFindings: Type.Optional(Type.Boolean({ description: "Include structured finding details in tool metadata." })),
			gateCommand: Type.Optional(Type.String({
				description: "Deprecated compatibility input. Ignored and never executed.",
				deprecated: true,
			})),
		}),
		async execute(_id, params: PiDoctorInput, _signal, _onUpdate, ctx): Promise<ToolResult> {
			return doctorResult(ctx.cwd, params);
		},
	});

	pi.registerCommand("pi-doctor", {
		description: "Run read-only pi-tools extension diagnostics. --ack <advisory-id> dismisses a supply-chain advisory. Deprecated --gate input is accepted but ignored.",
		handler: async (args, ctx) => {
			const ackId = parseAckArgument(args);
			let ackNote = "";
			if (ackId) {
				try {
					await dismissAdvisory(ctx.cwd, ackId);
					ackNote = `Advisory ${ackId} dismissed.\n`;
				} catch (error) {
					ctx.ui.notify(`${(error as Error).message}\nKnown ids are listed in extensions/pi-doctor/advisories.ts.`, "warning");
					return;
				}
			}
			const dismissed = await readDismissedAdvisories(ctx.cwd);
			const report = await runDoctor(ctx.cwd, dismissed);
			const deprecatedGate = usesDeprecatedGateArgument(args);
			const deprecation = deprecatedGate
				? "Deprecated /pi-doctor --gate input was ignored; no command was executed.\n"
				: "";
			ctx.ui.notify(`${ackNote}${deprecation}${formatDoctorReport(report)}`, deprecatedGate || !report.ok ? "warning" : "info");
		},
	});
}
