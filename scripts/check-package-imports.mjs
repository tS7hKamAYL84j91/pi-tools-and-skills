#!/usr/bin/env node
/** Resolve checkout package imports without executing lifecycle hooks or tools. */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SKIP = new Set(["node_modules", ".git", "dist", "dist-npm", "coverage"]);

function listFiles(dir, base = dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) listFiles(full, base, out);
		else out.push(relative(base, full).split(sep).join("/"));
	}
	return out;
}

/** Expand simple `*`/`**` manifest globs; a plain path passes through. */
function expandGlobs(packageDir, patterns) {
	const out = [];
	for (const pattern of patterns) {
		const normalized = pattern.replace(/^\.\//, "");
		if (!normalized.includes("*")) { out.push(normalized); continue; }
		const source = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "@@STAR@@").replace(/\*/g, "[^/]*").replace(/@@STAR@@/g, ".*");
		const regex = new RegExp(`^${source}$`);
		for (const file of listFiles(packageDir)) if (regex.test(file)) out.push(file);
	}
	return out;
}

function discoverExtensions(packageDir) {
	try {
		return readdirSync(join(packageDir, "extensions"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => `extensions/${entry.name}/index.ts`);
	} catch {
		return [];
	}
}

export function checkPackageImports(packageDir) {
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	const entrypoints = expandGlobs(packageDir, manifest.pi?.extensions ?? discoverExtensions(packageDir));
	const visited = new Set();
	const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true };
	function visit(file) {
		if (visited.has(file)) return;
		visited.add(file);
		const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
		function walk(node) {
			const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
				: ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
			if (specifier && ts.isStringLiteral(specifier)) {
				const name = specifier.text;
				if (!name.startsWith("node:")) {
					const target = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule;
					if (!target) throw new Error(`Unresolved import ${name} from ${file}`);
					if (name.startsWith(".")) visit(target.resolvedFileName);
				}
			}
			ts.forEachChild(node, walk);
		}
		walk(source);
	}
	for (const entry of entrypoints) visit(join(packageDir, entry));
	return visited.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const count = checkPackageImports(resolve(process.argv[2] ?? "."));
	console.log(`Package imports resolved: ${count} checkout modules (no runtime execution).`);
}
