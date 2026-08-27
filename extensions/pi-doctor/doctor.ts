/**
 * Read-only pi-tools extension diagnostics.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { join, relative } from "node:path";
import { advisoriesForDependencies, isKnownAdvisoryId } from "./advisories.js";

type DoctorSeverity = "ok" | "warning" | "error";

interface DoctorFinding {
	severity: DoctorSeverity;
	check: string;
	message: string;
	path?: string;
}

interface DoctorReport {
	ok: boolean;
	findings: DoctorFinding[];
	summary: {
		ok: number;
		warnings: number;
		errors: number;
	};
}

interface PackageJson {
	name?: unknown;
	type?: unknown;
	main?: unknown;
	pi?: {
		extensions?: unknown;
	};
}

const EXTENSIONS = ["pi-bionic", "pi-coas", "pi-doctor", "pi-goal", "pi-file-watch", "pi-kanban", "pi-matrix", "pi-ollama-models", "pi-panopticon"];
const REQUIRED_ROOT_SCRIPTS = ["check:namespace", "typecheck", "lint", "knip", "type-coverage", "check", "test"];
const RESERVED_COMMANDS = new Set(["settings", "model", "scoped-models", "export", "import", "share", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "tree", "login", "logout", "new", "compact", "resume", "reload", "quit"]);
const COMMAND_PATTERN = /\.registerCommand\(\s*["']([^"']+)["']/g;
const TOOL_PATTERN = /\.registerTool\(\s*\{[\s\S]*?\bname:\s*["']([^"']+)["']/g;

function listTsFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listTsFiles(path));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(path);
		}
	}
	return files;
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function packageJson(path: string): PackageJson {
	const value = readJson(path);
	return typeof value === "object" && value !== null ? value as PackageJson : {};
}

function finding(severity: DoctorSeverity, check: string, message: string, path?: string): DoctorFinding {
	return { severity, check, message, ...(path ? { path } : {}) };
}

const ACK_FILE = join(".pi", "doctor-advisory-acks.json");

export async function readDismissedAdvisories(cwd: string): Promise<Set<string>> {
	if (!existsSync(ackPath(cwd))) return new Set();
	try {
		const parsed: unknown = readJson(ackPath(cwd));
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((id): id is string => typeof id === "string" && isKnownAdvisoryId(id)));
	} catch {
		return new Set();
	}
}

function ackPath(cwd: string): string {
	return join(cwd, ACK_FILE);
}

/** Records an advisory dismissal. Unknown ids are rejected so typos never mask future advisories. */
export async function dismissAdvisory(cwd: string, id: string): Promise<void> {
	if (!isKnownAdvisoryId(id)) throw new Error(`Unknown advisory id: ${id}`);
	const dismissed = await readDismissedAdvisories(cwd);
	dismissed.add(id);
	await writeFileAtomic(ackPath(cwd), `${JSON.stringify([...dismissed], null, 2)}\n`);
}

function checkSupplyChainAdvisories(cwd: string, dismissed: ReadonlySet<string>): DoctorFinding[] {
	const findings: DoctorFinding[] = [];
	for (const manifestPath of [join(cwd, "package.json"), ...EXTENSIONS.map((name) => join(cwd, "extensions", name, "package.json"))]) {
		if (!existsSync(manifestPath)) continue;
		try {
			const pkg = readJson(manifestPath) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
			const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
			for (const advisory of advisoriesForDependencies(dependencies, dismissed)) {
				findings.push(finding("warning", "supply-chain", `Advisory ${advisory.id}: ${advisory.packageName} matches a known-compromised release. ${advisory.summary} Advisory only: no changes were made.`, relative(cwd, manifestPath)));
			}
		} catch {
			// Manifest readability is already reported by the package checks.
		}
	}
	return findings;
}

