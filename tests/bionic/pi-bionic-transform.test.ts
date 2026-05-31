import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import bionicExtension from "../../extensions/pi-bionic/index.js";
import { bionicTransform } from "../../extensions/pi-bionic/bionic.js";
import type { ToolResult } from "../../lib/tool-result.js";

interface RegisteredTool {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
}

function registeredTools(): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const api = {
		registerTool(definition: RegisteredTool) {
			tools.set(definition.name, definition);
		},
		registerCommand() {},
	} as unknown as ExtensionAPI;
	bionicExtension(api);
	return tools;
}

async function callBionicText(params: Record<string, unknown>): Promise<ToolResult> {
	const tool = registeredTools().get("bionic_text");
	if (tool === undefined) throw new Error("bionic_text not registered");
	return tool.execute("test-call", params);
}

describe("pi bionic extension", () => {
	it("transforms simple text with deterministic fixture markers", () => {
		const result = bionicTransform("hello there", { sep: ["[", "]"] });

		expect(result.text).toBe("[hel]lo [the]re");
		expect(result.metadata.wordsTouched).toBe(2);
	});

	it("preserves punctuation and whitespace while marking word runs", () => {
		const result = bionicTransform(" text-vide, ok\nnext ", { sep: ["<", ">"] });

		expect(result.text).toBe(" <tex>t-<vid>e, <o>k\n<nex>t ");
	});

	it("handles empty, one-character, punctuation-only, and digit edge cases", () => {
		expect(bionicTransform("", { sep: ["[", "]"] }).text).toBe("");
		expect(bionicTransform("a", { sep: ["[", "]"] }).text).toBe("a");
		expect(bionicTransform("-----", { sep: ["[", "]"] }).text).toBe("-----");
		expect(bionicTransform("1234-567890", { sep: ["[", "]"] }).text).toBe("1234-567890");
	});

	it("defaults to raw ANSI bold markers", () => {
		expect(bionicTransform("hello").text).toBe("\u001b[1mhel\u001b[22mlo");
	});

	it("registers the bionic_text tool", async () => {
		const result = await callBionicText({ text: "hello there", sepOpen: "[", sepClose: "]" });

		expect(result.content[0]?.text).toBe("[hel]lo [the]re");
		expect(result.details.wordsTouched).toBe(2);
		expect(result.details.cleanRoom).toContain("T-245");
	});
});
