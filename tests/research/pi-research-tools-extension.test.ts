import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import researchToolsExtension from "../../extensions/pi-research-tools/index.js";
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
	} as unknown as ExtensionAPI;
	researchToolsExtension(api);
	return tools;
}

async function callTool(tools: Map<string, RegisteredTool>, name: string, params: Record<string, unknown>): Promise<ToolResult> {
	const tool = tools.get(name);
	if (tool === undefined) throw new Error(`Tool not registered: ${name}`);
	return tool.execute("test-call", params);
}

describe("pi research tools extension", () => {
	it("registers the safe T-195 dry-run tool slice", () => {
		expect([...registeredTools().keys()].sort()).toEqual([
			"arxiv_search",
			"github_search",
			"semantic_scholar",
			"semantic_scholar_search",
			"web_read",
		]);
	});

	it("returns typed JSON dry-run output for arxiv_search", async () => {
		const result = await callTool(registeredTools(), "arxiv_search", {
			query: "retrieval augmented generation",
			limit: 3,
			persistToWorkspace: true,
		});
		const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;

		expect(result.isError).toBeUndefined();
		expect(payload).toMatchObject({
			tool: "arxiv_search",
			status: "empty",
			query: "retrieval augmented generation",
			artifactWriteStatus: "not_written_dry_run",
			dryRun: true,
		});
		expect(payload.results).toEqual([]);
		expect(result.details.tool).toBe("arxiv_search");
	});

	it("supports semantic_scholar as the public tool and semantic_scholar_search as compatibility alias", async () => {
		const tools = registeredTools();
		const publicResult = await callTool(tools, "semantic_scholar", { query: "agent evaluation" });
		const aliasResult = await callTool(tools, "semantic_scholar_search", { query: "agent evaluation" });

		expect(JSON.parse(publicResult.content[0]?.text ?? "{}")).toMatchObject({ tool: "semantic_scholar", metadata: { manifestName: "semantic_scholar_search" } });
		expect(JSON.parse(aliasResult.content[0]?.text ?? "{}")).toMatchObject({ tool: "semantic_scholar_search", metadata: { manifestName: "semantic_scholar_search" } });
	});

	it("returns JSON dry-run output for github_search", async () => {
		const result = await callTool(registeredTools(), "github_search", { query: "pi coding agent" });
		const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;

		expect(payload).toMatchObject({
			tool: "github_search",
			status: "empty",
			artifactWriteStatus: "not_requested",
			dryRun: true,
		});
	});

	it("validates web_read URLs without fetching them", async () => {
		const tools = registeredTools();
		const result = await callTool(tools, "web_read", { url: "https://example.invalid/page", persistToWorkspace: true });
		const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;

		expect(payload).toMatchObject({
			tool: "web_read",
			status: "empty",
			url: "https://example.invalid/page",
			content: "",
			artifactWriteStatus: "not_written_dry_run",
			dryRun: true,
		});
		await expect(callTool(tools, "web_read", { url: "file:///tmp/nope" })).rejects.toThrow(/http/);
	});

	it("rejects malformed search inputs before any provider call could run", async () => {
		const tools = registeredTools();
		await expect(callTool(tools, "arxiv_search", { query: " ", limit: 1 })).rejects.toThrow(/query/);
		await expect(callTool(tools, "arxiv_search", { query: "ok", limit: 0 })).rejects.toThrow(/limit/);
	});
});
