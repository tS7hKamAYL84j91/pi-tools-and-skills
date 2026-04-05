/**
 * CoAS Kanban — Webview Client Script
 *
 * Receives board state from the extension host via postMessage
 * and renders it as a kanban board with columns and cards.
 */

// @ts-check
/* global acquireVsCodeApi */

const _vscode = acquireVsCodeApi();
const root = document.getElementById("kanban-root");

const COLUMNS = [
	{ id: "backlog",     icon: "📋", label: "Backlog" },
	{ id: "todo",        icon: "🔜", label: "Todo" },
	{ id: "in-progress", icon: "🔄", label: "In Progress" },
	{ id: "blocked",     icon: "🚫", label: "Blocked" },
	{ id: "done",        icon: "✅", label: "Done" },
];

// ── Message handler ─────────────────────────────────────────

window.addEventListener("message", (event) => {
	const msg = event.data;
	switch (msg.type) {
		case "updateBoard":
			renderBoard(msg.board);
			break;
		case "error":
			root.innerHTML = `<div class="error">⚠️ ${escapeHtml(msg.message)}</div>`;
			break;
	}
});

// ── Board renderer ──────────────────────────────────────────

function renderBoard(board) {
	const tasks = board.tasks;
	const order = board.order;

	// Bucket tasks by column
	const buckets = {};
	for (const col of COLUMNS) buckets[col.id] = [];
	for (const id of order) {
		const t = tasks[id];
		if (!t || t.deleted) continue;
		if (buckets[t.col]) buckets[t.col].push(t);
	}

	const wipCount = buckets["in-progress"].length;
	const totalActive = order.filter((id) => tasks[id] && !tasks[id].deleted).length;

	// Header
	let html = `
		<div class="board-header">
			<h1>CoAS Kanban</h1>
			<span class="board-meta">
				${totalActive} tasks · WIP ${wipCount}/${board.wipLimit} · ${board.totalEvents} events
			</span>
		</div>
		<div class="kanban-board">`;

	// Columns
	for (const col of COLUMNS) {
		const colTasks = buckets[col.id];
		// For done column, show only last 10
		const displayTasks = col.id === "done" ? colTasks.slice(-10) : colTasks;
		const countLabel = col.id === "done" && colTasks.length > 10
			? `${colTasks.length} (last 10)`
			: String(colTasks.length);

		html += `
			<div class="column column-${col.id}">
				<div class="column-header">
					<span>${col.icon} ${col.label}</span>
					<span class="column-count">${countLabel}</span>
				</div>
				<div class="column-body">`;

		for (const task of displayTasks) {
			html += renderCard(task, col.id);
		}

		if (displayTasks.length === 0) {
			html += `<div class="loading" style="padding:16px;font-size:0.85em;">empty</div>`;
		}

		html += `</div></div>`;
	}

	html += `</div>`;
	root.innerHTML = html;
}

// ── Card renderer ───────────────────────────────────────────

function renderCard(task, colId) {
	const priorityClass = `priority-${task.priority}`;
	const notesCount = task.notes ? task.notes.length : 0;

	let meta = `<span class="badge badge-priority ${priorityClass}">${task.priority}</span>`;

	// Show agent in relevant columns
	if (colId === "in-progress" && task.claimAgent) {
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.claimAgent)}</span>`;
	} else if (colId === "done" && task.doneAgent) {
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.doneAgent)}</span>`;
	} else if (task.agent) {
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.agent)}</span>`;
	}

	if (task.tags) {
		meta += ` <span class="badge badge-tags">🏷 ${escapeHtml(task.tags)}</span>`;
	}

	if (notesCount > 0) {
		meta += ` <span class="badge badge-notes">📝 ${notesCount}</span>`;
	}

	if (colId === "in-progress" && task.expires) {
		const expiresDate = new Date(task.expires);
		const now = new Date();
		const hoursLeft = Math.round((expiresDate.getTime() - now.getTime()) / 3600000 * 10) / 10;
		if (hoursLeft > 0) {
			meta += ` <span class="badge" style="color:var(--vscode-descriptionForeground)">⏱ ${hoursLeft}h</span>`;
		} else {
			meta += ` <span class="badge" style="color:var(--vscode-errorForeground)">⏱ expired</span>`;
		}
	}

	if (colId === "blocked" && task.reason) {
		meta += ` <span class="badge" style="color:var(--vscode-errorForeground)">⛔ ${escapeHtml(task.reason.slice(0, 40))}</span>`;
	}

	if (colId === "done" && task.duration) {
		meta += ` <span class="badge" style="color:var(--vscode-descriptionForeground)">⏱ ${escapeHtml(task.duration)}</span>`;
	}

	return `
		<div class="task-card" data-task-id="${task.id}">
			<div class="card-top">
				<span class="card-id">${escapeHtml(task.id)}</span>
			</div>
			<div class="card-title">${escapeHtml(task.title)}</div>
			<div class="card-meta">${meta}</div>
		</div>`;
}

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(str) {
	if (!str) return "";
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
