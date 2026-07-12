/** Shared latency/cost profiles for declarative team runs. */

export type TeamProfile = "fast" | "balanced" | "thorough";

interface TeamProfileConfig {
	fusionPanelModels: number;
	fusionPanelMaxTokens: number;
	fusionJudgeMaxTokens: number;
	fusionPanelMaxChars: number;
	fusionPromptMaxChars: number;
	navigatorMaxTokens: number;
	navigatorTimeoutMs: number;
	navigatorMaxRetries: number;
	historyTurns: number;
	historyChars: number;
}

const TEAM_PROFILES: Record<TeamProfile, TeamProfileConfig> = {
	fast: {
		fusionPanelModels: 2,
		fusionPanelMaxTokens: 600,
		fusionJudgeMaxTokens: 900,
		fusionPanelMaxChars: 3_000,
		fusionPromptMaxChars: 10_000,
		navigatorMaxTokens: 600,
		navigatorTimeoutMs: 30_000,
		navigatorMaxRetries: 0,
		historyTurns: 0,
		historyChars: 0,
	},
	balanced: {
		fusionPanelModels: 3,
		fusionPanelMaxTokens: 1_200,
		fusionJudgeMaxTokens: 1_800,
		fusionPanelMaxChars: 6_000,
		fusionPromptMaxChars: 24_000,
		navigatorMaxTokens: 1_200,
		navigatorTimeoutMs: 60_000,
		navigatorMaxRetries: 1,
		historyTurns: 5,
		historyChars: 4_000,
	},
	thorough: {
		fusionPanelModels: 3,
		fusionPanelMaxTokens: 2_000,
		fusionJudgeMaxTokens: 3_000,
		fusionPanelMaxChars: 10_000,
		fusionPromptMaxChars: 40_000,
		navigatorMaxTokens: 2_000,
		navigatorTimeoutMs: 120_000,
		navigatorMaxRetries: 2,
		historyTurns: 8,
		historyChars: 8_000,
	},
};

export function resolveTeamProfile(profile?: TeamProfile): TeamProfileConfig {
	return TEAM_PROFILES[profile ?? "balanced"];
}
