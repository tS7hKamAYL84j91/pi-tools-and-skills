/** Synthetic-only Panopticon MEMORY.md renderer POC. */

const MEMORY_SCHEMA_VERSION = 1;
const MAX_MEMORY_BYTES = 16 * 1024;
const MAX_ACTIVITY_BULLETS = 20;
const MAX_TEXT_CHARS = 240;
const REDACTED = "[REDACTED]";
const SECRET_PATTERNS = [
	/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
	/\b(authorization)\s*:\s*bearer\s+[^\s,;]+/gi,
	/\b(cookie)\s*:\s*[^\n]+/gi,
	/([?&](?:api[_-]?key|token|secret|access_token)=)([^&#\s]+)/gi,
];

interface AgentMemoryInput {
	agentId: string;
	registryName: string;
	spawnName?: string;
	nameSource: string;
	pid: number;
	cwd: string;
	model: string;
	status: string;
	visibility: string;
	parentId?: string;
	startedAt: string;
	heartbeatAt: string;
	snapshotAt: string;
	sessionFileRef?: string;
	sessionDirRef?: string;
}

interface ActivityWindowInput {
	count: number;
	hash: string;
	from: string;
	to: string;
}

interface SyntheticMemoryInput {
	schemaVersion?: number;
	agent: AgentMemoryInput;
	activityWindow: ActivityWindowInput;
	redaction: { policy: "synthetic"; count?: number };
	sourceRegistryHash?: string;
	currentState: string;
	activity: string[];
	blockers: string[];
	assumptions: string[];
	artifacts: string[];
	recovery: string[];
	warnings: string[];
}

interface RenderMemoryOptions {
	maxBytes?: number;
	maxActivityBullets?: number;
	maxTextChars?: number;
}

interface RedactedText {
	text: string;
	count: number;
}

function redactText(value: string, maxChars: number): RedactedText {
	let text = value;
	let count = 0;
	for (const pattern of SECRET_PATTERNS) {
		text = text.replace(pattern, (...args: unknown[]) => {
			count += 1;
			const match = String(args[0]);
			if (match.startsWith("?") || match.startsWith("&")) return `${match.slice(0, match.indexOf("=") + 1)}${REDACTED}`;
			const key = match.split(/[:=]/, 1)[0] ?? "value";
			return `${key.trim()}=${REDACTED}`;
		});
	}
	if (text.length > maxChars) return { text: `${text.slice(0, maxChars - 1)}…`, count };
	return { text, count };
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function renderOptionalYaml(key: string, value: string | undefined, lines: string[]): void {
	if (value !== undefined) lines.push(`${key}: ${yamlString(value)}`);
}

function bulletLines(values: readonly string[], emptyText: string, maxChars: number): { lines: string[]; redactions: number } {
	if (values.length === 0) return { lines: [`- ${emptyText}`], redactions: 0 };
	let redactions = 0;
	const lines = values.map((value) => {
		const redacted = redactText(value, maxChars);
		redactions += redacted.count;
		return `- ${redacted.text}`;
	});
	return { lines, redactions };
}

function appendSection(args: {
	lines: string[];
	title: string;
	values: readonly string[];
	emptyText: string;
	maxChars: number;
}): number {
	args.lines.push("", `## ${args.title}`);
	const bullets = bulletLines(args.values, args.emptyText, args.maxChars);
	args.lines.push(...bullets.lines);
	return bullets.redactions;
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function truncateToByteLimit(value: string, maxBytes: number): string {
	const marker = "\n\n[Snapshot truncated to size cap.]\n";
	if (byteLength(value) <= maxBytes) return value;
	let candidate = value.slice(0, Math.max(0, maxBytes - byteLength(marker)));
	while (byteLength(`${candidate}${marker}`) > maxBytes && candidate.length > 0) candidate = candidate.slice(0, -1);
	return `${candidate}${marker}`;
}

/** Render a MEMORY.md-shaped document from synthetic in-repo fixture data only. */
export function renderSyntheticPanopticonMemory(input: SyntheticMemoryInput, options: RenderMemoryOptions = {}): string {
	if (input.schemaVersion !== undefined && input.schemaVersion !== MEMORY_SCHEMA_VERSION) throw new Error("unsupported synthetic memory schemaVersion");
	if (input.redaction.policy !== "synthetic") throw new Error("synthetic memory renderer only accepts synthetic redaction policy");
	const maxBytes = options.maxBytes ?? MAX_MEMORY_BYTES;
	const maxActivityBullets = options.maxActivityBullets ?? MAX_ACTIVITY_BULLETS;
	const maxTextChars = options.maxTextChars ?? MAX_TEXT_CHARS;
	const frontMatter = [
		"---",
		`schemaVersion: ${MEMORY_SCHEMA_VERSION}`,
		`agentId: ${yamlString(input.agent.agentId)}`,
		`registryName: ${yamlString(input.agent.registryName)}`,
	];
	renderOptionalYaml("spawnName", input.agent.spawnName, frontMatter);
	frontMatter.push(
		`nameSource: ${yamlString(input.agent.nameSource)}`,
		`pid: ${input.agent.pid}`,
		`cwd: ${yamlString(input.agent.cwd)}`,
		`model: ${yamlString(input.agent.model)}`,
		`status: ${yamlString(input.agent.status)}`,
		`visibility: ${yamlString(input.agent.visibility)}`,
	);
	renderOptionalYaml("parentId", input.agent.parentId, frontMatter);
	frontMatter.push(
		`startedAt: ${yamlString(input.agent.startedAt)}`,
		`heartbeatAt: ${yamlString(input.agent.heartbeatAt)}`,
		`snapshotAt: ${yamlString(input.agent.snapshotAt)}`,
	);
	renderOptionalYaml("sessionFileRef", input.agent.sessionFileRef, frontMatter);
	renderOptionalYaml("sessionDirRef", input.agent.sessionDirRef, frontMatter);
	frontMatter.push(
		`activityWindow: ${yamlString(`${input.activityWindow.count}:${input.activityWindow.hash}:${input.activityWindow.from}..${input.activityWindow.to}`)}`,
		`redaction: ${yamlString(input.redaction.policy)}`,
	);
	const redactionLineIndex = frontMatter.length;
	frontMatter.push("redactionCount: 0");
	renderOptionalYaml("sourceRegistryHash", input.sourceRegistryHash, frontMatter);
	frontMatter.push("---", "", `# MEMORY.md — ${input.agent.registryName}`, "", "> Advisory synthetic Panopticon memory snapshot. Not authoritative for routing, liveness, approval, resume, or task ownership.");

	const body = [...frontMatter];
	let redactionCount = input.redaction.count ?? 0;
	const currentState = redactText(input.currentState, maxTextChars);
	redactionCount += currentState.count;
	body.push("", "## Current state", currentState.text);
	redactionCount += appendSection({ lines: body, title: "Last safe activity summary", values: input.activity.slice(0, maxActivityBullets), emptyText: "No safe activity summary provided.", maxChars: maxTextChars });
	if (input.activity.length > maxActivityBullets) body.push(`- ${input.activity.length - maxActivityBullets} additional activity item(s) omitted by cap.`);
	redactionCount += appendSection({ lines: body, title: "Known blockers / pending input", values: input.blockers, emptyText: "No blockers recorded.", maxChars: maxTextChars });
	redactionCount += appendSection({ lines: body, title: "Assumptions and open questions", values: input.assumptions, emptyText: "No assumptions or open questions recorded.", maxChars: maxTextChars });
	redactionCount += appendSection({ lines: body, title: "Artifacts and claim-checks", values: input.artifacts, emptyText: "No artifact claim-checks recorded.", maxChars: maxTextChars });
	redactionCount += appendSection({ lines: body, title: "Recovery guidance", values: input.recovery, emptyText: "Inspect registry and bounded session claim-checks before resuming.", maxChars: maxTextChars });
	redactionCount += appendSection({ lines: body, title: "Warnings", values: input.warnings, emptyText: "Synthetic fixture only; no real registry, session, or MEMORY.md file was read or written.", maxChars: maxTextChars });
	body[redactionLineIndex] = `redactionCount: ${redactionCount}`;
	return truncateToByteLimit(`${body.join("\n")}\n`, maxBytes);
}
