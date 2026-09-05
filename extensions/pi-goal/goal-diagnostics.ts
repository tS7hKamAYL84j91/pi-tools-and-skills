/** Safe, bounded diagnostics for persisted pi-goal failure state and UI. */
import { redactSecrets } from "../../lib/secret-redaction.js";

const MAX_GOAL_DIAGNOSTIC_LENGTH = 400;
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`,
	"g",
);
const FALLBACK_DIAGNOSTIC = "Goal runtime failed.";

export function formatGoalDiagnostic(error: unknown): string {
	const raw =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	const normalized = [...raw.replace(ANSI_ESCAPE_PATTERN, " ")]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
				? " "
				: character;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	const redacted = redactSecrets(normalized);
	return (redacted || FALLBACK_DIAGNOSTIC).slice(0, MAX_GOAL_DIAGNOSTIC_LENGTH);
}
