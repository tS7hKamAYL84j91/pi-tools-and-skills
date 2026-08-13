/** CoAS workspace CONTEXT.md read, append, and compaction helpers. */

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { isoUtc } from "./store-paths.js";
import { resolveWorkspace } from "./workspace-paths.js";
import type { CoasConfig, WorkspaceReadOptions } from "./types.js";
import type { ConfinedStore } from "./store.js";

const SUMMARY_HEAD_BYTES = 12 * 1024;
const LARGE_CONTEXT_BYTES = 64 * 1024;
const FULL_READ_MAX_BYTES = 128 * 1024;
const ARCHIVE_THRESHOLD_BYTES = 64 * 1024;

function contextHeadings(text: string): string[] {
	return text.split("\n").filter((line) => /^#{1,3}\s+/.test(line)).slice(0, 40);
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
	const next = new RegExp(`^#{1,${level}}\\s+`, "im").exec(rest);
	return `${match[0]}\n${next ? rest.slice(0, next.index) : rest}`.trimEnd();
}

async function compactContextIfNeeded(
	store: ConfinedStore,
	path: string,
	stamp: string,
	latestUpdate: string,
): Promise<void> {
	const content = await store.readRequiredFile(path);
	if (Buffer.byteLength(content, "utf8") <= ARCHIVE_THRESHOLD_BYTES) return;
	const archiveDir = join(dirname(path), "archive");
	await store.ensurePrivateDir(archiveDir);
	const archivePath = join(archiveDir, `CONTEXT.${stamp.replace(/[:]/g, "")}.md`);
	await store.writePrivateFileAtomic(archivePath, content);
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
	await store.writePrivateFileAtomic(path, compact);
}

export async function readWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	options: WorkspaceReadOptions = {},
): Promise<{ path: string; text: string; mode: string; bytes: number }> {
	const workspace = await resolveWorkspace(config, selector, cwd);
	const path = join(workspace.path, "CONTEXT.md");
	const info = await workspace.store.fileStat(path);
	const mode = options.mode ?? "summary";
	if (mode === "full") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; full reads are limited to ${FULL_READ_MAX_BYTES} bytes. Use mode=summary or mode=section.`);
		}
		return { path, text: await workspace.store.readRequiredFile(path), mode, bytes: info.size };
	}
	if (mode === "section") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; section reads are limited to ${FULL_READ_MAX_BYTES} bytes until archived/compacted.`);
		}
		if (!options.section || options.section.trim().length === 0) throw new Error("section is required when mode=section");
		const section = readSection(await workspace.store.readRequiredFile(path), options.section.trim());
		if (!section) throw new Error(`Section not found in CONTEXT.md: ${options.section}`);
		if (Buffer.byteLength(section, "utf8") > FULL_READ_MAX_BYTES) throw new Error(`Section is too large to return safely; refine the heading: ${options.section}`);
		return { path, text: section, mode, bytes: info.size };
	}
	const preview = await workspace.store.readFilePrefix(path, SUMMARY_HEAD_BYTES);
	return {
		path,
		text: renderContextSummary(path, preview.size, preview.text, preview.size > Buffer.byteLength(preview.text, "utf8")),
		mode: "summary",
		bytes: preview.size,
	};
}

export async function appendWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	text: string,
): Promise<{ path: string; bytes: number }> {
	if (text.trim().length === 0) throw new Error("Context update text must not be empty");
	const workspace = await resolveWorkspace(config, selector, cwd);
	const path = join(workspace.path, "CONTEXT.md");
	await workspace.store.ensurePrivateDir(workspace.path);
	await withFileMutationQueue(path, async () => {
		const stamp = isoUtc();
		await workspace.store.appendPrivateLog(path, `\n\n## Update ${stamp}\n\n${text.trim()}\n`);
		await compactContextIfNeeded(workspace.store, path, stamp, text.trim());
	});
	return { path, bytes: (await workspace.store.fileStat(path)).size };
}
