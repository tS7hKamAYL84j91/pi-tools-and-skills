/**
 * pi-doctor extension entrypoint.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";

interface PiDoctorInput {
	includeFindings?: boolean;
}

function doctorResult(cwd: string, input: PiDoctorInput): ToolResult {
	const report = runDoctor(cwd);
	return ok(formatDoctorReport(report), {
		ok: report.ok,
		summary: report.summary,
		...(input.includeFindings ? { findings: report.findings } : {}),
	});
}

export default function piDoctorExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "pi_doctor",
		label: "Pi Doctor",
		description: "Read-only diagnostics for pi-tools extension manifests, command namespaces, and required package scripts/dependencies.",
		promptSnippet: "Run read-only pi extension diagnostics",
		parameters: Type.Object({
			includeFindings: Type.Optional(Type.Boolean({ description: "Include structured finding details in tool metadata." })),
		}),
		async execute(_id, params: PiDoctorInput, _signal, _onUpdate, ctx): Promise<ToolResult> {
			return doctorResult(ctx.cwd, params);
		},
	});

	pi.registerCommand("pi-doctor", {
		description: "Run read-only pi-tools extension diagnostics.",
		handler: async (_args, ctx) => {
			const report = runDoctor(ctx.cwd);
			ctx.ui.notify(formatDoctorReport(report), report.ok ? "info" : "warning");
		},
	});
}
