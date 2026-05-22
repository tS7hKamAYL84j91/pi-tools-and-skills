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

		expect(tools.map((tool) => tool.name)).toEqual(["arxiv_search", "fetch_content", "github_search", "semantic_scholar_search", "web_read"]);
		expect(tools[0]?.inputs[0]).toMatchObject({ name: "query", type: "string", required: true });
		expect(tools[0]?.artifactPersistence).toMatchObject({ persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId" });
		expect(tools.at(-1)?.safety.join(" ")).toContain("No live network call");
	});

	it("accepts a valid minimal local manifest", () => {
		expect(() => validateResearchToolManifest(valid())).not.toThrow();
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
	});

	it("rejects duplicate discovered names", () => {
		expect(() => discoverResearchTools([valid(), valid()])).toThrow(/duplicate/);
	});
});
