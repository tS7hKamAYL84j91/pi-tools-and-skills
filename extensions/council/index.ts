/**
 * Council Mode — multi-model debate and consensus extension.
 *
 * Provides session-scoped councils of heterogeneous models. Agents can form a
 * named council, ask it to deliberate, and dissolve it when no longer needed.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_MEMBER_CANDIDATES = [
	"openai/gpt-5.5",
	"anthropic/claude-opus-4-6",
	"ollama/qwen3.5:cloud",
	"ollama/glm-5.1:cloud",
	"google/gemini-2.5-pro",
];

const DEFAULT_CHAIRMAN_CANDIDATES = [
	"openai/gpt-5.5",
	"anthropic/claude-opus-4-6",
	"google/gemini-2.5-pro",
];

const COUNCIL_MIN = 3;
const COUNCIL_MAX = 5;
const MODEL_TIMEOUT_MS = 180_000;
const PANOPTICON_PARENT_ENV = "PI_PANOPTICON_PARENT_ID";
const PANOPTICON_VISIBILITY_ENV = "PI_PANOPTICON_VISIBILITY";
const REGISTRY_DIR = join(homedir(), ".pi", "agents");
const SETTINGS_JSON = join(homedir(), ".pi", "agent", "settings.json");

const CouncilFormSchema = Type.Object({
	name: Type.String({ description: "Session-local council name, e.g. architecture or safety" }),
	purpose: Type.Optional(Type.String({ description: "What this council is for" })),
	members: Type.Optional(Type.Array(Type.String(), { description: "Council member model IDs" })),
	chairman: Type.Optional(Type.String({ description: "Chairman/synthesis model ID" })),
});

const AskCouncilSchema = Type.Object({
	prompt: Type.String({ description: "Complex question or decision to put before the council." }),
	council: Type.Optional(Type.String({ description: "Named session council to use. Defaults to default." })),
	members: Type.Optional(Type.Array(Type.String(), { description: "Ad-hoc member model IDs; overrides council members." })),
	chairman: Type.Optional(Type.String({ description: "Ad-hoc chairman model ID; overrides council chairman." })),
});

const CouncilDissolveSchema = Type.Object({
	name: Type.String({ description: "Council name to dissolve" }),
});

type CouncilFormInput = Static<typeof CouncilFormSchema>;
type AskCouncilInput = Static<typeof AskCouncilSchema>;
type CouncilDissolveInput = Static<typeof CouncilDissolveSchema>;

interface CouncilDefinition {
	name: string;
	purpose?: string;
	members: string[];
	chairman: string;
	createdAt: number;
}

interface CouncilMember {
	label: string;
	model: string;
}

interface ModelRun {
	member: CouncilMember;
	prompt: string;
	systemPrompt: string;
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

interface CritiqueRun extends ModelRun {
	rankings: string;
}

interface CouncilContext {
	id: string;
	prompt: string;
	definition: CouncilDefinition;
	members: CouncilMember[];
	chairman: CouncilMember;
	generation: ModelRun[];
	critiques: CritiqueRun[];
	synthesis?: ModelRun;
	startedAt: number;
	completedAt?: number;
}

interface RegistryRecord {
	id?: string;
	pid?: number;
	cwd?: string;
}

interface SettingsCouncil {
	members?: string[];
	chairman?: string;
	purpose?: string;
}

interface CouncilSettings {
	defaultMembers?: string[];
	defaultChairman?: string;
	councils?: Record<string, SettingsCouncil>;
}

function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	return existsSync(candidate) ? candidate : "pi";
}

function labelFor(index: number): string {
	return `Agent ${String.fromCharCode(65 + index)}`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function modelMatches(available: Set<string>, model: string): boolean {
	if (available.has(model)) return true;
	const slash = model.indexOf("/");
	if (slash < 0) return [...available].some((id) => id.endsWith(`/${model}`) || id === model);
	return false;
}

function availableModelIds(ctx: ExtensionContext): Set<string> {
	try {
		return new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
	} catch {
		return new Set();
	}
}

function readCouncilSettings(): CouncilSettings {
	try {
		if (!existsSync(SETTINGS_JSON)) return {};
		const settings = JSON.parse(readFileSync(SETTINGS_JSON, "utf-8")) as { council?: CouncilSettings };
		return settings.council ?? {};
	} catch {
		return {};
	}
}

export function chooseCouncilModels(ctx: ExtensionContext, requested?: string[]): string[] {
	if (requested && requested.length > 0) return unique(requested).slice(0, COUNCIL_MAX);

	const settings = readCouncilSettings();
	if (settings.defaultMembers && settings.defaultMembers.length > 0) {
		return unique(settings.defaultMembers).slice(0, COUNCIL_MAX);
	}

	const available = availableModelIds(ctx);
	if (available.size === 0) return DEFAULT_MEMBER_CANDIDATES.slice(0, COUNCIL_MIN);

	const chosen = DEFAULT_MEMBER_CANDIDATES.filter((model) => modelMatches(available, model));
	if (chosen.length >= COUNCIL_MIN) return chosen.slice(0, COUNCIL_MAX);

	for (const model of available) {
		if (chosen.length >= COUNCIL_MIN) break;
		if (!chosen.includes(model)) chosen.push(model);
	}
	return chosen.slice(0, COUNCIL_MAX);
}

export function chooseChairmanModel(ctx: ExtensionContext, members: string[], requested?: string): string {
	if (requested) return requested;
	const settings = readCouncilSettings();
	if (settings.defaultChairman) return settings.defaultChairman;
	const available = availableModelIds(ctx);
	const candidate = DEFAULT_CHAIRMAN_CANDIDATES.find((model) => modelMatches(available, model));
	return candidate ?? members[0] ?? DEFAULT_CHAIRMAN_CANDIDATES[0] ?? "openai/gpt-5.5";
}

function makeMembers(models: string[]): CouncilMember[] {
	return models.map((model, index) => ({ label: labelFor(index), model }));
}

export function anonymizeText(text: string, members: CouncilMember[]): string {
	let anonymized = text;
	for (const member of members) {
		const escaped = member.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		anonymized = anonymized.replace(new RegExp(escaped, "gi"), member.label);
	}
	return anonymized;
}

function generationSystemPrompt(): string {
	return [
		"You are a council member in a multi-agent deliberation.",
		"Give an independent, rigorous answer. Do not hedge toward consensus.",
		"Surface assumptions, risks, and decision criteria.",
		"If facts are uncertain, say so explicitly.",
	].join("\n");
}

function critiqueSystemPrompt(): string {
	return [
		"You are reviewing anonymized peer answers in a council debate.",
		"Judge logic, evidence, missing assumptions, and practical robustness.",
		"Do not infer model identity. Do not reward agreement for its own sake.",
		"Rank the answers by merit and explain key critiques concisely.",
	].join("\n");
}

function chairmanSystemPrompt(): string {
	return [
		"You are The Chairman of a multi-model council.",
		"Synthesize the strongest answer from independent responses and critiques.",
		"You must explicitly preserve disagreement rather than smoothing it away.",
		"Return exactly these sections:",
		"1. Consensus Points",
		"2. Points of Disagreement",
		"3. Final Recommendation",
		"4. Confidence and Open Questions",
	].join("\n");
}

function critiquePrompt(originalPrompt: string, generation: ModelRun[], members: CouncilMember[]): string {
	const answers = generation
		.map((run) => `## ${run.member.label}\n${anonymizeText(run.output, members)}`)
		.join("\n\n");
	return [
		"Original prompt:",
		originalPrompt,
		"",
		"Anonymized peer answers:",
		answers,
		"",
		"Critique each answer, identify errors or missing considerations, then rank all answers from strongest to weakest.",
	].join("\n");
}

function synthesisPrompt(context: CouncilContext): string {
	const rawAnswers = context.generation
		.map((run) => `## ${run.member.label} (${run.member.model})\n${run.output}`)
		.join("\n\n");
	const critiques = context.critiques
		.map((run) => `## Critique by ${run.member.label}\n${anonymizeText(run.output, context.members)}`)
		.join("\n\n");
	return [
		"Original prompt:",
		context.prompt,
		"",
		"Raw council answers:",
		rawAnswers,
		"",
		"Anonymized peer critiques and rankings:",
		critiques,
		"",
		"Produce the final council synthesis now. Highlight concrete disagreements and explain which side is more robust.",
	].join("\n");
}

async function currentPanopticonId(cwd: string): Promise<string | undefined> {
	try {
		const files = await readdir(REGISTRY_DIR);
		for (const file of files.filter((name) => name.endsWith(".json"))) {
			const raw = await readFile(join(REGISTRY_DIR, file), "utf-8");
			const record = JSON.parse(raw) as RegistryRecord;
			if (record.pid === process.pid && record.cwd === cwd && record.id) return record.id;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

interface RunPiModelArgs {
	model: string;
	prompt: string;
	systemPrompt: string;
	cwd: string;
	signal?: AbortSignal;
	parentId?: string;
}

function runPiModel(args: RunPiModelArgs): Promise<Omit<ModelRun, "member">> {
	const startedAt = Date.now();
	const piArgs = [
		"--print",
		"--model",
		args.model,
		"--no-tools",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-session",
		"--system-prompt",
		args.systemPrompt,
		args.prompt,
	];

	return new Promise((resolve) => {
		const child = spawn(resolvePiBinary(), piArgs, {
			cwd: args.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				...(args.parentId ? { [PANOPTICON_PARENT_ENV]: args.parentId, [PANOPTICON_VISIBILITY_ENV]: "scoped" } : {}),
			},
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (ok: boolean, error?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", abort);
			resolve({
				prompt: args.prompt,
				systemPrompt: args.systemPrompt,
				output: stdout.trim(),
				durationMs: Date.now() - startedAt,
				ok,
				...(error ? { error } : {}),
			});
		};
		const abort = () => {
			try { child.kill("SIGTERM"); } catch { /* best-effort */ }
			finish(false, "cancelled");
		};
		const timer = setTimeout(() => {
			try { child.kill("SIGTERM"); } catch { /* best-effort */ }
			finish(false, `timeout after ${MODEL_TIMEOUT_MS / 1000}s`);
		}, MODEL_TIMEOUT_MS);

		args.signal?.addEventListener("abort", abort, { once: true });
		child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("error", (error) => finish(false, error.message));
		child.on("close", (code) => {
			if (code === 0) finish(true);
			else finish(false, stderr.trim() || `pi exited with code ${code}`);
		});
	});
}

