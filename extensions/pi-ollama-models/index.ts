/** Auto-sync local Ollama models into pi's models.json on session start/reload. */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { ok, type ToolResult } from "../../lib/tool-result.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");
const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 8192; // Conservative fallback to prevent context overflow on small local models
const DEFAULT_MAX_TOKENS = 4096; // Standard max output token limit for stable completions

interface PiModelConfig {
	providers?: Record<string, PiProviderConfig>;
}

interface PiProviderConfig {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	compat?: Record<string, unknown>;
	models?: PiModel[];
	[key: string]: unknown;
}

interface PiModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	compat?: Record<string, unknown>;
}

interface SyncOptions {
	modelsPath?: string;
	ollamaCommand?: string;
	dryRun?: boolean;
}

function prettyName(modelId: string): string {
	let name = modelId.replace(":", " (");
	if (name.includes("(")) name += ")";
	return `${name.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase())} (Ollama)`;
}

export function parseOllamaList(output: string): string[] {
	return output
		.split("\n")
		.slice(1)
		.map((line) => line.trim().split(/\s+/)[0])
		.filter((id): id is string => id !== undefined && id.length > 0);
}

export function modelFromOllamaShow(modelId: string, showOutput: string): PiModel {
	const contextMatch = /context length\s+(\d+)/i.exec(showOutput);
	const architecture = /architecture\s+([^\n]+)/i.exec(showOutput)?.[1]?.trim().toLowerCase() ?? "";
	const showLower = showOutput.toLowerCase();
	const idLower = modelId.toLowerCase();
	const compat: Record<string, unknown> = {};
	if (architecture.startsWith("qwen")) compat.thinkingFormat = "qwen-chat-template";
	return {
		id: modelId,
		name: prettyName(modelId),
		reasoning: showLower.includes("thinking") || showLower.includes("reasoning") || idLower.includes("think") || idLower.includes("reason"),
		input: showLower.includes("vision") || idLower.includes("llava") ? ["text", "image"] : ["text"],
		contextWindow: contextMatch === null ? DEFAULT_CONTEXT_WINDOW : Number.parseInt(contextMatch[1] ?? `${DEFAULT_CONTEXT_WINDOW}`, 10),
		maxTokens: DEFAULT_MAX_TOKENS,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...(Object.keys(compat).length > 0 ? { compat } : {}),
	};
}

export function mergeOllamaModelsConfig(existing: PiModelConfig, models: PiModel[]): PiModelConfig {
	const providers = { ...(existing.providers ?? {}) };
	const currentOllama = providers.ollama ?? {};
	providers.ollama = {
		baseUrl: DEFAULT_BASE_URL,
		api: "openai-completions",
		apiKey: "ollama",
		...currentOllama,
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, ...(currentOllama.compat ?? {}) },
		models,
	};
	return { ...existing, providers };
}

async function readExistingConfig(path: string): Promise<PiModelConfig> {
	try {
		const content = await readFile(path, "utf8");
		if (!content.trim()) return {};
		return JSON.parse(content) as PiModelConfig;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		// If parsing fails, preserve the original by throwing a clear error instead of overwriting blindly
		throw new Error(`Failed to parse existing models.json config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function validateOllamaCommand(command: string): void {
	const name = basename(command);
	if (name !== "ollama" && name !== "ollama.exe") {
		throw new Error(`Security validation failed: command executable must be 'ollama', received '${name}'`);
	}
}

async function discoverOllamaModels(command: string): Promise<PiModel[]> {
	validateOllamaCommand(command);
	try {
		const { stdout } = await execFileAsync(command, ["list"], { timeout: 10_000, maxBuffer: 1024 * 1024 });
		const ids = parseOllamaList(stdout);
		const models: PiModel[] = [];
		for (const id of ids) {
			const show = await execFileAsync(command, ["show", id], { timeout: 10_000, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: "" }));
			models.push(modelFromOllamaShow(id, show.stdout));
		}
		return models;
	} catch (error) {
		throw new Error(`Failed to query Ollama service via command '${command}': ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function syncOllamaModels(options: SyncOptions = {}): Promise<ToolResult> {
	const modelsPath = options.modelsPath ?? process.env.PI_OLLAMA_MODELS_PATH ?? DEFAULT_MODELS_PATH;
	const command = options.ollamaCommand ?? process.env.PI_OLLAMA_COMMAND ?? "ollama";
	const models = await discoverOllamaModels(command);
	const config = mergeOllamaModelsConfig(await readExistingConfig(modelsPath), models);
	if (options.dryRun !== true) {
		await writeFileAtomic(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	}
	return ok(JSON.stringify({ dryRun: options.dryRun === true, modelsPath, modelCount: models.length, models: models.map((model) => model.id) }, null, 2), { dryRun: options.dryRun === true, modelsPath, modelCount: models.length });
}

export default function piOllamaModelsExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		try {
			const result = await syncOllamaModels();
			ctx.ui.notify(`pi-ollama synced ${(result.details.modelCount as number) ?? 0} model(s); reload may be needed for picker refresh.`, "info");
		} catch (error) {
			ctx.ui.notify(`pi-ollama model sync skipped: ${error instanceof Error ? error.message : "unknown error"}`, "warning");
		}
	});

	pi.registerTool({
		name: "pi_ollama_sync_models",
		label: "Pi Ollama Sync Models",
		description: "Discover local Ollama models and update pi models.json; dry-run optional.",
		parameters: Type.Object({
			modelsPath: Type.Optional(Type.String({ description: "Override pi models.json path for tests/POCs." })),
			ollamaCommand: Type.Optional(Type.String({ description: "Override ollama executable path." })),
			dryRun: Type.Optional(Type.Boolean({ description: "Discover and report without writing models.json." })),
		}),
		async execute(_id, params: SyncOptions): Promise<ToolResult> {
			return syncOllamaModels(params);
		},
	});
}
