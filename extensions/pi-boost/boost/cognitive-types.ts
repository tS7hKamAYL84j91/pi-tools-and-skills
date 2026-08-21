/** Pure types and configuration defaults for Cognitive Boost deliberation. */

export type CognitiveProfile = "fast" | "balanced" | "thorough";

interface CognitiveProfileSettings {
	readonly panelModels: number;
	readonly panelMaxTokens: number;
	readonly judgeMaxTokens: number;
	readonly panelMaxChars: number;
	readonly promptMaxChars: number;
}

const COGNITIVE_PROFILES: Record<
	CognitiveProfile,
	CognitiveProfileSettings
> = {
	fast: {
		panelModels: 2,
		panelMaxTokens: 600,
		judgeMaxTokens: 900,
		panelMaxChars: 3_000,
		promptMaxChars: 10_000,
	},
	balanced: {
		panelModels: 3,
		panelMaxTokens: 1_200,
		judgeMaxTokens: 1_800,
		panelMaxChars: 6_000,
		promptMaxChars: 24_000,
	},
	thorough: {
		panelModels: 3,
		panelMaxTokens: 2_000,
		judgeMaxTokens: 3_000,
		panelMaxChars: 10_000,
		promptMaxChars: 40_000,
	},
};

const DEFAULT_COGNITIVE_PROFILE: CognitiveProfile = "balanced";
export const DEFAULT_MAX_PANEL_MODELS = 3;
export const HARD_MAX_PANEL_MODELS = 4;
export const DEFAULT_APPROVAL_CALL_GATE = 4;

export const DEFAULT_PANEL_MODELS: readonly string[] = [
	"openai/gpt-5",
	"anthropic/claude-3-7-sonnet",
	"google/gemini-2.5-pro",
];

export interface CognitiveFusionPlanInput {
	readonly configuredPanel: readonly string[];
	readonly configuredJudge?: string;
	readonly configuredFallback?: readonly string[];
	readonly visibleModels?: readonly string[];
	readonly maxPanelModels?: number;
	readonly allowProviders?: readonly string[];
	readonly denyProviders?: readonly string[];
	readonly requireApprovalAboveCalls?: number;
	readonly profile?: CognitiveProfile;
}

export interface CognitiveFusionPlan {
	readonly panel: readonly string[];
	readonly panelSourceIndexes: readonly number[];
	readonly judge: string;
	readonly fallback: readonly string[];
	readonly warnings: readonly string[];
	readonly estimatedCalls: number;
	readonly requiresApproval: boolean;
}

export interface CognitiveNodeRun {
	readonly role: string;
	readonly model: string;
	readonly ok: boolean;
	readonly output: string;
	readonly durationMs: number;
	readonly attempts: number;
	readonly error?: string;
}

export interface CognitiveJudgeOutput {
	readonly answer: string;
	readonly consensus: readonly string[];
	readonly contradictions: readonly string[];
	readonly partialCoverage: readonly string[];
	readonly uniqueInsights: readonly string[];
	readonly blindSpots: readonly string[];
	readonly confidence: string;
	readonly missingEvidence: readonly string[];
}

export interface CognitiveModelRunnerInput {
	readonly model: string;
	readonly prompt: string;
	readonly systemPrompt: string;
	readonly maxTokens?: number;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly cwd?: string;
}

export interface CognitiveModelRunnerResult {
	readonly ok: boolean;
	readonly output: string;
	readonly durationMs: number;
	readonly error?: string;
}

export type CognitiveModelRunner = (
	input: CognitiveModelRunnerInput,
) => Promise<CognitiveModelRunnerResult>;

export interface CognitiveAuditRecord {
	readonly timestamp: string;
	readonly actor: "principal" | "agent";
	readonly surface: "command" | "tool";
	readonly profile: CognitiveProfile;
	readonly panelSize: number;
	readonly outcome: "completed" | "degraded" | "failed";
	readonly durationMs: number;
}

export interface CognitiveAuditSink {
	append(record: CognitiveAuditRecord): Promise<void>;
}

export interface CognitiveLeaseExecutionOptions {
	readonly prompt: string;
	readonly profile?: CognitiveProfile;
	readonly models?: readonly string[];
	readonly judge?: string;
	readonly panelSize?: number;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly runner?: CognitiveModelRunner;
	readonly visibleModels?: readonly string[];
	readonly allowProviders?: readonly string[];
	readonly denyProviders?: readonly string[];
	readonly requireApprovalAboveCalls?: number;
	readonly cwd?: string;
	readonly audit?: CognitiveAuditSink;
	readonly auditActor?: "principal" | "agent";
	readonly auditSurface?: "command" | "tool";
}

export interface CognitiveLeaseResult {
	readonly ok: boolean;
	readonly answer: string;
	readonly analysis?: CognitiveJudgeOutput;
	readonly degraded: boolean;
	readonly nodes: readonly CognitiveNodeRun[];
	readonly failureReason?: string;
	readonly warnings: readonly string[];
	readonly durationMs: number;
}

export interface BoostFusionRequest {
	readonly prompt: string;
	readonly profile?: CognitiveProfile;
	readonly panelSize?: number;
	readonly models?: readonly string[];
	readonly judge?: string;
	readonly timeoutMs?: number;
	readonly requireApprovalAboveCalls?: number;
	readonly auditActor?: "principal" | "agent";
	readonly auditSurface?: "command" | "tool";
}

export function resolveCognitiveProfile(
	profile?: CognitiveProfile,
): CognitiveProfileSettings {
	return COGNITIVE_PROFILES[profile ?? DEFAULT_COGNITIVE_PROFILE];
}
