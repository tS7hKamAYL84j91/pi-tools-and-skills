/**
 * Machine Memory — file writing and skeleton generation.
 *
 * Handles creating .mmem.yml skeleton files, writing them to disk,
 * and appending update blocks to existing files.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

import type { CreateMemoryOptions } from "./types.js";
import { piGlobalDir, piProjectDir, memoryFilePath } from "./discover.js";

/** Generate a skeleton .mmem.yml for a tool. */
export function generateSkeleton(opts: CreateMemoryOptions): string {
	const date = new Date().toISOString().slice(0, 10);
	const tags = opts.tags?.length ? `[${opts.tags.join(", ")}]` : `[${opts.tool}, TODO]`;

	return `---
tool: ${opts.tool}
version: "${opts.version ?? ">=TODO"}"
updated: ${date}
category: ${opts.category ?? "TODO"}
tags: ${tags}
confidence: ${opts.confidence ?? "medium"}
---

# ${opts.tool} — TODO one-line purpose

> TODO: what it does in ≤20 words.

## Common operations

- TODO intent:
  \`${opts.tool} {{arg}}\`

- TODO intent:
  \`${opts.tool} {{arg}}\`

## Patterns

- TODO pattern:
  \`${opts.tool} {{arg}} | TODO\`

## Gotchas

- TODO gotcha

## Examples

- TODO example:
  \`${opts.tool} {{arg}}\`
`;
}

/** Write a .mmem.yml file to the target directory. */
export async function writeMemoryFile(
	cwd: string,
	opts: CreateMemoryOptions,
	content: string,
): Promise<string> {
	const dir = opts.target === "global" ? piGlobalDir() : piProjectDir(cwd);
	await mkdir(dir, { recursive: true });
	const path = memoryFilePath(dir, opts.tool);
	if (existsSync(path)) {
		throw new Error(`Memory file already exists: ${path}. Delete it first or use mmem_update.`);
	}
	await writeFile(path, content, "utf-8");
	return path;
}

/** Append an update block to an existing .mmem.yml file. */
export async function appendUpdate(
	path: string,
	sections: { gotchas?: string[]; patterns?: string[]; corrections?: string[] },
): Promise<void> {
	if (!existsSync(path)) throw new Error(`Memory file not found: ${path}`);

	const existing = await readFile(path, "utf-8");
	const date = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		"",
		`# ── Update ${date} ──────────────────────────────────────`,
		"# Review and integrate the suggestions below, then delete this block.",
	];

	if (sections.gotchas?.length) {
		lines.push("", "## New Gotchas (suggested)");
		for (const g of sections.gotchas) lines.push(`- ${g}`);
	}
	if (sections.patterns?.length) {
		lines.push("", "## New Patterns (suggested)");
		for (const p of sections.patterns) lines.push(`- ${p}`);
	}
	if (sections.corrections?.length) {
		lines.push("", "## Corrections (suggested)");
		for (const c of sections.corrections) lines.push(`- ${c}`);
	}

	await writeFile(path, `${existing.trimEnd()}\n${lines.join("\n")}\n`, "utf-8");
}