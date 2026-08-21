/** Bounded automatic session context for deterministic team runs. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveTeamProfile, type TeamProfile } from "./team-profiles.js";

interface SessionMessageEntry {
	readonly type: "message";
	readonly message: {
		readonly role?: string;
		readonly content?: string | readonly unknown[];
	};
}

function isSessionMessageEntry(entry: unknown): entry is SessionMessageEntry {
	return typeof entry === "object" && entry !== null && (entry as { type?: string }).type === "message" && typeof (entry as { message?: unknown }).message === "object";
}

function textContent(value: string | readonly unknown[] | undefined): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is { type?: string; text?: string } => typeof item === "object" && item !== null)
		.map((item) => item.text)
		.filter((text): text is string => typeof text === "string")
		.join("");
}

function looksLikeSecret(text: string): boolean {
	return /\b(?:api[_-]?key|token|password|secret|bearer)\b/gi.test(text) && /[a-zA-Z0-9+/=]{16,}/.test(text);
}

function isTextOnlyUserOrAssistant(role: string | undefined): boolean {
	return role === "user" || role === "assistant";
}

export function buildTeamContext(ctx: ExtensionContext, currentPrompt: string, profile?: TeamProfile): string {
	const profileConfig = resolveTeamProfile(profile);
	if (profileConfig.historyTurns === 0 || profileConfig.historyChars === 0) return currentPrompt;
	const entries = (ctx.sessionManager?.getEntries?.() ?? []) as readonly unknown[];
	const lines: string[] = [];
	let charBudget = profileConfig.historyChars;
	let turns = 0;
	for (let index = entries.length - 1; index >= 0; index--) {
		if (turns >= profileConfig.historyTurns) break;
		const entry = entries[index];
		if (!isSessionMessageEntry(entry)) continue;
		const role = entry.message.role;
		if (!isTextOnlyUserOrAssistant(role)) continue;
		const text = textContent(entry.message.content)?.trim();
		if (!text || text === currentPrompt.trim()) continue;
		if (looksLikeSecret(text)) {
			lines.unshift(`[${role}]: [redacted: possible secret]`);
			turns++;
			continue;
		}
		const available = Math.min(charBudget, text.length);
		const truncated = available < text.length ? `${text.slice(0, available)}\n[older message truncated]` : text;
		lines.unshift(`[${role}]: ${truncated}`);
		charBudget -= available;
		turns++;
		if (charBudget <= 0) break;
	}
	if (lines.length === 0) return currentPrompt;
	return ["Recent conversation context:", ...lines, "", "Current user prompt:", currentPrompt].join("\n");
}
