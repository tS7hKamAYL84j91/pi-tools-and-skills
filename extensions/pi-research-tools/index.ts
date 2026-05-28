/**
 * Registered research tools extension.
 *
 * This first slice registers typed, dry-run research tools with JSON output.
 * It intentionally performs no live network/API calls, credential access, or
 * artifact writes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import type { ResearchToolManifestEntry } from "../../lib/research-tool-manifest.js";
import { RESEARCH_TOOL_FIXTURES } from "../../lib/research-tool-fixtures.js";

interface ResearchToolEnvelope {
	tool: string;
	status: "empty";
	query?: string;
	url?: string;
	results?: unknown[];
	content?: string;
	sourceId?: string;
	errorCategory?: string;
	errorMessage?: string;
	retryable: boolean;
	artifactWriteStatus: "not_requested" | "not_written_dry_run";
	dryRun: true;
	metadata: {
		manifestName: string;
		purpose: string;
		safety: string[];
	};
}

interface SearchInput {
	query: string;
	limit?: number;
	persistToWorkspace?: boolean;
}

interface WebReadInput {
	url: string;
	persistToWorkspace?: boolean;
}

const DEFAULT_LIMIT = 5;

function manifestByName(name: string): ResearchToolManifestEntry {
	const entry = RESEARCH_TOOL_FIXTURES.find((fixture) => fixture.name === name);
	if (entry === undefined) throw new Error(`Missing research tool manifest: ${name}`);
	return entry;
}

function boundedLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_LIMIT;
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
		throw new Error("limit must be an integer from 1 to 20");
	}
	return limit;
}

function slug(value: string): string {
	const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return normalized.slice(0, 48) || "empty";
}

function envelopeResult(envelope: ResearchToolEnvelope): ToolResult {
	return ok(JSON.stringify(envelope, null, 2), envelope as unknown as Record<string, unknown>);
}

function searchEnvelope(tool: string, manifestName: string, input: SearchInput): ResearchToolEnvelope {
	const manifest = manifestByName(manifestName);
	const query = input.query.trim();
	if (!query) throw new Error("query must be non-empty");
	const limit = boundedLimit(input.limit);
	const persistRequested = input.persistToWorkspace === true;
	return {
		tool,
		status: "empty",
		query,
		results: [],
		sourceId: `${tool}:${slug(query)}`,
		errorCategory: "dry_run_no_provider",
		errorMessage: `Dry-run only: ${tool} is registered but no live provider is enabled. Requested limit ${limit}.`,
		retryable: false,
		artifactWriteStatus: persistRequested ? "not_written_dry_run" : "not_requested",
		dryRun: true,
		metadata: {
			manifestName,
			purpose: manifest.purpose,
			safety: manifest.safety,
		},
	};
}

function webReadEnvelope(input: WebReadInput): ResearchToolEnvelope {
	const manifest = manifestByName("web_read");
	const url = input.url.trim();
	if (!/^https?:\/\//.test(url)) throw new Error("url must start with http:// or https://");
	const persistRequested = input.persistToWorkspace === true;
	return {
		tool: "web_read",
		status: "empty",
		url,
		content: "",
		sourceId: `web_read:${slug(url)}`,
		errorCategory: "dry_run_no_provider",
		errorMessage: "Dry-run only: web_read is registered but no live fetch provider is enabled.",
		retryable: false,
		artifactWriteStatus: persistRequested ? "not_written_dry_run" : "not_requested",
		dryRun: true,
		metadata: {
			manifestName: "web_read",
			purpose: manifest.purpose,
			safety: manifest.safety,
		},
	};
}

function registerSearchTool(pi: ExtensionAPI, tool: string, manifestName: string, label: string): void {
	pi.registerTool({
		name: tool,
		label,
		description: `${label}. Dry-run registered research tool; returns JSON and performs no live network/API calls.`,
		promptSnippet: `${tool}: dry-run registered research search tool with JSON output`,
		parameters: Type.Object({
			query: Type.String({ description: "Research query." }),
			limit: Type.Optional(Type.Number({ description: "Maximum candidate results to request later; dry-run validates 1-20." })),
			persistToWorkspace: Type.Optional(Type.Boolean({ description: "Declare that future provider output should be persisted; dry-run never writes artifacts." })),
		}),
		async execute(_id, params: SearchInput): Promise<ToolResult> {
			return envelopeResult(searchEnvelope(tool, manifestName, params));
		},
	});
}

export default function researchToolsExtension(pi: ExtensionAPI): void {
	registerSearchTool(pi, "arxiv_search", "arxiv_search", "arXiv Search");
	registerSearchTool(pi, "semantic_scholar", "semantic_scholar_search", "Semantic Scholar Search");
	registerSearchTool(pi, "semantic_scholar_search", "semantic_scholar_search", "Semantic Scholar Search Compatibility");
	registerSearchTool(pi, "github_search", "github_search", "GitHub Search");
	pi.registerTool({
		name: "web_read",
		label: "Web Read",
		description: "Read an approved URL. Dry-run registered research tool; returns JSON and performs no live network/API calls.",
		promptSnippet: "web_read: dry-run registered research URL read tool with JSON output",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP(S) URL selected by the operator or calling workflow." }),
			persistToWorkspace: Type.Optional(Type.Boolean({ description: "Declare that future provider output should be persisted; dry-run never writes artifacts." })),
		}),
		async execute(_id, params: WebReadInput): Promise<ToolResult> {
			return envelopeResult(webReadEnvelope(params));
		},
	});
}
