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
			KanbanPanel.currentPanel.panel.reveal();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			KanbanPanel.viewType,
			"CoAS Kanban",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
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
			case "dropTask":
				await this.handleDrop(String(msg.taskId), String(msg.fromCol), String(msg.toCol));
				break;
			case "completeTask":
				await this.appendEvents([
					`COMPLETE ${msg.taskId} vscode-kanban duration=unknown`,
					`MOVE ${msg.taskId} vscode-kanban from=in-progress to=done`,
				]);
				break;
			case "blockTask":
				await this.handleBlockAction(String(msg.taskId));
				break;
			case "createTask":
				await this.handleCreate(msg);
				break;
			case "editTask":
				await this.handleEdit(msg);
				break;
			case "addNote":
				await this.appendEvents([
					`NOTE ${msg.taskId} vscode-kanban text="${String(msg.text).replace(/"/g, "'")}"`,
				]);
				break;
			case "deleteTask":
				await this.handleDelete(String(msg.taskId), String(msg.title || msg.taskId));
				break;
		}
	}

	private async handleDrop(taskId: string, fromCol: string, toCol: string): Promise<void> {
		const agent = "vscode-kanban";

		// Simple moves (backlog ↔ todo)
		if ((fromCol === "backlog" && toCol === "todo") || (fromCol === "todo" && toCol === "backlog")) {
			await this.appendEvents([`MOVE ${taskId} ${agent} from=${fromCol} to=${toCol}`]);
			return;
		}

		// todo → in-progress (CLAIM + MOVE, with WIP check)
		if (fromCol === "todo" && toCol === "in-progress") {
			const board = await parseBoard();
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) {
				vscode.window.showWarningMessage(`WIP limit reached (${wip}/${WIP_LIMIT}). Complete or block a task first.`);
				return;
			}
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await this.appendEvents([
				`CLAIM ${taskId} ${agent} expires=${expires}`,
				`MOVE ${taskId} ${agent} from=todo to=in-progress`,
			]);
			return;
		}

		// in-progress → done (COMPLETE + MOVE)
		if (fromCol === "in-progress" && toCol === "done") {
			await this.appendEvents([
				`COMPLETE ${taskId} ${agent} duration=unknown`,
				`MOVE ${taskId} ${agent} from=in-progress to=done`,
			]);
			return;
		}

		// in-progress → blocked (BLOCK + MOVE, with reason prompt)
		if (fromCol === "in-progress" && toCol === "blocked") {
			const reason = await vscode.window.showInputBox({
				prompt: `Block reason for ${taskId}`,
				placeHolder: "e.g. waiting for API key",
			});
			if (reason === undefined) return; // cancelled
			const safeReason = (reason || "blocked via UI").replace(/"/g, "'");
			await this.appendEvents([
				`BLOCK ${taskId} ${agent} reason="${safeReason}"`,
				`MOVE ${taskId} ${agent} from=in-progress to=blocked`,
			]);
			return;
		}

		// blocked → in-progress (UNBLOCK + CLAIM + MOVE)
		if (fromCol === "blocked" && toCol === "in-progress") {
			const board = await parseBoard();
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) {
				vscode.window.showWarningMessage(`WIP limit reached (${wip}/${WIP_LIMIT}). Complete or block a task first.`);
				return;
			}
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await this.appendEvents([
				`UNBLOCK ${taskId} ${agent} resolution="unblocked via UI"`,
				`CLAIM ${taskId} ${agent} expires=${expires}`,
				`MOVE ${taskId} ${agent} from=blocked to=in-progress`,
			]);
			return;
		}

		// Invalid transition — should be blocked client-side, but belt-and-suspenders
		vscode.window.showWarningMessage(`Invalid move: ${taskId} from ${fromCol} to ${toCol}`);
	}

	private async handleCreate(msg: Record<string, unknown>): Promise<void> {
		const board = await parseBoard();
		// Find next available T-NNN id
		let maxNum = 0;
		for (const tid of board.tasks.keys()) {
			const n = parseInt(tid.slice(2), 10);
			if (n > maxNum) maxNum = n;
		}
		const taskId = `T-${String(maxNum + 1).padStart(3, "0")}`;
		const title = String(msg.title || "").replace(/"/g, "'");
		const priority = String(msg.priority || "medium");
		const tags = String(msg.tags || "").replace(/"/g, "'");
		if (!title) {
			vscode.window.showWarningMessage("Task title is required.");
			return;
		}
		await this.appendEvents([
			`CREATE ${taskId} vscode-kanban title="${title}" priority="${priority}" tags="${tags}"`,
		]);
		vscode.window.showInformationMessage(`Created ${taskId}: ${title}`);
	}

	private async handleEdit(msg: Record<string, unknown>): Promise<void> {
		const taskId = String(msg.taskId);
		const changes: string[] = [];
		if (msg.title) changes.push(`title="${String(msg.title).replace(/"/g, "'")}"`);
		if (msg.priority) changes.push(`priority="${String(msg.priority)}"`);
		if (msg.tags !== undefined) changes.push(`tags="${String(msg.tags).replace(/"/g, "'")}"`);
		if (changes.length === 0) return;
		await this.appendEvents([`EDIT ${taskId} vscode-kanban ${changes.join(" ")}`]);
	}

	private async handleDelete(taskId: string, title: string): Promise<void> {
		const answer = await vscode.window.showWarningMessage(
			`Delete ${taskId}: "${title}"? This cannot be undone.`,
			"Yes", "No",
		);
		if (answer !== "Yes") return;
		await this.appendEvents([
			`DELETE ${taskId} vscode-kanban reason="deleted via UI"`,
		]);
	}

	private async handleBlockAction(taskId: string): Promise<void> {
		const reason = await vscode.window.showInputBox({
			prompt: `Block reason for ${taskId}`,
			placeHolder: "e.g. waiting for dependency",
		});
		if (reason === undefined) return;
		const safeReason = (reason || "blocked via UI").replace(/"/g, "'");
		await this.appendEvents([
			`BLOCK ${taskId} vscode-kanban reason="${safeReason}"`,
			`MOVE ${taskId} vscode-kanban from=in-progress to=blocked`,
		]);
	}

	private async appendEvents(events: string[]): Promise<void> {
		try {
			const ts = nowZ();
			const lines = events.map((e) => `${ts} ${e}`).join("\n");
			await appendFile(boardLogPath(), `${lines}\n`, "utf-8");
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
