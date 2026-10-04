#!/usr/bin/env node
/** Resolve checkout package imports without executing lifecycle hooks or tools. */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export function checkPackageImports(packageDir) {
	const manifest = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
	const entrypoints = manifest.pi?.extensions ?? readdirSync(resolve(packageDir, "extensions"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `extensions/${entry.name}/index.ts`);
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
	for (const entry of entrypoints) visit(resolve(packageDir, entry));
	return visited.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const count = checkPackageImports(resolve(process.argv[2] ?? "."));
	console.log(`Package imports resolved: ${count} checkout modules (no runtime execution).`);
}
