/**
 * Pure helpers for the live team benchmark.
 *
 * Exported separately from the CLI runner so deterministic tests can import
 * them without triggering the opt-in guard or `process.exit()` in main().
 */

export const OPT_IN_ENV = "PI_TEAM_LIVE_BENCHMARK";
export const DEFAULT_PROMPT =
	"Review whether a small code change is correct, bounded, and adequately tested. Return no secrets or private data.";

// Bounded redacted error taxonomy. Never persists raw error strings, prompts,
// model output, headers, tokens, or credentials. Patterns cover the known
// live failure modes without recording sensitive context.
export function categorizeError(error) {
	if (typeof error !== "string" || error.length === 0) return "unknown";
	const normalized = error.toLowerCase();
	if (normalized.includes("unsupported parameter")) return "unsupported_parameter";
	if (normalized.includes("usage limit")) return "usage_limit";
	if (normalized.includes("authentication") || normalized.includes("401")) return "authentication";
	if (normalized.includes("rate") || normalized.includes("429")) return "rate_limited";
	if (normalized.includes("timeout") || normalized.includes("aborted")) return "timeout";
	if (normalized.includes("empty") && normalized.includes("output")) return "empty_output";
	if (normalized.includes("invalid") && normalized.includes("json")) return "invalid_output";
	if (normalized.includes("provider") && normalized.includes("error")) return "provider_error";
	return "unknown";
}

export function summarizeSchema(summary) {
	if (typeof summary !== "string") return null;
	if (summary.trim().length === 0) return null;
	try {
		return JSON.parse(summary);
	} catch {
		return null;
	}
}

export function fusionSchemaValid(value) {
	if (value === null || typeof value !== "object") return false;
	const arrayFields = [
		"consensus",
		"contradictions",
		"partialCoverage",
		"uniqueInsights",
		"blindSpots",
		"missingEvidence",
	];
	return (
		typeof value.answer === "string" &&
		value.answer.trim().length > 0 &&
		typeof value.confidence === "string" &&
		arrayFields.every((field) => Array.isArray(value[field]))
	);
}

export function resultIsValid(team, completedEvent) {
	if (
		completedEvent === undefined ||
		typeof completedEvent.summary !== "string"
	)
		return false;
	if (team === "navigator") return completedEvent.summary.trim().length > 0;
	return fusionSchemaValid(summarizeSchema(completedEvent.summary));
}

export function judgeNode(nodes) {
	return nodes.find((node) => node.role === "judge");
}

// For Fusion, a non-degraded run requires all nodes ok AND the judge node ok.
// A schema-valid fallback produced while nodes failed is degraded, not valid.
export function isDegraded(team, nodes, completedEvent) {
	if (team === "navigator") {
		return nodes.length === 0 || !nodes.every((node) => node.ok);
	}
	const judge = judgeNode(nodes);
	if (!judge || !judge.ok) return true;
	return nodes.some((node) => !node.ok);
}

export function percentile(values, percentileValue) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	if (percentileValue === 0.5 && sorted.length % 2 === 0) {
		const right = sorted.length / 2;
		return Math.round(((sorted[right - 1] ?? 0) + (sorted[right] ?? 0)) / 2);
	}
	return (
		sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)] ?? null
	);
}

export function summarize(runs, team) {
	const successful = runs.filter(
		(runRecord) =>
			runRecord.exitCode === 0 && runRecord.teamDurationMs !== null,
	);
	const nonDegraded = successful.filter((runRecord) => !runRecord.degraded);
	const endToEndAll = successful.map((runRecord) => runRecord.endToEndDurationMs);
	const endToEndHealthy = nonDegraded.map(
		(runRecord) => runRecord.endToEndDurationMs,
	);
	const nodes = successful.flatMap((runRecord) =>
		runRecord.nodes.map((node) => node.durationMs),
	);
	const roleModelStats = {};
	for (const runRecord of successful) {
		for (const node of runRecord.nodes) {
			const key = `${node.role}:${node.model}`;
			const stat = roleModelStats[key] ??= { total: 0, ok: 0, errors: {} };
			stat.total += 1;
			if (node.ok) {
				stat.ok += 1;
			} else {
				const category = node.errorCategory ?? "unknown";
				stat.errors[category] = (stat.errors[category] ?? 0) + 1;
			}
		}
	}
	return {
		successfulRuns: successful.length,
		validRuns: successful.filter((runRecord) => runRecord.resultValid).length,
		degradedRuns: successful.filter((runRecord) => runRecord.degraded).length,
		nonDegradedRuns: nonDegraded.length,
		judgeValidRuns: successful.filter((runRecord) => runRecord.judgeValid).length,
		medianEndToEndDurationMs: percentile(endToEndAll, 0.5),
		p95EndToEndDurationMs: percentile(endToEndAll, 0.95),
		medianNonDegradedEndToEndDurationMs: percentile(endToEndHealthy, 0.5),
		p95NonDegradedEndToEndDurationMs: percentile(endToEndHealthy, 0.95),
		medianNodeDurationMs: percentile(nodes, 0.5),
		p95NodeDurationMs: percentile(nodes, 0.95),
		roleModelStats,
	};
}