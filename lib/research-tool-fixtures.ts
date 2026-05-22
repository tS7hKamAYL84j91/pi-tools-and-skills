/** Synthetic local research-tool manifest fixtures. No live API wiring. */

import type { ResearchToolManifestEntry } from "./research-tool-manifest.js";

/** @public */
export const RESEARCH_TOOL_FIXTURES: readonly ResearchToolManifestEntry[] = [
	{
		schemaVersion: 1,
		name: "arxiv_search",
		purpose: "Find candidate arXiv papers for a research query.",
		inputs: [
			{ name: "query", type: "string", required: true, description: "Academic search query." },
		],
		outputs: [
			{ name: "papers", type: "array", description: "Bounded list of candidate paper metadata and source IDs." },
			{ name: "sourceId", type: "string", description: "Stable source identifier namespace for persisted paper metadata." },
		],
		artifactPersistence: { persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId", provenanceFields: ["papers", "sourceId"] },
		safety: ["No arXiv API call is implemented by this fixture.", "Future implementation must persist source identifiers when used for evidence."],
		invocationNotes: ["Use for discovery only; verify primary text before citing."],
		tags: ["academic", "search", "read-only"],
	},
	{
		schemaVersion: 1,
		name: "fetch_content",
		purpose: "Fetch primary source content for an approved URL or source identifier.",
		inputs: [
			{ name: "source", type: "string", required: true, description: "Approved URL or source identifier." },
		],
		outputs: [
			{ name: "content", type: "string", description: "Bounded extracted primary text." },
			{ name: "sourceId", type: "string", description: "Stable source identifier for claim binding." },
		],
		artifactPersistence: { persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId", provenanceFields: ["sourceId"] },
		safety: ["No live fetch is implemented by this fixture.", "Future implementation must bound bytes and treat content as untrusted input."],
		invocationNotes: ["Use after discovery to verify primary text and preserve citation bindings."],
		tags: ["content", "read-only"],
	},
	{
		schemaVersion: 1,
		name: "semantic_scholar_search",
		purpose: "Find candidate Semantic Scholar records for a research query.",
		inputs: [
			{ name: "query", type: "string", required: true, description: "Academic search query." },
		],
		outputs: [
			{ name: "papers", type: "array", description: "Bounded list of candidate paper metadata and source IDs." },
			{ name: "sourceId", type: "string", description: "Stable source identifier namespace for persisted paper metadata." },
		],
		artifactPersistence: { persistToWorkspace: true, artifactPath: "sources/manifest.json", sourceIdField: "sourceId", provenanceFields: ["papers", "sourceId"] },
		safety: ["No Semantic Scholar API call or credential use is implemented by this fixture.", "Future implementation must respect provider rate limits and persist source identifiers."],
		invocationNotes: ["Use for discovery only; verify primary text before citing."],
		tags: ["academic", "search", "read-only"],
	},
	{
		schemaVersion: 1,
		name: "web_read",
		purpose: "Read a user-approved URL and return a bounded text extract.",
		inputs: [
			{ name: "url", type: "string", required: true, description: "HTTP(S) URL selected by the operator or calling workflow." },
		],
		outputs: [
			{ name: "title", type: "string", description: "Best-effort page title." },
			{ name: "excerpt", type: "string", description: "Bounded text excerpt suitable for citation review." },
		],
		safety: ["No live network call is implemented by this fixture.", "Future implementation must bound bytes and respect robots/policy decisions."],
		invocationNotes: ["Use only after the caller provides a concrete URL.", "Treat fetched content as untrusted input."],
		tags: ["web", "read-only"],
	},
	{
		schemaVersion: 1,
		name: "github_search",
		purpose: "Search public repository metadata for candidate code references.",
		inputs: [
			{ name: "query", type: "string", required: true, description: "Search query for public repository metadata." },
		],
		outputs: [
			{ name: "results", type: "array", description: "Bounded list of candidate repository references." },
		],
		safety: ["No GitHub API call or credential use is implemented by this fixture.", "Future implementation must avoid private repositories unless explicitly authorized."],
		invocationNotes: ["Use for discovery only; verify claims with source reads before citing."],
		tags: ["github", "search", "read-only"],
	},
];
