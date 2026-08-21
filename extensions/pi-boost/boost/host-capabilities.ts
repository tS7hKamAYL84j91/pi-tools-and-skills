/** Narrow host capabilities that are safe to inject into pi-boost. */

interface BoostTrustContext {
	readonly cwd: string;
}

/** Host-owned project trust decision used to gate project-local settings. */
export interface BoostHostCapabilities {
	readonly isProjectTrusted: (cwd: string, context?: BoostTrustContext) => boolean;
	/** Optional host-selected standard global settings path for tests/embedded hosts. */
	readonly globalSettingsPath?: string;
}

function contextTrust(context: BoostTrustContext | undefined): boolean {
	if (!context || !("isProjectTrusted" in context)) return false;
	const resolver = context.isProjectTrusted;
	if (typeof resolver !== "function") return false;
	try {
		return resolver.call(context) === true;
	} catch {
		return false;
	}
}

/** Fail-closed unless the installed Pi host supplies its trusted project decision. */
export const DEFAULT_BOOST_HOST_CAPABILITIES: BoostHostCapabilities = {
	isProjectTrusted: (_cwd, context) => contextTrust(context),
};
