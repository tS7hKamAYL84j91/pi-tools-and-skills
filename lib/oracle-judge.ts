/** Local deterministic oracle-judge POC for synthetic eval fixtures. */

/** @public */
export type OracleJudgeVerdict = "pass" | "warn" | "fail";

/** @public */
export interface OracleJudgeScore {
	criterion: string;
	score: number;
	weight?: number;
	reason: string;
}

/** @public */
export interface OracleJudgeInput {
	id: string;
	judges: OracleJudgeScore[];
	passThreshold?: number;
	warnThreshold?: number;
}

/** @public */
export interface OracleJudgeResult {
	id: string;
	verdict: OracleJudgeVerdict;
	score: number;
	maxScore: number;
	normalized: number;
	criteria: Array<OracleJudgeScore & { weight: number; weightedScore: number }>;
	reasons: string[];
}

function assertScore(score: OracleJudgeScore): void {
	if (!score.criterion.trim()) throw new Error("criterion must be non-empty");
	if (!Number.isFinite(score.score) || score.score < 0 || score.score > 1) throw new Error(`score for ${score.criterion} must be between 0 and 1`);
	if (score.weight !== undefined && (!Number.isFinite(score.weight) || score.weight <= 0)) throw new Error(`weight for ${score.criterion} must be positive`);
	if (!score.reason.trim()) throw new Error(`reason for ${score.criterion} must be non-empty`);
}

function verdict(normalized: number, passThreshold: number, warnThreshold: number): OracleJudgeVerdict {
	if (normalized >= passThreshold) return "pass";
	if (normalized >= warnThreshold) return "warn";
	return "fail";
}

/** Combine synthetic judge scores into one deterministic local result. */
export function evaluateOracleJudges(input: OracleJudgeInput): OracleJudgeResult {
	if (!input.id.trim()) throw new Error("id must be non-empty");
	if (input.judges.length === 0) throw new Error("at least one judge score is required");
	const passThreshold = input.passThreshold ?? 0.8;
	const warnThreshold = input.warnThreshold ?? 0.6;
	if (!(warnThreshold >= 0 && warnThreshold <= passThreshold && passThreshold <= 1)) throw new Error("thresholds must satisfy 0 <= warnThreshold <= passThreshold <= 1");
	const criteria = input.judges.map((judge) => {
		assertScore(judge);
		const weight = judge.weight ?? 1;
		return { ...judge, weight, weightedScore: judge.score * weight };
	});
	const maxScore = criteria.reduce((sum, judge) => sum + judge.weight, 0);
	const score = criteria.reduce((sum, judge) => sum + judge.weightedScore, 0);
	const normalized = maxScore === 0 ? 0 : score / maxScore;
	return {
		id: input.id,
		verdict: verdict(normalized, passThreshold, warnThreshold),
		score,
		maxScore,
		normalized,
		criteria,
		reasons: criteria.map((judge) => `${judge.criterion}: ${judge.reason}`),
	};
}
