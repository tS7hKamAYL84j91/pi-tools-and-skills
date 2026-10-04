#!/usr/bin/env node
/**
 * Build self-contained npm staging packages for the extensions and the umbrella.
 *
 * Extensions import shared code from ../../lib and, in one case, from a sibling
 * extension. Published packages must not reach outside their own tarball, so this
 * copies every escaping relative import into `vendor/<repo-relative-path>` inside a
 * staging directory and rewrites the import specifiers. Source files are never
 * mutated. Run `npm publish` from the staging directory (the release workflow does).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "dist-npm");
const EXCLUDED = /(^|[/\\])(node_modules|dist|coverage)([/\\]|$)|\.(test|spec)\.[cm]?ts$/;

function within(dir, file) {
	const rel = relative(dir, file);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

function copyTree(from, to) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const src = join(from, entry.name);
		if (EXCLUDED.test(src)) continue;
		const dest = join(to, entry.name);
		if (entry.isDirectory()) copyTree(src, dest);
		else if (entry.isFile()) cpSync(src, dest);
	}
}

function relativeSpecifiers(file) {
	const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
	const found = [];
	const visit = (node) => {
		let spec;
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) spec = node.moduleSpecifier;
		else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) spec = node.arguments[0];
		if (spec && ts.isStringLiteral(spec)) found.push({ text: spec.text, start: spec.getStart() + 1, end: spec.getEnd() - 1 });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

function resolveLocal(fromFile, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	const base = resolve(dirname(fromFile), specifier);
	const withoutJs = base.replace(/\.js$/, "");
	const candidates = [base, `${withoutJs}.ts`, `${withoutJs}.mts`, `${withoutJs}.tsx`, `${base}.ts`, join(base, "index.ts")];
	return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function listTs(dir, base = dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) listTs(full, base, out);
		else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
	}
	return out;
}

/** Build one self-contained staging package from an extension directory. */
export function buildExtensionPackage(extensionDir, outDir = join(OUT, packageName(extensionDir))) {
	const pkgDir = resolve(extensionDir);
	const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
	const staging = resolve(outDir);
	rmSync(staging, { recursive: true, force: true });
	copyTree(pkgDir, staging);

	const origin = new Map(); // staged path -> original path
	const seed = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) seed(full);
			else origin.set(full, join(pkgDir, relative(staging, full)));
		}
	};
	seed(staging);

	const queue = listTs(staging);
	const processed = new Set();
	const edits = new Map();
	while (queue.length > 0) {
		const stagedFile = queue.pop();
		if (processed.has(stagedFile)) continue;
		processed.add(stagedFile);
		const originalFile = origin.get(stagedFile) ?? stagedFile;
		for (const { text, start, end } of relativeSpecifiers(stagedFile)) {
			const target = resolveLocal(originalFile, text);
			if (!target) continue;
			const stagedTarget = within(pkgDir, target)
				? join(staging, relative(pkgDir, target))
				: join(staging, "vendor", relative(ROOT, target));
			if (!origin.has(stagedTarget)) {
				if (!within(pkgDir, target)) {
					mkdirSync(dirname(stagedTarget), { recursive: true });
					cpSync(target, stagedTarget);
				}
				origin.set(stagedTarget, target);
				if (stagedTarget.endsWith(".ts")) queue.push(stagedTarget);
			}
			if (within(pkgDir, target)) continue;
			const rel = relative(dirname(stagedFile), stagedTarget).split(sep).join("/").replace(/\.ts$/, ".js");
			edits.set(stagedFile, [...(edits.get(stagedFile) ?? []), { start, end, text: rel.startsWith(".") ? rel : `./${rel}` }]);
		}
	}

	for (const [file, replacements] of edits) {
		let content = readFileSync(file, "utf8");
		for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
			content = content.slice(0, start) + text + content.slice(end);
		}
		writeFileSync(file, content);
	}

	const license = join(ROOT, "LICENSE");
	if (existsSync(license) && !existsSync(join(staging, "LICENSE"))) cpSync(license, join(staging, "LICENSE"));
	const { scripts, devDependencies, ...published } = manifest;
	void scripts;
	void devDependencies;
	writeFileSync(join(staging, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
	return staging;
}

function packageName(extensionDir) {
	return JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")).name;
}

/** Build the umbrella package: it already ships the whole tree, so no vendoring. */
export function buildUmbrellaPackage(outDir = join(OUT, packageName(ROOT))) {
	const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	const staging = resolve(outDir);
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	for (const entry of manifest.files ?? []) {
		const src = join(ROOT, entry);
		if (existsSync(src)) cpSync(src, join(staging, entry), { recursive: true });
	}
	const { scripts, devDependencies, ...published } = manifest;
	void scripts;
	void devDependencies;
	writeFileSync(join(staging, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
	return staging;
}

export function extensionDirectories() {
	return readdirSync(join(ROOT, "extensions"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "extensions", entry.name, "package.json")))
		.map((entry) => join(ROOT, "extensions", entry.name));
}

function main(args) {
	const mode = args[0] ?? "--all";
	const targets = mode === "--umbrella"
		? [buildUmbrellaPackage()]
		: (mode === "--all" ? extensionDirectories() : [resolve(mode)]).map((dir) => buildExtensionPackage(dir));
	for (const staging of targets) console.log(staging);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2));
}
