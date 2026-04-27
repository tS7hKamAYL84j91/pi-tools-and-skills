/**
 * Live-agent member runner — drops a tagged council prompt into another
 * pi agent's mailbox and polls our own inbox for the matching reply.
 *
 * Reply correlation: each request embeds a tag of the form
 *   <council-reply deliberation_id="..." stage="..." member="...">
 * Tag includes member label so duplicate `agent:<name>` refs can't collide.
 *
 * Inbox race: panopticon's drainAllChannels acks every message in our inbox
 * (moving new/ → cur/) on inbound watcher events. We therefore scan BOTH
 * subdirectories on every poll — a council reply that has already been
 * drained by another consumer is still recoverable from cur/.
 */

import { readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { sendAgentMessage } from "../../lib/agent-api.js";
import { REGISTRY_DIR } from "../../lib/agent-registry.js";

const POLL_INTERVAL_MS = 500;

interface AskAgentArgs {
	agentName: string;
	agentId: string;
	memberLabel: string;
	prompt: string;
	systemPrompt: string;
	deliberationId: string;
	stage: "generate" | "critique" | "synthesize" | "consult";
	ourAgentId: string;
	ourAgentName: string;
	signal?: AbortSignal;
	timeoutMs: number;
}

interface AskAgentResult {
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

interface InboxFileMessage {
	id?: string;
	from?: string;
	text?: string;
	ts?: number;
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function envelopeNames(stage: string): { request: string; reply: string } {
	if (stage === "consult") {
		return { request: "pair-request", reply: "pair-reply" };
	}
	return { request: "council-request", reply: "council-reply" };
}

function framingFor(stage: string): string {
	if (stage === "consult") {
		return [
			"You're the Navigator in a pair-coding consultation. The Pilot (a separate agent doing the actual coding) is asking you for a focused review or perspective.",
			"Read the question, answer it directly, and reply via agent_send as instructed below. This is a one-shot consultation — there is no follow-up turn unless the Pilot consults you again.",
		].join("\n");
	}
	return "You are participating as a council member in a multi-agent deliberation.";
}

function formatTag(args: { deliberationId: string; stage: string; memberLabel: string }): string {
	const { reply } = envelopeNames(args.stage);
	return `<${reply} deliberation_id="${args.deliberationId}" stage="${args.stage}" member="${args.memberLabel}">`;
}

function formatRequest(args: AskAgentArgs, tag: string): string {
	const { request } = envelopeNames(args.stage);
	return [
		`<${request} deliberation_id="${args.deliberationId}" stage="${args.stage}" member="${args.memberLabel}">`,
		framingFor(args.stage),
		`Timeout: ${Math.round(args.timeoutMs / 1000)}s — late replies are discarded.`,
		"",
		args.systemPrompt,
		"",
		"Question:",
		args.prompt,
		"",
		`When ready, reply via agent_send to "${args.ourAgentName}". Your reply MUST contain the exact line:`,
		tag,
		"Everything after that line is treated as your answer.",
		`</${request}>`,
	].join("\n");
}

/** Body is everything after the tag — no closing-tag dependency, so an answer that mentions XML cannot truncate itself. */
function extractAnswer(text: string, tag: string): string {
	const idx = text.indexOf(tag);
	if (idx < 0) return text.trim();
	return text.slice(idx + tag.length).trim();
}

interface FoundReply {
	text: string;
}

interface FindReplyArgs {
	ourAgentId: string;
	fromAgent: string;
	tag: string;
	signal?: AbortSignal;
	timeoutMs: number;
}

interface DirMatch {
	text: string;
	path: string;
}

function scanDir(dir: string, fromAgentLower: string, tag: string): DirMatch | null {
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return null;
	}
	for (const file of files) {
		const filePath = join(dir, file);
		try {
			const raw = readFileSync(filePath, "utf-8");
			const msg = JSON.parse(raw) as InboxFileMessage;
			if (msg.from?.toLowerCase() === fromAgentLower && typeof msg.text === "string" && msg.text.includes(tag)) {
				return { text: msg.text, path: filePath };
			}
		} catch { /* skip unreadable */ }
	}
	return null;
}

/**
 * Move a matched reply from inbox/new/ to inbox/cur/ so it doesn't surface
 * in the orchestrator's normal message_read once the council has consumed it.
 */
function ackInNew(match: DirMatch, curDir: string): void {
	try {
		renameSync(match.path, join(curDir, match.path.split("/").pop() ?? ""));
	} catch { /* already moved or removed */ }
}

async function findReply(args: FindReplyArgs): Promise<FoundReply | null> {
	const deadline = Date.now() + args.timeoutMs;
	const lower = args.fromAgent.toLowerCase();
	const newDir = join(REGISTRY_DIR, args.ourAgentId, "inbox", "new");
	const curDir = join(REGISTRY_DIR, args.ourAgentId, "inbox", "cur");
	while (!args.signal?.aborted && Date.now() < deadline) {
		const fromNew = scanDir(newDir, lower, args.tag);
		if (fromNew) {
			ackInNew(fromNew, curDir);
			return { text: fromNew.text };
		}
		const fromCur = scanDir(curDir, lower, args.tag);
		if (fromCur) return { text: fromCur.text };
		await sleep(POLL_INTERVAL_MS);
	}
	return null;
}

/** Send a council prompt to a live agent and await its tagged reply. */
export async function askAgent(args: AskAgentArgs): Promise<AskAgentResult> {
	const startedAt = Date.now();
	const tag = formatTag({
		deliberationId: args.deliberationId,
		stage: args.stage,
		memberLabel: args.memberLabel,
	});

	const accepted = await sendAgentMessage(
		args.agentId,
		args.ourAgentName,
		formatRequest(args, tag),
	);
	if (!accepted) {
		return {
			output: "",
			durationMs: Date.now() - startedAt,
			ok: false,
			error: `failed to deliver council request to "${args.agentName}"`,
		};
	}

	const reply = await findReply({
		ourAgentId: args.ourAgentId,
		fromAgent: args.agentName,
		tag,
		signal: args.signal,
		timeoutMs: args.timeoutMs,
	});

	if (!reply) {
		const reason = args.signal?.aborted
			? "cancelled"
			: `no reply within timeout — agent "${args.agentName}" must reply via agent_send to "${args.ourAgentName}" with the line ${tag} prefixing the answer`;
		return {
			output: "",
			durationMs: Date.now() - startedAt,
			ok: false,
			error: reason,
		};
	}

	return {
		output: extractAnswer(reply.text, tag),
		durationMs: Date.now() - startedAt,
		ok: true,
	};
}
