/** Capability-free runtime construction for phase-2 boost reservations. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Registry } from "../../pi-panopticon/types.js";
import {
	type BoostCommandDeps,
	type BoostCommandIdentity,
	InertBoostDispatch,
} from "./command.js";
import type {
	BoostLeaseDependencies,
	BoostModelIdentity,
} from "./contracts.js";
import { BoostGlobalLeaseSlot } from "./global-slot.js";
import { BoostLeaseAuthority } from "./lease-authority.js";
import { parseBoostCommand } from "./parser.js";

const INERT_LEASE_DURATION_MS = 5 * 60_000;
const INERT_BASELINE_MODEL: BoostModelIdentity = Object.freeze({
	provider: "inert",
	id: "inert-glm-baseline",
	family: "glm-5.2",
	registered: true,
});
const INERT_LEASE_MODEL: BoostModelIdentity = Object.freeze({
	provider: "inert",
	id: "inert-sol-lease",
	family: "sol-ultra",
	registered: true,
});

/** Construct every capability available to the phase-2 command registration. */
export function createInertBoostCommandDeps(
	registry: Pick<Registry, "isRootSession" | "selfId">,
): BoostCommandDeps {
	const authority = createInertBoostAuthority();
	return {
		parse: parseBoostCommand,
		authority: {
			reserve: (input) => authority.reserve(input),
			getStatus: (actor) => authority.getStatus(actor),
			reset: (input) => authority.reset(input),
		},
		identity: (ctx) => principalIdentity(ctx, registry),
		notify: (ctx, message, level) => ctx.ui.notify(message, level),
		dispatch: new InertBoostDispatch(),
	};
}

function principalIdentity(
	ctx: ExtensionCommandContext,
	registry: Pick<Registry, "isRootSession" | "selfId">,
): BoostCommandIdentity | undefined {
	if (!registry.isRootSession()) {
		return undefined;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	return {
		actor: { kind: "principal", issuerId: sessionId },
		subject: {
			subjectId: registry.selfId,
			workspace: { workspaceId: sessionId, root: ctx.cwd },
		},
	};
}

/** Build an in-memory authority with no external-effect adapter. */
function createInertBoostAuthority(): BoostLeaseAuthority {
	let nextId = 0;
	const dependencies: BoostLeaseDependencies = {
		audit: { append: () => undefined },
		governance: { classify: () => "denied" },
		ids: { next: (kind) => `${kind}-inert-${++nextId}` },
		isolation: {
			create: () => {
				throw new Error("Inert boost dispatch cannot create a context");
			},
			dispose: () => undefined,
		},
		models: {
			resolve: (key) =>
				key === "principalBoostBaseline"
					? INERT_BASELINE_MODEL
					: INERT_LEASE_MODEL,
			restore: () => undefined,
			select: () => {
				throw new Error("Inert boost dispatch cannot select a model");
			},
		},
		now: Date.now,
		slot: new BoostGlobalLeaseSlot(),
		workspace: { revalidate: () => false },
	};
	return new BoostLeaseAuthority(dependencies, {
		leaseDurationMs: INERT_LEASE_DURATION_MS,
	});
}
