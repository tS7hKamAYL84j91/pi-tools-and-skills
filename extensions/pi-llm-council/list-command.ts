/** Interactive /council-list overlay registration. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text, matchesKey } from "@mariozechner/pi-tui";
import type { CouncilDefinition } from "./types.js";

interface CouncilSlotLike {
	definition: CouncilDefinition;
	availableSnapshot: string[];
}

function councilLines(slots: Iterable<CouncilSlotLike>): string[] {
	return [...slots].map(({ definition }) => {
		const purpose = definition.purpose ? ` — ${definition.purpose}` : "";
		return `  ${definition.name}${purpose}\n    members: ${definition.members.join(", ")}\n    chairman: ${definition.chairman}`;
	});
}

export function registerCouncilListCommand(
	pi: ExtensionAPI,
	councils: Map<string, CouncilSlotLike>,
): void {
	pi.registerCommand("council-list", {
		description: "Show session-local councils",
		handler: async (_args, ctx) => {
			if (councils.size === 0) {
				ctx.ui.notify("No councils formed in this session.", "warning");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				const border = () =>
					new DynamicBorder((s: string) => theme.fg("accent", s));
				const container = new Container();
				container.addChild(border());
				container.addChild(
					new Text(
						theme.fg("accent", theme.bold(" Councils"))
							+ theme.fg("dim", ` — ${councils.size} configured`),
						1,
						0,
					),
				);
				for (const line of councilLines(councils.values())) {
					container.addChild(new Text(line, 1, 0));
				}
				container.addChild(
					new Text(theme.fg("dim", "  esc close"), 1, 0),
				);
				container.addChild(border());
				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, "escape")) done();
					},
				};
			});
		},
	});
}