async function runMember(member: CouncilMember, args: {
	prompt: string;
	systemPrompt: string;
	ctx: ExtensionContext;
	parentId?: string;
}): Promise<ModelRun> {
	const run = await runPiModel({
		model: member.model,
		prompt: args.prompt,
		systemPrompt: args.systemPrompt,
		cwd: args.ctx.cwd,
		signal: args.ctx.signal,
		parentId: args.parentId,
	});
	return { member, ...run };
}

function asCritique(run: ModelRun): CritiqueRun {
	const match = run.output.match(/rank(?:ing|ings)?\s*:?([\s\S]*)/i);
	return { ...run, rankings: match?.[1]?.trim() ?? "" };
}

function formatFailures(runs: ModelRun[]): string {
	return runs
		.filter((run) => !run.ok)
		.map((run) => `- ${run.member.label} (${run.member.model}): ${run.error ?? "unknown error"}`)
		.join("\n");
}

function okText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function updateProgress(onUpdate: ((result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void) | undefined, text: string): void {
	onUpdate?.({ content: [{ type: "text", text }], details: {} });
}

function defaultCouncil(ctx: ExtensionContext): CouncilDefinition {
	const members = chooseCouncilModels(ctx);
	return {
		name: "default",
		purpose: "General high-stakes reasoning and architecture review",
		members,
		chairman: chooseChairmanModel(ctx, members),
		createdAt: Date.now(),
	};
}

function configuredCouncils(ctx: ExtensionContext): CouncilDefinition[] {
	const settings = readCouncilSettings();
	const entries = Object.entries(settings.councils ?? {});
	return entries.map(([name, config]) => {
		const members = unique(config.members ?? settings.defaultMembers ?? chooseCouncilModels(ctx));
		return {
			name,
			purpose: config.purpose,
			members,
			chairman: config.chairman ?? settings.defaultChairman ?? chooseChairmanModel(ctx, members),
			createdAt: Date.now(),
		};
	});
}

async function deliberate(args: {
	definition: CouncilDefinition;
	prompt: string;
	ctx: ExtensionContext;
	onUpdate?: (result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void;
}): Promise<CouncilContext> {
	const members = makeMembers(args.definition.members);
	const chairman = { label: "Chairman", model: args.definition.chairman };
	const council: CouncilContext = {
		id: `council-${Date.now().toString(36)}`,
		prompt: args.prompt,
		definition: args.definition,
		members,
		chairman,
		generation: [],
		critiques: [],
		startedAt: Date.now(),
	};
	const parentId = await currentPanopticonId(args.ctx.cwd);

	args.ctx.ui.setStatus("council", `${args.definition.name}: generating`);
	updateProgress(args.onUpdate, `Stage 1/3: ${args.definition.name} parallel generation...`);
	council.generation = await Promise.all(members.map((member) => runMember(member, {
		prompt: args.prompt,
		systemPrompt: generationSystemPrompt(),
		ctx: args.ctx,
		parentId,
	})));
	const successfulGeneration = council.generation.filter((run) => run.ok && run.output.length > 0);
	if (successfulGeneration.length === 0) {
		throw new Error(`All council generation calls failed:\n${formatFailures(council.generation)}`);
	}

	args.ctx.ui.setStatus("council", `${args.definition.name}: critiquing`);
	updateProgress(args.onUpdate, `Stage 2/3: ${args.definition.name} anonymized peer review...`);
	const critiqueInput = critiquePrompt(args.prompt, successfulGeneration, members);
	const reviewers = members.filter((member) => successfulGeneration.some((run) => run.member.label === member.label));
	const critiqueRuns = await Promise.all(reviewers.map((member) => runMember(member, {
		prompt: critiqueInput,
		systemPrompt: critiqueSystemPrompt(),
		ctx: args.ctx,
		parentId,
	})));
	council.critiques = critiqueRuns.map(asCritique);

	args.ctx.ui.setStatus("council", `${args.definition.name}: synthesizing`);
	updateProgress(args.onUpdate, `Stage 3/3: ${args.definition.name} chairman synthesis...`);
	council.synthesis = await runMember(chairman, {
		prompt: synthesisPrompt(council),
		systemPrompt: chairmanSystemPrompt(),
		ctx: args.ctx,
		parentId,
	});
	council.completedAt = Date.now();
	return council;
}

export default function (pi: ExtensionAPI) {
	const councils = new Map<string, CouncilDefinition>();
	let lastContext: CouncilContext | undefined;

	pi.on("session_start", async (_event, ctx) => {
		councils.clear();
		const defaults = [defaultCouncil(ctx), ...configuredCouncils(ctx)];
		for (const council of defaults) councils.set(council.name, council);
	});

	pi.registerTool({
		name: "council_form",
		label: "Form Council",
		description: "Create or replace a named session-local council for future ask_council calls.",
		promptSnippet: "Create a named council of models for this session",
		parameters: CouncilFormSchema,
		async execute(_toolCallId, params: CouncilFormInput, _signal, _onUpdate, ctx) {
			const members = unique(params.members ?? chooseCouncilModels(ctx));
			if (members.length === 0) throw new Error("Council must have at least one member model.");
			const definition: CouncilDefinition = {
				name: params.name,
				purpose: params.purpose,
				members: members.slice(0, COUNCIL_MAX),
				chairman: params.chairman ?? chooseChairmanModel(ctx, members),
				createdAt: Date.now(),
			};
			councils.set(definition.name, definition);
			return okText(`Formed council "${definition.name}" with ${definition.members.length} member(s).`, definition as unknown as Record<string, unknown>);
		},
	});

	pi.registerTool({
		name: "council_list",
		label: "List Councils",
		description: "List session-local councils available to ask_council.",
		promptSnippet: "List councils available in this session",
		parameters: Type.Object({}),
		async execute() {
			if (councils.size === 0) return okText("No councils formed in this session.", { councils: [] });
			const lines = [...councils.values()].map((council) =>
				`- ${council.name}: ${council.members.join(", ")} | chairman=${council.chairman}${council.purpose ? ` | ${council.purpose}` : ""}`,
			);
			return okText(`Councils:\n${lines.join("\n")}`, { councils: [...councils.values()] });
		},
	});

	pi.registerTool({
		name: "council_dissolve",
		label: "Dissolve Council",
		description: "Remove a named session-local council. Configured defaults return next session/reload.",
		promptSnippet: "Dissolve a named council for this session",
		parameters: CouncilDissolveSchema,
		async execute(_toolCallId, params: CouncilDissolveInput) {
			const removed = councils.delete(params.name);
			return okText(removed ? `Dissolved council "${params.name}".` : `No council named "${params.name}".`, { removed });
		},
	});

	pi.registerTool({
		name: "ask_council",
		label: "Ask Council",
		description:
			"Ask a named or ad-hoc council of heterogeneous models to debate a complex prompt using generate, critique, and synthesis stages.",
		promptSnippet: "Ask a multi-model council to debate a complex question",
		promptGuidelines: [
			"Use ask_council for high-impact architecture, strategy, research, or irreversible decisions where disagreement is valuable.",
			"Use council_form first when the user asks to create a council for an ongoing workstream.",
			"Use council_dissolve when a session council is no longer needed.",
		],
		parameters: AskCouncilSchema,
		async execute(_toolCallId, params: AskCouncilInput, _signal, onUpdate, ctx) {
			const base = councils.get(params.council ?? "default") ?? defaultCouncil(ctx);
			const members = unique(params.members ?? base.members);
			const definition: CouncilDefinition = {
				...base,
				members,
				chairman: params.chairman ?? base.chairman,
			};
			ctx.ui.notify(`Council "${definition.name}" debating with ${definition.members.length} member(s)...`, "info");
			try {
				const context = await deliberate({ definition, prompt: params.prompt, ctx, onUpdate });
				lastContext = context;
				const allRuns = context.synthesis
					? [...context.generation, ...context.critiques, context.synthesis]
					: [...context.generation, ...context.critiques];
				const failures = allRuns.filter((run) => !run.ok);
				const warning = failures.length > 0 ? `\n\nPartial failures:\n${formatFailures(failures)}` : "";
				if (!context.synthesis?.ok) {
					throw new Error(`Chairman synthesis failed: ${context.synthesis?.error ?? "unknown error"}${warning}`);
				}
				return okText(`${context.synthesis.output}${warning}`, {
					id: context.id,
					council: context.definition.name,
					members: context.members.map((member) => member.model),
					chairman: context.chairman.model,
					durationMs: (context.completedAt ?? Date.now()) - context.startedAt,
					generationSucceeded: context.generation.filter((run) => run.ok).length,
					critiqueSucceeded: context.critiques.filter((run) => run.ok).length,
					failures: failures.map((run) => ({ model: run.member.model, error: run.error })),
				});
			} finally {
				ctx.ui.setStatus("council", "");
			}
		},
	});

	pi.registerCommand("council-last", {
		description: "Show the last ask_council deliberation summary",
		handler: async (_args, ctx) => {
			if (!lastContext) {
				ctx.ui.notify("No council deliberation has run in this session.", "warning");
				return;
			}
			const lines = [
				`Council ${lastContext.id}`,
				`Name: ${lastContext.definition.name}`,
				`Members: ${lastContext.members.map((member) => `${member.label}=${member.model}`).join(", ")}`,
				`Chairman: ${lastContext.chairman.model}`,
				`Generation: ${lastContext.generation.filter((run) => run.ok).length}/${lastContext.generation.length}`,
				`Critique: ${lastContext.critiques.filter((run) => run.ok).length}/${lastContext.critiques.length}`,
			];
			ctx.ui.setWidget("council", lines);
		},
	});
}
