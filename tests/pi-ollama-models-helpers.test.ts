import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import ollamaModelsExtension, {
	mergeOllamaModelsConfig,
	modelFromOllamaShow,
	modelIdsChanged,
	parseOllamaList,
} from "../extensions/pi-ollama-models/index.js";

import { withAdvisoryLock } from "../lib/file-lock.js";

interface OllamaToolResult {
	details: Record<string, unknown>;
}

interface RegisteredOllamaTool {
	parameters: {
		properties?: Record<string, unknown>;
		additionalProperties?: boolean;
	};
	execute: (
		id: string,
		params: Record<string, unknown>,
	) => Promise<OllamaToolResult>;
}

describe("pi ollama models extension helpers", () => {
	it("parses ollama list output", () => {
		expect(
			parseOllamaList(
				"NAME ID SIZE MODIFIED\nqwen3:8b abc 5 GB now\ngemma4:26b def 16 GB now\n",
			),
		).toEqual(["qwen3:8b", "gemma4:26b"]);
	});

	it("converts ollama show output to pi model config", () => {
		const model = modelFromOllamaShow(
			"qwen3-think:8b",
			"architecture qwen3\ncontext length 40960\nparameters reasoning vision",
		);

		expect(model).toMatchObject({
			id: "qwen3-think:8b",
			name: "Qwen3 Think (8b) (Ollama)",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 40960,
			maxTokens: 4096,
			compat: { thinkingFormat: "qwen-chat-template" },
		});
	});

	it("uses conservative fallbacks when context length is missing", () => {
		const model = modelFromOllamaShow("llama3:latest", "parameters none");

		expect(model).toMatchObject({
			id: "llama3:latest",
			name: "Llama3 (Latest) (Ollama)",
			reasoning: false,
			input: ["text"],
			contextWindow: 8192,
			maxTokens: 4096,
		});
	});

	it("replaces only the ollama provider models while preserving other providers", () => {
		const model = modelFromOllamaShow("gemma4:26b", "");
		const config = mergeOllamaModelsConfig(
			{
				providers: {
					openrouter: { apiKey: "cmd" },
					ollama: { baseUrl: "custom", models: [] },
				},
			},
			[model],
		);

		expect(config.providers?.openrouter).toEqual({ apiKey: "cmd" });
		expect(config.providers?.ollama?.baseUrl).toBe("custom");
		expect(config.providers?.ollama?.models).toEqual([model]);
	});

	it("preserves configured model fields and merges compatibility defaults", () => {
		const discovered = modelFromOllamaShow("qwen3:8b", "architecture qwen3\ncontext length 40960");
		const override = { ...discovered, name: "My model", contextWindow: 16384, maxTokens: 2048, compat: { supportsTools: false } };
		const config = mergeOllamaModelsConfig({ providers: { ollama: { baseUrl: "custom", models: [override] } } }, [discovered]);
		expect(config.providers?.ollama?.models?.[0]).toMatchObject({ name: "My model", contextWindow: 16384, maxTokens: 2048, compat: { thinkingFormat: "qwen-chat-template", supportsTools: false } });
	});

	it("serializes the full merge with cooperating config writers", async () => {
		const root = await mkdtemp(join(tmpdir(), "ollama-lock-"));
		const command = join(root, "ollama"), modelsPath = join(root, "models.json"), marker = join(root, "discovered");
		const oldCommand = process.env.PI_OLLAMA_COMMAND, oldPath = process.env.PI_OLLAMA_MODELS_PATH;
		let syncing: Promise<OllamaToolResult> | undefined;
		try {
			await writeExecutable(command, `#!/bin/sh\nif [ "$1" = "list" ]; then\n printf 'NAME ID SIZE MODIFIED\\nfixture abc 1 GB now\\n'\nelse\n touch '${marker}'\n printf 'architecture llama\\ncontext length 8192\\n'\nfi\n`);
			process.env.PI_OLLAMA_COMMAND = command; process.env.PI_OLLAMA_MODELS_PATH = modelsPath;
			let tool: RegisteredOllamaTool | undefined;
			ollamaModelsExtension({ on() {}, registerTool(value: RegisteredOllamaTool) { tool = value; } } as unknown as ExtensionAPI);
			if (!tool) throw new Error("missing tool");
			let finished = false;
			await withAdvisoryLock(modelsPath, async () => {
				syncing = tool?.execute("fixture", {}).then(result => { finished = true; return result; });
				await vi.waitFor(async () => expect((await stat(marker)).isFile()).toBe(true));
				await new Promise(resolve => setTimeout(resolve, 100));
				expect(finished).toBe(false);
				await writeFile(modelsPath, JSON.stringify({ providers: { other: { baseUrl: "fixture" }, ollama: { models: [{ id: "fixture", contextWindow: 2048 }] } } }));
			});
			await syncing;
			expect(JSON.parse(await readFile(modelsPath, "utf8"))).toMatchObject({ providers: { other: { baseUrl: "fixture" }, ollama: { models: [{ id: "fixture", contextWindow: 2048 }] } } });
			expect((await stat(modelsPath)).mode & 0o777).toBe(0o600);
		} finally {
			await syncing?.catch(() => {});
			restoreEnv("PI_OLLAMA_COMMAND", oldCommand); restoreEnv("PI_OLLAMA_MODELS_PATH", oldPath);
			await rm(root, { recursive: true, force: true });
		}
	});

	it("detects model inventory changes for startup UX", () => {
		const model = modelFromOllamaShow("gemma4:26b", "");
		const existing = mergeOllamaModelsConfig({}, [model]);

		expect(modelIdsChanged(existing, [model])).toBe(false);
		expect(
			modelIdsChanged(existing, [modelFromOllamaShow("qwen3:8b", "")]),
		).toBe(true);
		expect(modelIdsChanged({}, [model])).toBe(true);
	});

	it("rejects bare, PATH-resolved, and relative Ollama commands without executing them", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-ollama-command-boundary-"));
		const attackerCommand = join(root, "ollama");
		const marker = join(root, "command-ran");
		const previousCommand = process.env.PI_OLLAMA_COMMAND;
		const previousPath = process.env.PATH;
		const previousMarker = process.env.ATTACKER_MARKER;
		try {
			await writeExecutable(
				attackerCommand,
				[
					"#!/bin/sh",
					'touch "$ATTACKER_MARKER"',
					"printf 'NAME ID SIZE MODIFIED\\n'",
				].join("\n"),
			);
			process.env.PATH = `${root}:${previousPath ?? ""}`;
			process.env.ATTACKER_MARKER = marker;
			let registeredTool: RegisteredOllamaTool | undefined;
			const api = {
				on() {},
				registerTool(tool: RegisteredOllamaTool) {
					registeredTool = tool;
				},
			};
			ollamaModelsExtension(api as unknown as ExtensionAPI);
			if (!registeredTool) {
				throw new Error("Ollama tool was not registered");
			}

			for (const command of [
				"ollama",
				relative(process.cwd(), attackerCommand),
			]) {
				process.env.PI_OLLAMA_COMMAND = command;
				await expect(
					registeredTool.execute("call-1", { dryRun: true }),
				).rejects.toThrow(/absolute path/);
			}
			await expect(readFile(marker, "utf8")).rejects.toThrow();
		} finally {
			restoreEnv("PI_OLLAMA_COMMAND", previousCommand);
			restoreEnv("PATH", previousPath);
			restoreEnv("ATTACKER_MARKER", previousMarker);
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses a trusted absolute Ollama fixture and ignores model-supplied command and path overrides", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-ollama-public-boundary-"));
		const trustedDir = join(root, "trusted");
		const attackerDir = join(root, "attacker");
		const trustedCommand = join(trustedDir, "ollama");
		const attackerCommand = join(attackerDir, "ollama");
		const trustedModelsPath = join(root, "trusted-models.json");
		const attackerModelsPath = join(root, "attacker-models.json");
		const attackerMarker = join(root, "attacker-command-ran");
		const previousCommand = process.env.PI_OLLAMA_COMMAND;
		const previousModelsPath = process.env.PI_OLLAMA_MODELS_PATH;
		const previousMarker = process.env.ATTACKER_MARKER;
		try {
			await Promise.all([
				writeExecutable(
					trustedCommand,
					[
						"#!/bin/sh",
						'if [ "$1" = "list" ]; then',
						"  printf 'NAME ID SIZE MODIFIED\\nfixture:latest abc 1 GB now\\n'",
						"else",
						"  printf 'architecture llama\\ncontext length 8192\\n'",
						"fi",
					].join("\n"),
				),
				writeExecutable(
					attackerCommand,
					[
						"#!/bin/sh",
						'touch "$ATTACKER_MARKER"',
						"printf 'NAME ID SIZE MODIFIED\\n'",
					].join("\n"),
				),
			]);
			process.env.PI_OLLAMA_COMMAND = trustedCommand;
			process.env.PI_OLLAMA_MODELS_PATH = trustedModelsPath;
			process.env.ATTACKER_MARKER = attackerMarker;
			let registeredTool: RegisteredOllamaTool | undefined;
			const api = {
				on() {},
				registerTool(tool: RegisteredOllamaTool) {
					registeredTool = tool;
				},
			};
			ollamaModelsExtension(api as unknown as ExtensionAPI);

			expect(Object.keys(registeredTool?.parameters.properties ?? {})).toEqual([
				"modelsPath",
				"ollamaCommand",
				"dryRun",
			]);
			expect(registeredTool?.parameters.properties?.modelsPath).toMatchObject({
				deprecated: true,
				description: expect.stringMatching(/ignored/i),
			});
			expect(
				registeredTool?.parameters.properties?.ollamaCommand,
			).toMatchObject({
				deprecated: true,
				description: expect.stringMatching(/ignored.*never executed/i),
			});
			expect(registeredTool?.parameters.additionalProperties).toBe(false);
			const result = await registeredTool?.execute("call-1", {
				dryRun: false,
				modelsPath: attackerModelsPath,
				ollamaCommand: attackerCommand,
			});

			expect(result?.details.modelsPath).toBe(trustedModelsPath);
			expect(
				JSON.parse(await readFile(trustedModelsPath, "utf8")),
			).toMatchObject({
				providers: { ollama: { models: [{ id: "fixture:latest" }] } },
			});
			await expect(readFile(attackerModelsPath, "utf8")).rejects.toThrow();
			await expect(readFile(attackerMarker, "utf8")).rejects.toThrow();
		} finally {
			restoreEnv("PI_OLLAMA_COMMAND", previousCommand);
			restoreEnv("PI_OLLAMA_MODELS_PATH", previousModelsPath);
			restoreEnv("ATTACKER_MARKER", previousMarker);
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, { encoding: "utf8", mode: 0o700 });
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}
