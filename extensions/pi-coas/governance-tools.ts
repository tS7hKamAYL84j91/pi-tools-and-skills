/**
 * CoAS governance tool registrations.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { join } from "node:path";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { ConfinedStore } from "./store.js";
import { isoUtc } from "./store-paths.js";
import type { CoasConfig } from "./types.js";
import { maybeGovernanceRoute, normaliseIntent } from "./governance.js";
import { appendWorkspaceContext } from "./workspaces.js";

export function registerGovernanceTools(
	pi: ExtensionAPI,
	configFor: (ctx: ExtensionContext, cwd?: string) => Promise<CoasConfig>,
): void {
	pi.registerTool({
		name: "coas_governance_resolve",
		label: "CoAS Governance Resolve",
		description:
			"Classify input against configured local-only triggers and advise on the appropriate LLM model. " +
			"Advisory only; does not mutate the active session model.",
		promptSnippet: "Check input classification and resolve model routing",
		parameters: Type.Object({
			input: Type.String({ description: "Text input to classify against local-only triggers." }),
			intent: Type.Optional(
				Type.Union(
					[
						Type.Literal("triage"),
						Type.Literal("code"),
						Type.Literal("navigator"),
						Type.Literal("review"),
						Type.Literal("unknown"),
					],
					{ description: "The intent of the operation. Defaults to unknown.", default: "unknown" },
				),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const intent = normaliseIntent(params.intent);
				const resolution = maybeGovernanceRoute(params.input, intent, ctx.cwd);

				if (resolution.escalate) {
					const config = await configFor(ctx);
					const alert = `Governance escalation: classification=${resolution.classification.classification}, intent=${intent}, source=${resolution.source}, reason=${resolution.reason}`;
					try {
						await appendWorkspaceContext(config, undefined, ctx.cwd, alert);
					} catch {
						const store = await ConfinedStore.createCoasHome(config);
						await store.appendPrivateLog(join(config.coasHome, "governance", "escalation.log"), `[${isoUtc()}] ${alert}\n`);
					}
				}

				return ok(`classification: ${resolution.classification.classification}`, {
					classification: resolution.classification,
					resolvedModel: resolution.resolvedModel,
					source: resolution.source,
					escalate: resolution.escalate,
					reason: resolution.reason,
					fallbackChain: resolution.fallbackChain,
				});
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}
