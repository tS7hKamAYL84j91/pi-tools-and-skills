import { describe, expect, it } from "vitest";
import { mergeOllamaModelsConfig, modelFromOllamaShow, modelIdsChanged, parseOllamaList } from "../extensions/pi-ollama-models/index.js";

describe("pi ollama models extension helpers", () => {
	it("parses ollama list output", () => {
		expect(parseOllamaList("NAME ID SIZE MODIFIED\nqwen3:8b abc 5 GB now\ngemma4:26b def 16 GB now\n")).toEqual(["qwen3:8b", "gemma4:26b"]);
	});

	it("converts ollama show output to pi model config", () => {
		const model = modelFromOllamaShow("qwen3-think:8b", "architecture qwen3\ncontext length 40960\nparameters reasoning vision");

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
		const config = mergeOllamaModelsConfig({ providers: { openrouter: { apiKey: "cmd" }, ollama: { baseUrl: "custom", models: [] } } }, [model]);

		expect(config.providers?.openrouter).toEqual({ apiKey: "cmd" });
		expect(config.providers?.ollama?.baseUrl).toBe("custom");
		expect(config.providers?.ollama?.models).toEqual([model]);
	});

	it("detects model inventory changes for startup UX", () => {
		const model = modelFromOllamaShow("gemma4:26b", "");
		const existing = mergeOllamaModelsConfig({}, [model]);

		expect(modelIdsChanged(existing, [model])).toBe(false);
		expect(modelIdsChanged(existing, [modelFromOllamaShow("qwen3:8b", "")])).toBe(true);
		expect(modelIdsChanged({}, [model])).toBe(true);
	});
});
