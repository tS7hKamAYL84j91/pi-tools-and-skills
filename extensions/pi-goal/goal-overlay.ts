/** Goal detail overlay renderer. */
import { DynamicBorder, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";
import { renderGoalOverlayLines } from "./goal-render.js";
import { renderGoalSummary, type GoalState } from "./state.js";

/** Show detailed goal state without keeping it in the persistent status widget. */
export async function showGoalOverlay(ctx: ExtensionCommandContext, state: GoalState): Promise<void> {
	await ctx.ui.custom<void>((_tui, theme, _keyboard, done) => {
		const detail = renderGoalOverlayLines(renderGoalSummary(state), 24);
		return {
			render: (width: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((text: string) => theme.fg("accent", text));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(" Goal Detail")), 1, 0));
				container.addChild(new Text(theme.fg("dim", " esc close · details also in .pi/goal/instances/<goalId>/GOAL.md"), 1, 0));
				for (const line of detail) {
					container.addChild(new Text(line, 1, 0));
				}
				container.addChild(border());
				return container.render(width);
			},
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				}
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			width: "80%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});
}
