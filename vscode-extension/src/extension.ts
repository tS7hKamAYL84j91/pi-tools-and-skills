/**
 * CoAS Kanban — VSCode Extension Entry Point
 *
 * Registers the "CoAS: Open Kanban Board" command and manages
 * the kanban webview panel lifecycle.
 */

import * as vscode from "vscode";
import { KanbanPanel } from "./kanbanPanel.js";

export function activate(context: vscode.ExtensionContext) {
	const cmd = vscode.commands.registerCommand("coas.openKanban", () => {
		KanbanPanel.createOrShow(context);
	});
	context.subscriptions.push(cmd);
}

export function deactivate() {
	/* nothing to clean up — panel disposes itself */
}
