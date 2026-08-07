/**
 * pi-doctor extension entrypoint.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";

interface PiDoctorInput {
	includeFindings?: boolean;
	gateCommand?: string;
}

function doctorResult(cwd: string, input: PiDoctorInput): Promise<ToolResult> {
	return runDoctor(cwd, input.gateCommand).then((report) =>
		ok(formatDoctorReport(report), {
			ok: report.ok,
			summary: report.summary,
			...(input.includeFindings ? { findings: report.findings } : {}),
		}),
	);
}

function parseGateCommand(args: string): string | undefined {
	const tokens = args.trim().split(/\s+/);
	const index = tokens.indexOf("--gate");
	if (index >= 0 && tokens[index + 1]) {
		return tokens[index + 1];
	}
	return undefined;
}

export default function piDoctorExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "pi_doctor",
		label: "Pi Doctor",
		description: "Read-only diagnostics for pi-tools extension manifests, command namespaces, and required package scripts/dependencies. Optionally run a gate command that must exit 0 before PASS.",
		promptSnippet: "Run read-only pi extension diagnostics",
		parameters: Type.Object({
			includeFindings: Type.Optional(Type.Boolean({ description: "Include structured finding details in tool metadata." })),
			gateCommand: Type.Optional(Type.String({ description: "Optional command that must exit 0 before reporting PASS." })),
		}),
		async execute(_id, params: PiDoctorInput, _signal, _onUpdate, ctx): Promise<ToolResult> {
			return doctorResult(ctx.cwd, params);
		},
	});

	pi.registerCommand("pi-doctor", {
		description: "Run read-only pi-tools extension diagnostics. Use --gate <command> to require a passing gate before PASS.",
		handler: async (_args, ctx) => {
			const gateCommand = parseGateCommand(typeof _args === "string" ? _args : "");
			const report = await runDoctor(ctx.cwd, gateCommand);
			ctx.ui.notify(formatDoctorReport(report), report.ok ? "info" : "warning");
		},
	});
}
