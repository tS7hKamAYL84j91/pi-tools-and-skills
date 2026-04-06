/**
 * KanbanPanel — WebviewPanel host for the kanban board.
 *
 * Parses board.log via the shared board.ts parser, serialises
 * the board state, and posts it to the webview for rendering.
 * Watches board.log for changes and auto-refreshes.
 */

import * as vscode from "vscode";
import { appendFile } from "node:fs/promises";
import {
	parseBoard,
	boardLogPath,
	type BoardState,
	type TaskState,
	WIP_LIMIT,
	nowZ,
} from "../../project-extensions/kanban/board.js";
import { findAgentByName } from "../../lib/agent-api.js";

// ── Serialisation (Map → plain object for postMessage) ──────────

interface SerializedBoard {
	tasks: Record<string, TaskState>;
	order: string[];
	totalEvents: number;
	wipLimit: number;
	agentModels: Record<string, string>;
}

function serializeBoard(board: BoardState): SerializedBoard {
	const tasks: Record<string, TaskState> = {};
	const agentNames = new Set<string>();
	for (const [id, task] of board.tasks) {
		tasks[id] = task;
		if (task.col === "in-progress" && task.claimAgent) {
			agentNames.add(task.claimAgent);
		}
	}
	// Look up models for in-progress agents
	const agentModels: Record<string, string> = {};
	for (const name of agentNames) {
		const info = findAgentByName(name);
		if (info?.model) {
			// "anthropic/claude-sonnet-4-6" → "sonnet-4-6"
			const short = info.model.replace(/^[^/]+\/claude-/, "").replace(/^[^/]+\//, "");
			agentModels[name] = short;
		}
	}
	return { tasks, order: board.order, totalEvents: board.totalEvents, wipLimit: WIP_LIMIT, agentModels };
}

// ── Panel ───────────────────────────────────────────────────────

export class KanbanPanel {
	static currentPanel: KanbanPanel | undefined;
	private static readonly viewType = "coasKanban";

	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly disposables: vscode.Disposable[] = [];
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;

	static createOrShow(context: vscode.ExtensionContext): void {
		if (KanbanPanel.currentPanel) {
			KanbanPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			KanbanPanel.viewType,
			"CoAS Kanban",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, "media"),
				],
			},
		);
		KanbanPanel.currentPanel = new KanbanPanel(panel, context.extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;

		this.panel.webview.html = this.getHtml();
		this.setupWatcher();

		// Handle messages from webview
		this.panel.webview.onDidReceiveMessage(
			(msg) => this.handleMessage(msg),
			null,
			this.disposables,
		);

		// Also refresh when panel becomes visible again
		this.panel.onDidChangeViewState(
			() => { if (this.panel.visible) this.refresh(); },
			null,
			this.disposables,
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	// ── Message handling ──────────────────────────────────────

	private async handleMessage(msg: Record<string, unknown>): Promise<void> {
		switch (msg.type) {
			case "ready":
				this.refresh();
				break;
			case "moveTask":
				await this.appendEvent(
					`MOVE ${msg.taskId} vscode-kanban from=${msg.fromCol} to=${msg.toCol}`,
				);
				break;
			case "completeTask":
				await this.appendEvent(
					`COMPLETE ${msg.taskId} vscode-kanban duration=unknown`,
				);
				break;
			case "blockTask":
				await this.appendEvent(
					`BLOCK ${msg.taskId} vscode-kanban reason="${String(msg.reason ?? "blocked via UI").replace(/"/g, "'")}"`,
				);
				break;
		}
	}

	private async appendEvent(event: string): Promise<void> {
		try {
			await appendFile(boardLogPath(), `${nowZ()} ${event}\n`, "utf-8");
			// File watcher will trigger refresh automatically
		} catch (err) {
			vscode.window.showErrorMessage(`Kanban: failed to write board.log: ${err}`);
		}
	}

	// ── Refresh ─────────────────────────────────────────────────

	private async refresh(): Promise<void> {
		try {
			const board = await parseBoard();
			this.panel.webview.postMessage({
				type: "updateBoard",
				board: serializeBoard(board),
			});
		} catch (err) {
			this.panel.webview.postMessage({
				type: "error",
				message: String(err),
			});
		}
	}

	private debouncedRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.refresh(), 200);
	}

	// ── File watcher ────────────────────────────────────────────

	private setupWatcher(): void {
		try {
			const logPath = boardLogPath();
			const watcher = vscode.workspace.createFileSystemWatcher(logPath);
			watcher.onDidChange(() => this.debouncedRefresh());
			watcher.onDidCreate(() => this.debouncedRefresh());
			this.disposables.push(watcher);
		} catch {
			/* board.log path may not resolve yet — refresh manually */
		}
	}

	// ── Cleanup ─────────────────────────────────────────────────

	private dispose(): void {
		KanbanPanel.currentPanel = undefined;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		for (const d of this.disposables) d.dispose();
	}

	// ── HTML ────────────────────────────────────────────────────

	private getHtml(): string {
		const webview = this.panel.webview;
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "kanban.css"),
		);
		const jsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "kanban.js"),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link href="${cssUri}" rel="stylesheet">
	<title>CoAS Kanban</title>
</head>
<body>
	<div id="kanban-root">
		<div class="loading">Loading board…</div>
	</div>
	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
