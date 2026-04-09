/**
 * Machine Memory Extension — gradual-exposure agent cheat sheets.
 *
 * Discovers .mmem.yml files from settings.json paths, ~/.pi/agent/memories/,
 * and .pi/memories/. Injects a compact INDEX into the system prompt (just tool
 * names, tags, and descriptions). Full content is loaded on demand via mmem_inject.
 *
 * Tools:  mmem_create, mmem_list, mmem_inject, mmem_update, mmem_validate
 * Commands:  /mmem (overlay), /mmem-reload
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { existsSync } from "node:fs";

import type { MemoryFile } from "./types.js";
import { discoverMemories, getMemoryDirs } from "./discover.js";
import { validateMemory } from "./validate.js";
import { formatForInjection, formatIndex, estimateTokens } from "./format.js";
import { generateSkeleton, writeMemoryFile, appendUpdate } from "./write.js";
import { MemoryOverlay } from "./overlay.js";

// ── Extension state ─────────────────────────────────────────────

let loadedMemories = new Map<string, MemoryFile>();
let indexText = "";
let ctx: ExtensionContext | null = null;

function updateStatus(): void {
	if (!ctx) return;
	const count = loadedMemories.size;
	if (count === 0) {
		ctx.ui.setStatus("mmem", "🧠 0 memories");
	} else {
		ctx.ui.setStatus("mmem", `🧠 ${count} memories (~${estimateTokens(indexText)} tok index)`);
	}
	ctx.ui.setWidget("mmem", undefined);
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	async function loadMemories(cwd: string): Promise<void> {
		loadedMemories = await discoverMemories(cwd);
		indexText = formatIndex([...loadedMemories.values()]);
		updateStatus();
	}

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		await loadMemories(c.cwd);
	});

	pi.on("session_shutdown", async () => {
		ctx = null;
		loadedMemories.clear();
		indexText = "";
	});

	pi.on("before_agent_start", async (event) => {
		if (!indexText) return;
		return { systemPrompt: event.systemPrompt + "\n\n" + indexText };
	});

	// ── Commands ────────────────────────────────────────────────

	pi.registerCommand("mmem", {
		description: "Show loaded machine memories (overlay)",
		handler: async (_args, c) => {
			const tokens = estimateTokens(indexText);
			await c.ui.custom<null>(
				(tui, theme, _kb, done) => new MemoryOverlay(tui, theme, loadedMemories, tokens, done),
				{ overlay: true, overlayOptions: { anchor: "top-center", width: "80%", margin: { top: 2 } } },
			);
		},
	});

	pi.registerCommand("mmem-reload", {
		description: "Re-scan and reload machine memory files",
		handler: async (_args, c) => {
			await loadMemories(c.cwd);
			const count = loadedMemories.size;
			c.ui.notify(count > 0 ? `Reloaded ${count} memory files` : "No .mmem.yml files found", "info");
		},
	});

	// ── Tool: mmem_create ──────────────────────────────────────

	pi.registerTool({
		name: "mmem_create",
		label: "Machine Memory Create",
		description:
			"Create a new .mmem.yml memory file for a tool or domain. " +
			"Writes a skeleton with YAML frontmatter and placeholder sections. " +
			"Optionally provide content to write a complete memory file instead of a skeleton.",
		promptSnippet: "Create a new .mmem.yml machine memory file for a tool or domain",
		parameters: Type.Object({
			tool: Type.String({ description: "Tool or domain name (kebab-case, e.g. 'git', 'docker', 'python-debug')" }),
			target: Type.Optional(Type.String({
				description: 'Where to create: "project" (.pi/memories/) or "global" (~/.pi/agent/memories/). Default: project',
				enum: ["project", "global"],
			})),
			version: Type.Optional(Type.String({ description: 'Minimum version (e.g. ">=2.30" or "any")' })),
			category: Type.Optional(Type.String({ description: 'Category (e.g. "version-control", "containers", "language")' })),
			tags: Type.Optional(Type.String({ description: 'Comma-separated tags for retrieval (e.g. "git,commits,branches")' })),
			content: Type.Optional(Type.String({ description: "Full .mmem.yml content to write instead of a skeleton. Must include YAML frontmatter and body." })),
		}),
		async execute(_id, params, _signal, _onUpdate, execCtx): Promise<ToolResult> {
			const tags = params.tags?.split(",").map((t: string) => t.trim()).filter(Boolean);
			const target = (params.target ?? "project") as "project" | "global";
			const cwd = execCtx?.cwd ?? process.cwd();

			let content: string;
			if (params.content) {
				const validation = validateMemory(params.content, params.tool);
				if (!validation.valid) throw new Error(`Invalid content:\n${validation.errors.join("\n")}`);
				content = params.content;
			} else {
				content = generateSkeleton({ tool: params.tool, version: params.version, category: params.category, tags, target });
			}

			const path = await writeMemoryFile(cwd, { tool: params.tool, target }, content);
			await loadMemories(cwd);
			return ok(
				`Created ${path}\n${params.content ? "Wrote complete memory file." : "Wrote skeleton — fill in TODO sections."}`,
				{ tool: params.tool, path, target, skeleton: !params.content },
			);
		},
	});

	// ── Tool: mmem_list ────────────────────────────────────────

	pi.registerTool({
		name: "mmem_list",
		label: "Machine Memory List",
		description:
			"List all discovered machine memory files with metadata. " +
			"Shows tool name, category, confidence, source (project/global), token count, and validation status.",
		promptSnippet: "List all machine memory files with their metadata",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, execCtx): Promise<ToolResult> {
			const cwd = execCtx?.cwd ?? process.cwd();
			if (loadedMemories.size === 0) {
				const dirs = getMemoryDirs(cwd);
				const searched = dirs.map((d) => `  ${d.exists ? "✓" : "✗"} ${d.dir} (${d.source})`).join("\n");
				return ok("No .mmem.yml files found.\nSearched:\n" + searched + "\n\nCreate one with mmem_create.", { count: 0 });
			}

			const files: Record<string, unknown>[] = [];
			const lines: string[] = [`Found ${loadedMemories.size} memory file(s):\n`];
			for (const mem of loadedMemories.values()) {
				const tokens = estimateTokens(mem.raw);
				const v = validateMemory(mem.raw, mem.name);
				lines.push(`${v.valid ? "✅" : "❌"} ${mem.name} — ${mem.meta.category} — ${mem.meta.confidence} — ${tokens} tok — ${mem.source}${v.warnings.length ? ` (${v.warnings.length} warning(s))` : ""}`);
				files.push({ name: mem.name, path: mem.path, category: mem.meta.category, confidence: mem.meta.confidence, tokens, source: mem.source, valid: v.valid, errors: v.errors, warnings: v.warnings });
			}
			return ok(lines.join("\n"), { count: loadedMemories.size, files });
		},
	});

	// ── Tool: mmem_inject ──────────────────────────────────────

	pi.registerTool({
		name: "mmem_inject",
		label: "Machine Memory Inject",
		description:
			"Inject specific machine memory files into context on demand. " +
			"Use when you encounter an unfamiliar tool mid-session and need its cheat sheet. Returns the formatted memory content.",
		promptSnippet: "Inject specific machine memory files into the current context",
		parameters: Type.Object({
			tools: Type.String({ description: 'Comma-separated tool names to inject (e.g. "git,docker")' }),
		}),
		async execute(_id, params, _signal, _onUpdate): Promise<ToolResult> {
			const requested = params.tools.split(",").map((t: string) => t.trim()).filter(Boolean);
			const found: MemoryFile[] = [];
			const notFound: string[] = [];
			for (const name of requested) {
				const mem = loadedMemories.get(name);
				if (mem) found.push(mem); else notFound.push(name);
			}
			if (found.length === 0) {
				return ok(`No memory files found for: ${requested.join(", ")}.\nAvailable: ${[...loadedMemories.keys()].join(", ") || "(none)"}`, { found: [], notFound: requested });
			}
			const injected = formatForInjection(found);
			const tokens = estimateTokens(injected);
			const nfMsg = notFound.length > 0 ? `\nNot found: ${notFound.join(", ")}` : "";
			return ok(`Injected ${found.length} memory file(s) (~${tokens} tokens):${nfMsg}\n\n${injected}`, { injected: found.map((m) => m.name), notFound, tokens });
		},
	});

	// ── Tool: mmem_update ──────────────────────────────────────

	pi.registerTool({
		name: "mmem_update",
		label: "Machine Memory Update",
		description:
			"Append learned gotchas, patterns, or corrections to an existing .mmem.yml file. " +
			"Use after discovering something new about a tool — capture it so future sessions benefit.",
		promptSnippet: "Append learned gotchas/patterns to an existing machine memory file",
		parameters: Type.Object({
			tool: Type.String({ description: "Tool name to update (must have an existing .mmem.yml)" }),
			gotchas: Type.Optional(Type.String({ description: 'New gotchas, pipe-separated (e.g. "gotcha 1|gotcha 2")' })),
			patterns: Type.Optional(Type.String({ description: 'New patterns, pipe-separated (e.g. "pattern 1|pattern 2")' })),
			corrections: Type.Optional(Type.String({ description: 'Corrections to existing entries, pipe-separated' })),
		}),
		async execute(_id, params, _signal, _onUpdate, execCtx): Promise<ToolResult> {
			const cwd = execCtx?.cwd ?? process.cwd();
			const mem = loadedMemories.get(params.tool);
			if (!mem) return ok(`No memory file found for '${params.tool}'.\nAvailable: ${[...loadedMemories.keys()].join(", ") || "(none)"}`, { tool: params.tool, updated: false });

			const split = (s?: string) => s?.split("|").map((x) => x.trim()).filter(Boolean) ?? [];
			const gotchas = split(params.gotchas);
			const patterns = split(params.patterns);
			const corrections = split(params.corrections);
			if (gotchas.length + patterns.length + corrections.length === 0) throw new Error("At least one of gotchas, patterns, or corrections must be provided");

			await appendUpdate(mem.path, { gotchas, patterns, corrections });
			await loadMemories(cwd);
			return ok(`Updated ${mem.path} with ${gotchas.length + patterns.length + corrections.length} suggestion(s).`, { tool: params.tool, path: mem.path, updated: true });
		},
	});

	// ── Tool: mmem_validate ────────────────────────────────────

	pi.registerTool({
		name: "mmem_validate",
		label: "Machine Memory Validate",
		description:
			"Validate a .mmem.yml file against the format specification. " +
			"Checks: YAML frontmatter fields, required sections, backtick commands, token budget, date format, confidence values, and staleness.",
		promptSnippet: "Validate a .mmem.yml file against the machine memory format spec",
		parameters: Type.Object({
			tool: Type.Optional(Type.String({ description: "Tool name to validate (looks up in discovered memories)" })),
			path: Type.Optional(Type.String({ description: "Direct path to a .mmem.yml file to validate" })),
		}),
		async execute(_id, params, _signal, _onUpdate): Promise<ToolResult> {
			let raw: string, name: string, filePath: string;

			if (params.path) {
				filePath = params.path;
				if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
				const { readFile } = await import("node:fs/promises");
				raw = await readFile(filePath, "utf-8");
				name = filePath;
			} else if (params.tool) {
				const mem = loadedMemories.get(params.tool);
				if (!mem) throw new Error(`No memory file found for '${params.tool}'`);
				raw = mem.raw;
				name = mem.name;
				filePath = mem.path;
			} else {
				throw new Error("Provide either 'tool' name or 'path' to validate");
			}

			const result = validateMemory(raw, name);
			const tokens = estimateTokens(raw);
			const lines: string[] = [result.valid ? `✅ ${name} is valid` : `❌ ${name} has ${result.errors.length} error(s)`, `   Path: ${filePath}`, `   Tokens: ~${tokens}`];
			if (result.errors.length > 0) { lines.push("", "Errors:"); for (const e of result.errors) lines.push(`  ❌ ${e}`); }
			if (result.warnings.length > 0) { lines.push("", "Warnings:"); for (const w of result.warnings) lines.push(`  ⚠️  ${w}`); }
			return ok(lines.join("\n"), { valid: result.valid, errors: result.errors, warnings: result.warnings, tokens, path: filePath });
		},
	});
}
