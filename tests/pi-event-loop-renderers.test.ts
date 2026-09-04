/** Render tests for pi-event-loop command messages and tool call/result custom renderers. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import eventLoopExtension from "../extensions/pi-event-loop/index.js";
import { COMMAND_MESSAGE_CUSTOM_TYPE } from "../extensions/pi-event-loop/types.js";

interface RenderComponent {
	render(width: number): string[];
}

interface RenderableTool {
	name: string;
	renderCall?: (args: unknown, theme: Theme, context: unknown) => RenderComponent;
	renderResult?: (
		result: unknown,
		options: { expanded: boolean },
		theme: Theme,
		context: unknown,
	) => RenderComponent;
}

type CommandMessageRenderer = (
	message: unknown,
	options: { expanded: boolean },
	theme: Theme,
) => RenderComponent | undefined;

function createRendererHarness() {
	const tools = new Map<string, RenderableTool>();
	const messageRenderers = new Map<string, CommandMessageRenderer>();
	const pi = {
		on: vi.fn(),
		registerTool: vi.fn((tool: RenderableTool) => {
			tools.set(tool.name, tool);
		}),
		registerCommand: vi.fn(),
		registerMessageRenderer: vi.fn((customType: string, renderer: CommandMessageRenderer) => {
			messageRenderers.set(customType, renderer);
		}),
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
	};
	const theme = {
		fg: (_color: string, text: string) => `[fg:${_color}]${text}[/fg]`,
		bg: (_color: string, text: string) => `[bg:${_color}]${text}[/bg]`,
		bold: (text: string) => `[bold]${text}[/bold]`,
		italic: (text: string) => `[italic]${text}[/italic]`,
		underline: (text: string) => `[underline]${text}[/underline]`,
		strikethrough: (text: string) => `[strikethrough]${text}[/strikethrough]`,
		inverse: (text: string) => `[inverse]${text}[/inverse]`,
	} as unknown as Theme;
	return { pi, tools, messageRenderers, theme };
}

describe("pi-event-loop custom renderers", () => {
	it("registers a message renderer for command messages with bounded compact vs expanded rendering", () => {
		const harness = createRendererHarness();
		eventLoopExtension(harness.pi as never);

		const renderer = harness.messageRenderers.get(COMMAND_MESSAGE_CUSTOM_TYPE);
		expect(renderer, "COMMAND_MESSAGE_CUSTOM_TYPE renderer must be registered").toBeDefined();

		const message = {
			customType: COMMAND_MESSAGE_CUSTOM_TYPE,
			content: "Perform work",
			display: true as const,
			details: {
				commandId: "cmd-123",
				commandType: "perform-work",
				workItemId: "work-456",
				correlationId: "corr-789",
				causedBy: "evt-001",
				workItem: { task: "process-data", secretToken: "untrusted-input" },
				expectedEvents: ["work.completed", "work.failed"],
			},
		};

		// Compact rendering: default bounded view, shows type/id, excludes raw payload
		const compactComponent = renderer!(message, { expanded: false }, harness.theme);
		expect(compactComponent).toBeDefined();
		const compactLines = compactComponent!.render(100).join("\n");
		expect(compactLines).toContain("perform-work");
		expect(compactLines).toContain("cmd-123");
		expect(compactLines).not.toContain("secretToken");
		expect(compactLines).toContain("[fg:");

		// Expanded rendering: reveals expected outcomes and untrusted payload clearly labeled
		const expandedComponent = renderer!(message, { expanded: true }, harness.theme);
		expect(expandedComponent).toBeDefined();
		const expandedLines = expandedComponent!.render(100).join("\n");
		expect(expandedLines).toContain("cmd-123");
		expect(expandedLines).toContain("work.completed");
		expect(expandedLines).toContain("untrusted");
		expect(expandedLines).toContain("secretToken");
	});

	it("registers emit tool with theme-aware compact call and expanded payload rendering", () => {
		const harness = createRendererHarness();
		eventLoopExtension(harness.pi as never);

		const tool = harness.tools.get("event_loop_emit");
		expect(tool).toBeDefined();
		expect(tool?.renderCall, "emit tool must define renderCall").toBeDefined();
		expect(tool?.renderResult, "emit tool must define renderResult").toBeDefined();

		const args = {
			event: "work.completed",
			dedupeKey: "key-999",
			payload: { workId: "w-1", result: "ok" },
		};

		// Compact call: shows tool and event, omits payload
		const compactCallContext = { expanded: false, cwd: "/test" };
		const compactCall = tool!.renderCall!(args, harness.theme, compactCallContext);
		const compactCallLines = compactCall.render(100).join("\n");
		expect(compactCallLines).toContain("work.completed");
		expect(compactCallLines).toContain("key-999");
		expect(compactCallLines).not.toContain("result: ok");
		expect(compactCallLines).toContain("[fg:");

		// Expanded call: shows payload
		const expandedCallContext = { expanded: true, cwd: "/test" };
		const expandedCall = tool!.renderCall!(args, harness.theme, expandedCallContext);
		const expandedCallLines = expandedCall.render(100).join("\n");
		expect(expandedCallLines).toContain("work.completed");
		expect(expandedCallLines).toContain("w-1");

		// Compact result: concise status
		const result = {
			content: [{ type: "text", text: "Recorded event work.completed (evt-100)" }],
			details: {
				accepted: true,
				eventId: "evt-100",
				type: "work.completed",
			},
		};
		const compactResult = tool!.renderResult!(result, { expanded: false }, harness.theme, compactCallContext);
		const compactResultLines = compactResult.render(100).join("\n");
		expect(compactResultLines).toContain("evt-100");
		expect(compactResultLines).toContain("[fg:");

		// Expanded result: full details
		const expandedResult = tool!.renderResult!(result, { expanded: true }, harness.theme, expandedCallContext);
		const expandedResultLines = expandedResult.render(100).join("\n");
		expect(expandedResultLines).toContain("evt-100");
	});

	it("registers context tool with theme-aware compact and expanded rendering", () => {
		const harness = createRendererHarness();
		eventLoopExtension(harness.pi as never);

		const tool = harness.tools.get("event_loop_context");
		expect(tool).toBeDefined();
		expect(tool?.renderCall, "context tool must define renderCall").toBeDefined();
		expect(tool?.renderResult, "context tool must define renderResult").toBeDefined();

		const compactCall = tool!.renderCall!({}, harness.theme, { expanded: false, cwd: "/test" });
		const compactCallLines = compactCall.render(100).join("\n");
		expect(compactCallLines).toContain("event_loop_context");
		expect(compactCallLines).toContain("[fg:");

		const result = {
			content: [{ type: "text", text: "Context snapshot summary" }],
			details: {
				profile: "default",
				paused: false,
				activeCommand: { type: "perform-work", commandId: "cmd-abc" },
				openItemCount: 3,
			},
		};

		// Compact result: concise status/counts
		const compactResult = tool!.renderResult!(result, { expanded: false }, harness.theme, { expanded: false, cwd: "/test" });
		const compactResultLines = compactResult.render(100).join("\n");
		expect(compactResultLines).toContain("perform-work");
		expect(compactResultLines).toContain("[fg:");

		// Expanded result: detailed breakdown
		const expandedResult = tool!.renderResult!(result, { expanded: true }, harness.theme, { expanded: true, cwd: "/test" });
		const expandedResultLines = expandedResult.render(100).join("\n");
		expect(expandedResultLines).toContain("cmd-abc");
	});
});
