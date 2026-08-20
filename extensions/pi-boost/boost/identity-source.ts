/** Principal-session identity boundary for the standalone Boost extension. */

export interface BoostIdentitySource {
	readonly selfId: string;
	isPrincipalSession(): boolean;
}
