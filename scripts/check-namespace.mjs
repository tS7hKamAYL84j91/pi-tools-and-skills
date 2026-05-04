#!/usr/bin/env node
/**
 * Audit pi-tools slash-command namespaces against pi built-ins.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const EXTENSIONS_DIR = join(ROOT, "extensions");
const PROMPTS_DIR = join(ROOT, "prompts");
const BUILTINS_PATH = join(SCRIPT_DIR, "builtins.json");
const COMMAND_REGEX = /\.registerCommand\(\s*["']([^"']+)["']/g;
const SEMANTIC_KEYWORDS = ["name", "alias", "identity", "session", "send", "agent", "team"];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(dir, predicate) {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(path, predicate));
		} else if (predicate(path)) {
			files.push(path);
		}
	}
	return files.sort();
}

function collectExtensionCommands() {
	return listFiles(EXTENSIONS_DIR, (path) => path.endsWith(".ts")).flatMap((path) => {
		const text = readFileSync(path, "utf8");
		const commands = [];
		for (const match of text.matchAll(COMMAND_REGEX)) {
			commands.push({
				name: match[1],
				source: relative(ROOT, path),
				type: "extension",
			});
		}
		return commands;
	});
}

function collectPromptCommands() {
	if (!statSync(PROMPTS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
		return [];
	}
	return listFiles(PROMPTS_DIR, (path) => extname(path) === ".md").map((path) => ({
		name: basename(path, ".md"),
		source: relative(ROOT, path),
		type: "prompt",
	}));
}

function findSemanticWarnings(commands) {
	return commands.flatMap((command) => {
		const matches = SEMANTIC_KEYWORDS.filter((keyword) => command.name.includes(keyword));
		return matches.map((keyword) => ({ ...command, keyword }));
	});
}

function printInventory(label, commands) {
	console.log(`${label}:`);
	for (const command of commands) {
		console.log(`  /${command.name} (${command.type}: ${command.source})`);
	}
}

const builtins = readJson(BUILTINS_PATH).commands;
const builtinSet = new Set(builtins);
const projectCommands = [...collectExtensionCommands(), ...collectPromptCommands()].sort((a, b) =>
	a.name.localeCompare(b.name) || a.source.localeCompare(b.source),
);
const collisions = projectCommands.filter((command) => builtinSet.has(command.name));
const warnings = findSemanticWarnings(projectCommands);

console.log(`Built-in pi commands (${builtins.length}): ${builtins.map((name) => `/${name}`).join(", ")}`);
printInventory("pi-tools slash commands", projectCommands);

if (warnings.length > 0) {
	console.log("\nSemantic-overlap warnings:");
	for (const warning of warnings) {
		console.log(`  /${warning.name} matches keyword "${warning.keyword}" (${warning.source})`);
	}
}

if (collisions.length > 0) {
	console.error("\nNamespace check failed: pi-tools commands collide with built-in pi commands.");
	for (const collision of collisions) {
		console.error(`  /${collision.name} (${collision.source})`);
	}
	process.exitCode = 1;
} else {
	console.log("\nNamespace check passed: no exact built-in slash-command collisions.");
}
