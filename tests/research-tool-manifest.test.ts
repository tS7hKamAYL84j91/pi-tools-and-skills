import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESEARCH_TOOL_FIXTURES } from "../lib/research-tool-fixtures.js";
import { discoverResearchTools, validateResearchToolManifest, type ResearchToolManifestEntry } from "../lib/research-tool-manifest.js";

function valid(overrides: Partial<ResearchToolManifestEntry> = {}): ResearchToolManifestEntry {
	return {
		schemaVersion: 1,
		name: "local_search",
		purpose: "Search local synthetic notes.",
		inputs: [{ name: "query", type: "string", required: true, description: "Synthetic query." }],
		outputs: [{ name: "results", type: "array", description: "Synthetic results." }],
		safety: ["No network calls."],
		invocationNotes: ["Fixture only."],
		...overrides,
	};
}

describe("research tool manifests", () => {
	it("validates bundled fixture definitions", () => {
		const tools = discoverResearchTools(RESEARCH_TOOL_FIXTURES);

		expect(tools.map((tool) => tool.name)).toEqual(["arxiv_search", "fetch_content", "github_search", "semantic_scholar_search", "web_read", "web_search"]);
		expect(tools[0]?.inputs[0]).toMatchObject({ name: "query", type: "string", required: true });
		expect(tools[0]?.artifactPersistence).toMatchObject({ persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId" });
		expect(tools[0]?.resultSemantics).toMatchObject({ statusField: "status", artifactWriteStatusField: "artifactWriteStatus" });
		expect(tools.at(-1)?.safety.join(" ")).toContain("No live web search");
	});

	it("keeps current deep-research explorer tool names registered as metadata-only fixtures", () => {
		const explorerPrompt = readFileSync("extensions/pi-teams/config/agents/deep-research-explorer.md", "utf8");
		const registeredNames = new Set(discoverResearchTools(RESEARCH_TOOL_FIXTURES).map((tool) => tool.name));
		const promptToolNames = Array.from(explorerPrompt.matchAll(/`([a-z][a-z0-9_]+)`/g)).flatMap((match) => {
			const name = match[1];
			return name !== undefined && (name.endsWith("_search") || name === "fetch_content") ? [name] : [];
		});

		expect(promptToolNames).toEqual(expect.arrayContaining(["arxiv_search", "semantic_scholar_search", "fetch_content", "web_search"]));
		for (const name of promptToolNames) {
			expect(registeredNames.has(name)).toBe(true);
		}
	});

	it("declares source identifiers, provenance, and result semantics for bundled discovery fixtures", () => {
		for (const tool of discoverResearchTools(RESEARCH_TOOL_FIXTURES)) {
			expect(tool.artifactPersistence?.sourceIdField).toBe("sourceId");
			expect(tool.artifactPersistence?.provenanceFields).toContain("sourceId");
			expect(tool.resultSemantics?.statusField).toBe("status");
			expect(tool.outputs.map((output) => output.name)).toContain("sourceId");
		}
	});

	it("accepts valid success, partial, failure, and empty result semantics metadata", () => {
		const outputs = [
			{ name: "status", type: "string" as const, description: "One of success, partial, failure, or empty." },
			{ name: "results", type: "array" as const, description: "Synthetic results; empty when status is empty." },
			{ name: "sourceId", type: "string" as const, description: "Required for success and partial results." },
			{ name: "errorCategory", type: "string" as const, description: "Set for partial or failure results." },
			{ name: "errorMessage", type: "string" as const, description: "Bounded error summary." },
			{ name: "retryable", type: "boolean" as const, description: "Whether retry is useful." },
			{ name: "artifactWriteStatus", type: "string" as const, description: "Artifact write expectation." },
		];
		expect(() => validateResearchToolManifest(valid({
			outputs,
			artifactPersistence: { persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId", provenanceFields: ["results", "sourceId"] },
			resultSemantics: {
				statusField: "status",
				errorCategoryField: "errorCategory",
				errorMessageField: "errorMessage",
				retryableField: "retryable",
				artifactWriteStatusField: "artifactWriteStatus",
				sourceIdRequiredStatuses: ["success", "partial"],
			},
		}))).not.toThrow();
	});

	it("rejects invalid or missing fields", () => {
		expect(() => validateResearchToolManifest(valid({ schemaVersion: 2 as 1 }))).toThrow(/schemaVersion/);
		expect(() => validateResearchToolManifest(valid({ name: "BadName" }))).toThrow(/snake_case/);
		expect(() => validateResearchToolManifest(valid({ inputs: [] }))).toThrow(/inputs/);
		expect(() => validateResearchToolManifest(valid({ outputs: [{ name: "x", type: "bad" as never, description: "bad" }] }))).toThrow(/unsupported/);
		expect(() => validateResearchToolManifest(valid({ safety: [""] }))).toThrow(/safety/);
		expect(() => validateResearchToolManifest(valid({ artifactPersistence: { persistToWorkspace: true } }))).toThrow(/artifactPath/);
		expect(() => validateResearchToolManifest(valid({ artifactPersistence: { sourceIdField: "missing" } }))).toThrow(/sourceIdField/);
		expect(() => validateResearchToolManifest(valid({ artifactPersistence: { provenanceFields: ["missing"] } }))).toThrow(/provenanceFields/);
		expect(() => validateResearchToolManifest(valid({ resultSemantics: { statusField: "missing" } }))).toThrow(/statusField/);
		expect(() => validateResearchToolManifest(valid({
			artifactPersistence: { persistToWorkspace: true, artifactPath: "sources/manifest.json" },
			resultSemantics: { statusField: "results" },
		}))).toThrow(/artifactWriteStatusField/);
		expect(() => validateResearchToolManifest(valid({ resultSemantics: { statusField: "results", sourceIdRequiredStatuses: ["success"] } }))).toThrow(/sourceIdRequiredStatuses/);
	});

	it("rejects duplicate discovered names", () => {
		expect(() => discoverResearchTools([valid(), valid()])).toThrow(/duplicate/);
	});
});
