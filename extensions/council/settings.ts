/**
 * Council settings — read configured councils from ~/.pi/agent/settings.json.
 *
 * Settings shape:
 *   {
 *     "council": {
 *       "defaultMembers": ["openai-codex/gpt-5.5", "google-gemini-cli/gemini-3.1-pro-preview", ...],
 *       "defaultChairman": "openai-codex/gpt-5.5",
 *       "councils": {
 *         "architecture": { "members": [...], "chairman": "...", "purpose": "..." }
 *       }
 *     }
 *   }
 *
 * Edit ~/.pi/agent/settings.json to change council defaults.
 * Field-level defaults are applied so partial config works: a user can
 * set defaultMembers without providing defaultChairman, etc.
 */

import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";

const SETTINGS_JSON = PI_SETTINGS_PATH;

/** @public */
export interface SettingsCouncilEntry {
	members?: string[];
	chairman?: string;
	purpose?: string;
}

/** @public */
export interface CouncilSettings {
	defaultMembers?: string[];
	defaultChairman?: string;
	councils?: Record<string, SettingsCouncilEntry>;
}


/**
 * Hard-coded defaults — the single source of truth for council model selection.
 * Used only when settings.json has no council section or individual fields are absent.
 *
 * Design: System 1/System 2 split-brain paradigm with max epistemic diversity.
 *   - Members span OpenAI, Google, and Chinese (Ollama) providers to cancel
 *     provider-specific noise ("wisdom of the crowd" principle).
 *   - Each member occupies a distinct reasoning niche:
 *     logic (gpt-5.5), knowledge (gemini-3.1-pro), factual anchor (qwen3.5),
 *     human preference (glm-5.1).
 *   - Chairman is gpt-5.5 for meta-reasoning synthesis.
 */
const DEFAULT_COUNCIL_SETTINGS: Required<Omit<CouncilSettings, "councils">> & { councils: Record<string, never> } = {
	defaultMembers: [
		"openai-codex/gpt-5.5",
		"google-gemini-cli/gemini-3.1-pro-preview",
		"ollama/qwen3.5:cloud",
		"ollama/glm-5.1:cloud",
	],
	defaultChairman: "openai-codex/gpt-5.5",
	councils: {},
};

/** Read the council section of ~/.pi/agent/settings.json. Returns {} if missing/invalid. */
function readCouncilSettings(
	path: string = SETTINGS_JSON,
): CouncilSettings {
	const value = readPiSettingsKey("council", path);
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as CouncilSettings)
		: {};
}

/**
 * Resolve council settings with field-level defaults.
 *
 * User settings override hard-coded defaults per field, so partial config
 * (e.g. only `councils.architecture` with no `defaultMembers`) still gets
 * sane defaults for the unspecified fields.
 */
export function resolveCouncilSettings(
	path: string = SETTINGS_JSON,
): Required<Omit<CouncilSettings, "councils">> & { councils: Record<string, SettingsCouncilEntry> } {
	const user = readCouncilSettings(path);
	return {
		defaultMembers: user.defaultMembers ?? DEFAULT_COUNCIL_SETTINGS.defaultMembers,
		defaultChairman: user.defaultChairman ?? DEFAULT_COUNCIL_SETTINGS.defaultChairman,
		councils: user.councils ?? {},
	};
}

/** The hard-coded default member list — exported for tests and as public API. */
export const DEFAULT_MEMBER_CANDIDATES = DEFAULT_COUNCIL_SETTINGS.defaultMembers;

/**
 * Chairman fallback candidates — models capable of meta-reasoning synthesis.
 * Tried in order against the registry; first match wins.
 *
 * 1. gpt-5.5 — Reasoning leader. ARC-AGI-2 85.0%, "Thinking" mode for
 *    verifying assumptions and resolving logical contradictions. Best for
 *    deep technical audits and zero-shot code generation.
 * 2. gemini-3.1-pro-preview — Context specialist. 1M+ token window,
 *    GPQA Diamond 94.3%. Best for research-heavy synthesis where the
 *    chairman must ingest large documents alongside council responses.
 * 3. glm-5.1:cloud — Natural synthesizer. Chatbot Arena Elo 1451,
 *    IFEval 88.0%. Produces the most human-readable synthesis reports,
 *    favouring conversation quality over raw throughput.
 */
export const DEFAULT_CHAIRMAN_CANDIDATES: string[] = [
	"openai-codex/gpt-5.5",
	"google-gemini-cli/gemini-3.1-pro-preview",
	"ollama/glm-5.1:cloud",
];
