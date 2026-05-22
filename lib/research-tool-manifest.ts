/** Local research-tool manifest/discovery POC. No live tool invocation. */

/** @public */
export const RESEARCH_TOOL_MANIFEST_SCHEMA_VERSION = 1;

/** @public */
export interface ResearchToolField {
	name: string;
	type: "string" | "number" | "boolean" | "object" | "array";
	required?: boolean;
	description: string;
}

/** @public */
export interface ResearchArtifactPersistence {
	persistToWorkspace?: boolean;
	artifactPath?: string;
	sourceIdField?: string;
	provenanceFields?: string[];
}

/** @public */
export interface ResearchToolManifestEntry {
	schemaVersion: typeof RESEARCH_TOOL_MANIFEST_SCHEMA_VERSION;
	name: string;
	purpose: string;
	inputs: ResearchToolField[];
	outputs: ResearchToolField[];
	safety: string[];
	invocationNotes: string[];
	artifactPersistence?: ResearchArtifactPersistence;
	tags?: string[];
}

function assertNonEmpty(value: string, label: string): void {
	if (value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}

function validateField(field: ResearchToolField, label: string): void {
	assertNonEmpty(field.name, `${label}.name`);
	assertNonEmpty(field.description, `${label}.description`);
	if (!["string", "number", "boolean", "object", "array"].includes(field.type)) throw new Error(`${label}.type is unsupported`);
}

function fieldNames(fields: readonly ResearchToolField[]): Set<string> {
	return new Set(fields.map((field) => field.name));
}

function validateArtifactPersistence(entry: ResearchToolManifestEntry): void {
	const artifact = entry.artifactPersistence;
	if (artifact === undefined) return;
	if (artifact.persistToWorkspace === true) assertNonEmpty(artifact.artifactPath ?? "", "artifactPersistence.artifactPath");
	if (artifact.artifactPath !== undefined) assertNonEmpty(artifact.artifactPath, "artifactPersistence.artifactPath");
	const outputs = fieldNames(entry.outputs);
	if (artifact.sourceIdField !== undefined) {
		assertNonEmpty(artifact.sourceIdField, "artifactPersistence.sourceIdField");
		if (!outputs.has(artifact.sourceIdField)) throw new Error("artifactPersistence.sourceIdField must reference an output field");
	}
	for (const [index, field] of (artifact.provenanceFields ?? []).entries()) {
		assertNonEmpty(field, `artifactPersistence.provenanceFields[${index}]`);
		if (!outputs.has(field)) throw new Error(`artifactPersistence.provenanceFields[${index}] must reference an output field`);
	}
}

/** Validate one research tool manifest entry. */
export function validateResearchToolManifest(entry: ResearchToolManifestEntry): void {
	if (entry.schemaVersion !== RESEARCH_TOOL_MANIFEST_SCHEMA_VERSION) throw new Error("unsupported research tool schemaVersion");
	assertNonEmpty(entry.name, "name");
	if (!/^[a-z][a-z0-9_]*$/.test(entry.name)) throw new Error("name must be snake_case and start with a letter");
	assertNonEmpty(entry.purpose, "purpose");
	if (entry.inputs.length === 0) throw new Error("inputs must include at least one field");
	if (entry.outputs.length === 0) throw new Error("outputs must include at least one field");
	if (entry.safety.length === 0) throw new Error("safety must include at least one constraint");
	if (entry.invocationNotes.length === 0) throw new Error("invocationNotes must include at least one note");
	for (const [index, field] of entry.inputs.entries()) validateField(field, `inputs[${index}]`);
	for (const [index, field] of entry.outputs.entries()) validateField(field, `outputs[${index}]`);
	for (const [index, item] of entry.safety.entries()) assertNonEmpty(item, `safety[${index}]`);
	for (const [index, item] of entry.invocationNotes.entries()) assertNonEmpty(item, `invocationNotes[${index}]`);
	validateArtifactPersistence(entry);
}

/** Return validated manifests sorted by name for deterministic discovery. */
export function discoverResearchTools(entries: readonly ResearchToolManifestEntry[]): ResearchToolManifestEntry[] {
	const names = new Set<string>();
	for (const entry of entries) {
		validateResearchToolManifest(entry);
		if (names.has(entry.name)) throw new Error(`duplicate research tool "${entry.name}"`);
		names.add(entry.name);
	}
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}
