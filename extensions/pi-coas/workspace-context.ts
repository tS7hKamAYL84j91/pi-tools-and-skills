/**
 * CoAS workspace CONTEXT.md read, append, and compaction helpers.
 */

import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { appendLogLine, writeFileAtomic } from "../../lib/file-persistence.js";
import { ensurePrivateDir, isoUtc } from "./store.js";
import {
	assertNotSymlink,
	assertSafeWorkspaceDir,
	resolveWorkspacePath,
} from "./workspace-paths.js";
import type { CoasConfig, WorkspaceReadOptions } from "./types.js";

const SUMMARY_HEAD_BYTES = 12 * 1024;
const LARGE_CONTEXT_BYTES = 64 * 1024;
const FULL_READ_MAX_BYTES = 128 * 1024;
const ARCHIVE_THRESHOLD_BYTES = 64 * 1024;

function contextHeadings(text: string): string[] {
	return text.split("\n")
		.filter((line) => /^#{1,3}\s+/.test(line))
		.slice(0, 40);
}

function renderContextSummary(path: string, size: number, text: string, truncated: boolean): string {
	const headings = contextHeadings(text);
	const lines = [
		`CONTEXT.md: ${path}`,
		`Size: ${size} bytes${size > LARGE_CONTEXT_BYTES ? " (large; full read guarded)" : ""}`,
		"",
		"Headings:",
		...(headings.length > 0 ? headings.map((heading) => `- ${heading}`) : ["- (none in sampled content)"]),
		"",
		"Preview:",
		text.slice(0, SUMMARY_HEAD_BYTES).trimEnd(),
	];
	if (truncated) lines.push("", "Preview truncated. Use mode=section with a heading, or mode=full only for small context files.");
	return lines.join("\n");
}

function readSection(text: string, section: string): string | undefined {
	const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const startPattern = new RegExp(`^(#{1,6})\\s+.*${escaped}.*$`, "im");
	const match = startPattern.exec(text);
	if (!match || match.index === undefined) return undefined;
	const level = match[1]?.length ?? 1;
	const rest = text.slice(match.index + match[0].length + 1);
	const nextPattern = new RegExp(`^#{1,${level}}\\s+`, "im");
	const next = nextPattern.exec(rest);
	return `${match[0]}\n${next ? rest.slice(0, next.index) : rest}`.trimEnd();
}

interface CompactContextOptions {
	config: CoasConfig;
	dir: string;
	path: string;
	stamp: string;
	latestUpdate: string;
}

async function compactContextIfNeeded(options: CompactContextOptions): Promise<void> {
	const { config, dir, path, stamp, latestUpdate } = options;
	const info = await stat(path);
	if (info.size <= ARCHIVE_THRESHOLD_BYTES) return;
	const archiveDir = join(dir, "archive");
	await ensurePrivateDir(config, archiveDir);
	const archivePath = join(archiveDir, `CONTEXT.${stamp.replace(/[:]/g, "")}.md`);
	await writeFileAtomic(archivePath, await readFile(path, "utf8"), { encoding: "utf8", mode: 0o600 });
	await chmod(archivePath, 0o600).catch(() => undefined);
	const compact = [
		"# CoAS Workspace Context (SPR)",
		"",
		`- Compacted: ${stamp}`,
		`- Archived detailed history: ${archivePath}`,
		"- Policy: keep active CONTEXT.md small; store stable, non-secret memory only.",
		"",
		"## Stable Memory",
		"",
		latestUpdate,
		"",
		"## Archive Index",
		"",
		`- ${stamp}: ${archivePath}`,
		"",
	].join("\n");
	await writeFileAtomic(path, compact, { encoding: "utf8", mode: 0o600 });
}

export async function readWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	options: WorkspaceReadOptions = {},
): Promise<{ path: string; text: string; mode: string; bytes: number }> {
	const dir = resolveWorkspacePath(config, selector, cwd);
	const path = join(dir, "CONTEXT.md");
	await assertSafeWorkspaceDir(config, dir);
	await assertNotSymlink(path);
	const info = await stat(path);
	const mode = options.mode ?? "summary";
	if (mode === "full") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; full reads are limited to ${FULL_READ_MAX_BYTES} bytes. Use mode=summary or mode=section.`);
		}
		return { path, text: await readFile(path, "utf8"), mode, bytes: info.size };
	}
	if (mode === "section") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; section reads are limited to ${FULL_READ_MAX_BYTES} bytes until archived/compacted.`);
		}
		if (!options.section || options.section.trim().length === 0) throw new Error("section is required when mode=section");
		const text = await readFile(path, "utf8");
		const section = readSection(text, options.section.trim());
		if (!section) throw new Error(`Section not found in CONTEXT.md: ${options.section}`);
		if (Buffer.byteLength(section, "utf8") > FULL_READ_MAX_BYTES) throw new Error(`Section is too large to return safely; refine the heading: ${options.section}`);
		return { path, text: section, mode, bytes: info.size };
	}
	const handle = await open(path, "r");
	try {
		const length = Math.min(info.size, SUMMARY_HEAD_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, 0);
		const preview = buffer.toString("utf8");
		return { path, text: renderContextSummary(path, info.size, preview, info.size > length), mode: "summary", bytes: info.size };
	} finally {
		await handle.close();
	}
}

export async function appendWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	text: string,
): Promise<{ path: string; bytes: number }> {
	if (text.trim().length === 0) throw new Error("Context update text must not be empty");
	const dir = resolveWorkspacePath(config, selector, cwd);
	const path = join(dir, "CONTEXT.md");
	await assertSafeWorkspaceDir(config, dir);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await assertNotSymlink(path);
	await withFileMutationQueue(path, async () => {
		const stamp = isoUtc();
		await appendLogLine(path, `\n\n## Update ${stamp}\n\n${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
		await compactContextIfNeeded({ config, dir, path, stamp, latestUpdate: text.trim() });
		await chmod(path, 0o600).catch(() => undefined);
	});
	const info = await stat(path);
	return { path, bytes: info.size };
}
