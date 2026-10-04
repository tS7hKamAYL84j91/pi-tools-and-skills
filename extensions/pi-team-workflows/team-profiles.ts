/** Shared latency/cost profiles for declarative team runs. */

export const TEAM_PROFILE_NAMES = ["fast", "balanced", "thorough"] as const;

export type TeamProfile = typeof TEAM_PROFILE_NAMES[number];

export function isTeamProfile(value: string): value is TeamProfile {
	return TEAM_PROFILE_NAMES.some((profile) => profile === value);
}

interface TeamProfileConfig {
	navigatorMaxTokens: number;
	navigatorTimeoutMs: number;
	navigatorMaxRetries: number;
	historyTurns: number;
	historyChars: number;
}

const TEAM_PROFILE_CONFIGS: Record<TeamProfile, TeamProfileConfig> = {
	fast: {
		navigatorMaxTokens: 600,
		navigatorTimeoutMs: 30_000,
		navigatorMaxRetries: 0,
		historyTurns: 0,
		historyChars: 0,
	},
	balanced: {
		navigatorMaxTokens: 1_200,
		navigatorTimeoutMs: 60_000,
		navigatorMaxRetries: 1,
		historyTurns: 5,
		historyChars: 4_000,
	},
	thorough: {
		navigatorMaxTokens: 2_000,
		navigatorTimeoutMs: 120_000,
		navigatorMaxRetries: 2,
		historyTurns: 8,
		historyChars: 8_000,
	},
};

export function resolveTeamProfile(profile?: TeamProfile): TeamProfileConfig {
	return TEAM_PROFILE_CONFIGS[profile ?? "balanced"];
}