function checkExtensionPackage(cwd: string, name: string): DoctorFinding[] {
	const dir = join(cwd, "extensions", name);
	const pkgPath = join(dir, "package.json");
	const indexPath = join(dir, "index.ts");
	const findings: DoctorFinding[] = [];
	if (!existsSync(pkgPath)) {
		return [finding("error", "extension-package", `Missing package manifest for ${name}.`, relative(cwd, pkgPath))];
	}
	try {
		const pkg = packageJson(pkgPath);
		if (pkg.name !== name) findings.push(finding("error", "extension-package", `${name} manifest name must be ${name}.`, relative(cwd, pkgPath)));
		if (pkg.type !== "module") findings.push(finding("warning", "extension-package", `${name} should declare type=module.`, relative(cwd, pkgPath)));
		if (pkg.main !== "index.ts") findings.push(finding("warning", "extension-package", `${name} should use index.ts as main.`, relative(cwd, pkgPath)));
		if (!Array.isArray(pkg.pi?.extensions) || !pkg.pi.extensions.includes("./index.ts")) findings.push(finding("warning", "extension-package", `${name} should expose ./index.ts in pi.extensions.`, relative(cwd, pkgPath)));
	} catch (error) {
		findings.push(finding("error", "extension-package", `${name} package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, relative(cwd, pkgPath)));
	}
	if (!existsSync(indexPath)) findings.push(finding("error", "extension-entrypoint", `${name} is missing index.ts.`, relative(cwd, indexPath)));
	return findings.length > 0 ? findings : [finding("ok", "extension-package", `${name} manifest and entrypoint are present.`, relative(cwd, pkgPath))];
}

function checkRootPackage(cwd: string): DoctorFinding[] {
	const pkgPath = join(cwd, "package.json");
	try {
		const pkg = readJson(pkgPath) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
		const scripts = pkg.scripts ?? {};
		const findings = REQUIRED_ROOT_SCRIPTS.filter((script) => typeof scripts[script] !== "string").map((script) => finding("error", "root-scripts", `Missing npm script: ${script}.`, relative(cwd, pkgPath)));
		const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
		for (const dep of ["@earendil-works/pi-coding-agent", "@sinclair/typebox", "typescript", "vitest"]) {
			if (typeof deps[dep] !== "string") findings.push(finding("error", "dependencies", `Missing dependency: ${dep}.`, relative(cwd, pkgPath)));
		}
		return findings.length > 0 ? findings : [finding("ok", "root-scripts", "Required root scripts and dependencies are declared.", relative(cwd, pkgPath))];
	} catch (error) {
		return [finding("error", "root-package", `Root package.json is not readable JSON: ${error instanceof Error ? error.message : String(error)}`, relative(cwd, pkgPath))];
	}
}

function collectNamespaceFindings(cwd: string): DoctorFinding[] {
	const findings: DoctorFinding[] = [];
	const seenCommands = new Map<string, string>();
	const seenTools = new Map<string, string>();
	for (const name of EXTENSIONS) {
		const extDir = join(cwd, "extensions", name);
		if (!existsSync(extDir)) continue;
		for (const filePath of listTsFiles(extDir)) {
			const text = readFileSync(filePath, "utf8");
			const path = relative(cwd, filePath);
			for (const match of text.matchAll(COMMAND_PATTERN)) {
				const command = match[1] ?? "";
				if (RESERVED_COMMANDS.has(command)) findings.push(finding("error", "command-namespace", `/${command} collides with a built-in pi command.`, path));
				const previous = seenCommands.get(command);
				if (previous) findings.push(finding("error", "command-namespace", `/${command} is registered by both ${previous} and ${path}.`, path));
				seenCommands.set(command, path);
			}
			for (const match of text.matchAll(TOOL_PATTERN)) {
				const tool = match[1] ?? "";
				const previous = seenTools.get(tool);
				if (previous) findings.push(finding("error", "tool-namespace", `${tool} tool is registered by both ${previous} and ${path}.`, path));
				seenTools.set(tool, path);
			}
		}
	}
	return findings.length > 0 ? findings : [finding("ok", "namespace", `No duplicate or reserved slash commands found across ${seenCommands.size} commands; no duplicate tool names found across ${seenTools.size} tools.`)];
}

export async function runDoctor(cwd: string, dismissed: ReadonlySet<string> = new Set()): Promise<DoctorReport> {
	const findings = [
		...checkRootPackage(cwd),
		...EXTENSIONS.flatMap((name) => checkExtensionPackage(cwd, name)),
		...collectNamespaceFindings(cwd),
		...checkSupplyChainAdvisories(cwd, dismissed),
	];
	const summary = {
		ok: findings.filter((item) => item.severity === "ok").length,
		warnings: findings.filter((item) => item.severity === "warning").length,
		errors: findings.filter((item) => item.severity === "error").length,
	};
	return { ok: summary.errors === 0, findings, summary };
}

export function formatDoctorReport(report: DoctorReport): string {
	const status = report.ok ? "PASS" : "FAIL";
	const lines = [`pi-doctor ${status}: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.ok} ok`];
	for (const item of report.findings) {
		const path = item.path ? ` (${item.path})` : "";
		lines.push(`- ${item.severity.toUpperCase()} ${item.check}: ${item.message}${path}`);
	}
	return lines.join("\n");
}
