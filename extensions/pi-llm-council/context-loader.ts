/**
 * Pair-coding context loader.
 *
 * Discovers the project root by walking up from the current working
 * directory looking for `package.json` or a `.git` dir. From there it
 * loads (in order):
 *   1. project instructions from AGENTS.md (if present)
 *   2. the spec at `specPath`, or `spec.md` / `docs/spec.md` as fallback
 *   3. each path in `files[]`
 *
 * Binary files, obvious secret files, and over-sized files are skipped
 * with a warning rather than a hard error. Every loaded path is reported
 * back so the caller can echo it in the result.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const MAX_BYTES_PER_FILE = 200_000;
const SECRET_PATTERNS = [
	/(^|\/)\.env(\.|$)/,
	/credentials/i,
	/secret/i,
	/id_[rd]sa(\.|$)/,
	/\.pem$/,
	/\.key$/,
];

export interface LoadedEntry {
	path: string;
	bytes: number;
	kind: "instructions" | "spec" | "file";
	truncated?: boolean;
}

export interface LoadedFile {
	path: string;
	content: string;
}

export interface PairContext {
	projectRoot: string;
	instructions?: string;
	spec?: string;
	files: LoadedFile[];
	loaded: LoadedEntry[];
	warnings: string[];
}

/** Walk upward from `start` looking for a project root marker. */
function findProjectRoot(start: string): string {
	let dir = start;
	let parent = dirname(dir);
	while (dir !== parent) {
		if (existsSync(join(dir, "package.json"))) return dir;
		if (existsSync(join(dir, ".git"))) return dir;
		dir = parent;
		parent = dirname(dir);
	}
	return start;
}

function looksLikeSecret(path: string): boolean {
	return SECRET_PATTERNS.some((p) => p.test(path));
}

function isBinary(buf: Buffer): boolean {
	const slice = buf.subarray(0, Math.min(buf.length, 8192));
	return slice.indexOf(0) !== -1;
}

interface ReadResult {
	content: string;
	bytes: number;
	truncated: boolean;
}

function readTextFile(path: string, warnings: string[]): ReadResult | undefined {
	if (looksLikeSecret(path)) {
		warnings.push(`Skipped likely-secret file: ${path}`);
		return undefined;
	}
	let buf: Buffer;
	try {
		buf = readFileSync(path);
	} catch (err) {
		warnings.push(`Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
	if (isBinary(buf)) {
		warnings.push(`Skipped binary file: ${path}`);
		return undefined;
	}
	const truncated = buf.length > MAX_BYTES_PER_FILE;
	const content = truncated
		? buf.subarray(0, MAX_BYTES_PER_FILE).toString("utf-8")
		: buf.toString("utf-8");
	if (truncated) warnings.push(`Truncated ${path} to ${MAX_BYTES_PER_FILE} bytes`);
	return { content, bytes: buf.length, truncated };
}

interface LoadArgs {
	cwd: string;
	specPath?: string;
	files?: string[];
}

/** Build a PairContext for a /ask_council PAIR invocation. */
export function loadPairContext(args: LoadArgs): PairContext {
	const projectRoot = findProjectRoot(args.cwd);
	const warnings: string[] = [];
	const loaded: LoadedEntry[] = [];

	// 1. Instructions
	const instructionsPath = join(projectRoot, "AGENTS.md");
	let instructions: string | undefined;
	if (existsSync(instructionsPath)) {
		const r = readTextFile(instructionsPath, warnings);
		if (r) {
			instructions = r.content;
			loaded.push({ path: instructionsPath, bytes: r.bytes, kind: "instructions", truncated: r.truncated });
		}
	}

	// 2. Spec
	const specCandidates = args.specPath
		? [resolvePath(args.specPath, projectRoot, args.cwd)]
		: [join(projectRoot, "spec.md"), join(projectRoot, "docs", "spec.md")];
	let spec: string | undefined;
	for (const candidate of specCandidates) {
		if (!existsSync(candidate)) continue;
		const r = readTextFile(candidate, warnings);
		if (r) {
			spec = r.content;
			loaded.push({ path: candidate, bytes: r.bytes, kind: "spec", truncated: r.truncated });
			break;
		}
	}
	if (!spec) {
		warnings.push(
			args.specPath
				? `Spec at ${args.specPath} not found (continuing without)`
				: "No spec.md or docs/spec.md found (continuing without)",
		);
	}

	// 3. Files
	const files: LoadedFile[] = [];
	for (const ref of args.files ?? []) {
		const abs = resolvePath(ref, projectRoot, args.cwd);
		if (!existsSync(abs)) {
			warnings.push(`File not found: ${ref}`);
			continue;
		}
		const r = readTextFile(abs, warnings);
		if (!r) continue;
		files.push({ path: abs, content: r.content });
		loaded.push({ path: abs, bytes: r.bytes, kind: "file", truncated: r.truncated });
	}

	return { projectRoot, instructions, spec, files, loaded, warnings };
}

function resolvePath(ref: string, projectRoot: string, cwd: string): string {
	if (isAbsolute(ref)) return ref;
	const fromCwd = join(cwd, ref);
	if (existsSync(fromCwd)) return fromCwd;
	return join(projectRoot, ref);
}
