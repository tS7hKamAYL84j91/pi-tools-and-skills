/**
 * pi-bionic extension entrypoint.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { bionicTransform, type BionicTransformOptions } from "./bionic.js";

interface BionicTextInput {
	text: string;
	fixationPoint?: number;
	sepOpen?: string;
	sepClose?: string;
	ignoreHtmlTag?: boolean;
	ignoreHtmlEntity?: boolean;
}

function optionsFromInput(input: BionicTextInput): BionicTransformOptions {
	return {
		fixationPoint: input.fixationPoint,
		sep: input.sepOpen !== undefined || input.sepClose !== undefined ? [input.sepOpen ?? "", input.sepClose ?? ""] : undefined,
		ignoreHtmlTag: input.ignoreHtmlTag,
		ignoreHtmlEntity: input.ignoreHtmlEntity,
	};
}

function transformResult(input: BionicTextInput): ToolResult {
	const result = bionicTransform(input.text, optionsFromInput(input));
	return ok(result.text, { ...result.metadata, cleanRoom: "T-245/T-246/T-247 verified observable-behaviour slice" });
}

export default function bionicExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "bionic_text",
		label: "Bionic Text",
		description: "Local-only clean-room bionic-reading transform for plain text. No file I/O, network, or provider calls.",
		promptSnippet: "Transform plain text into bionic-reading marked output",
		parameters: Type.Object({
			text: Type.String({ description: "Plain input text to transform." }),
			fixationPoint: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, default: 1 })),
			sepOpen: Type.Optional(Type.String({ description: "Opening marker. Defaults to raw ANSI bold." })),
			sepClose: Type.Optional(Type.String({ description: "Closing marker. Defaults to raw ANSI bold-off." })),
			ignoreHtmlTag: Type.Optional(Type.Boolean({ default: true })),
			ignoreHtmlEntity: Type.Optional(Type.Boolean({ default: true })),
		}),
		async execute(_id, params: BionicTextInput): Promise<ToolResult> {
			return transformResult(params);
		},
	});

	pi.registerCommand("bionic-text", {
		description: "Preview bionic-reading marked text for the supplied argument.",
		handler: async (args, ctx) => {
			const result = bionicTransform(args);
			ctx.ui.notify(result.text, "info");
		},
	});
}
