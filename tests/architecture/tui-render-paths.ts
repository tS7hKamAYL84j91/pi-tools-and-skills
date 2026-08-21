/** TUI render-path architecture fitness functions. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TEAM_OVERLAY_FILES = [
	"extensions/pi-teams/team-overlay.ts",
	"extensions/pi-teams/team-overlay-render.ts",
	"extensions/pi-teams/team-picker.ts",
];

const FORBIDDEN_RENDER_CALLS = new Set([
	"existsSync",
	"loadTeamRegistry",
	"readFileSync",
	"readdirSync",
	"statSync",
	"teamDescriptionLines",
]);

function renderFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
	if (ts.isMethodDeclaration(node) && node.name.getText() === "render") return node;
	if (!ts.isPropertyAssignment(node) || node.name.getText() !== "render") return undefined;
	return ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)
		? node.initializer
		: undefined;
}

function forbiddenCalls(file: string): string[] {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const violations: string[] = [];
	const visit = (node: ts.Node): void => {
		const render = renderFunction(node);
		if (render) {
			const inspectRender = (child: ts.Node): void => {
				if (ts.isCallExpression(child)) {
					const callName = child.expression.getText(source).split(".").at(-1);
					if (callName && FORBIDDEN_RENDER_CALLS.has(callName)) {
						const location = source.getLineAndCharacterOfPosition(child.getStart(source));
						violations.push(`${relative(process.cwd(), file)}:${location.line + 1} calls ${callName}`);
					}
				}
				ts.forEachChild(child, inspectRender);
			};
			inspectRender(render);
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return violations;
}

describe("TUI render paths", () => {
	it("team overlay render closures do not perform synchronous registry or filesystem reads", () => {
		expect(TEAM_OVERLAY_FILES.flatMap(forbiddenCalls)).toEqual([]);
	});
});
