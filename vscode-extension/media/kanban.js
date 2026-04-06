/**
 * CoAS Kanban — Webview Client Script
 *
 * Renders the kanban board, handles drag-and-drop moves,
 * right-click actions, card detail view, and filtering.
 */

// @ts-check
/* global acquireVsCodeApi */

const vscode = acquireVsCodeApi();
const root = document.getElementById("kanban-root");

const COLUMNS = [
	{ id: "backlog",     icon: "📋", label: "Backlog" },
	{ id: "todo",        icon: "🔜", label: "Todo" },
	{ id: "in-progress", icon: "🔄", label: "In Progress" },
	{ id: "blocked",     icon: "🚫", label: "Blocked" },
	{ id: "done",        icon: "✅", label: "Done" },
];

let currentBoard = null;
let currentAgentModels = {};
let filterAgent = "";
let filterPriority = "";
let filterTag = "";

// ── Message handler ─────────────────────────────────────────

window.addEventListener("message", (event) => {
	const msg = event.data;
	switch (msg.type) {
		case "updateBoard":
			currentBoard = msg.board;
			currentAgentModels = msg.board.agentModels || {};
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
		if (!matchesFilter(t)) continue;
		if (buckets[t.col]) buckets[t.col].push(t);
	}

	const wipCount = (buckets["in-progress"] || []).length;
	const totalActive = order.filter((id) => tasks[id] && !tasks[id].deleted).length;

	// Collect unique agents, priorities, tags for filter dropdowns
	const agents = new Set();
	const priorities = new Set();
	const tags = new Set();
	for (const id of order) {
		const t = tasks[id];
		if (!t || t.deleted) continue;
		if (t.claimAgent) agents.add(t.claimAgent);
		if (t.agent) agents.add(t.agent);
		if (t.doneAgent) agents.add(t.doneAgent);
		priorities.add(t.priority);
		if (t.tags) t.tags.split(",").forEach((tg) => { if (tg.trim()) tags.add(tg.trim()); });
	}

	let html = renderHeader(totalActive, wipCount, board, agents, priorities, tags);
	html += `<div class="kanban-board">`;

	for (const col of COLUMNS) {
		const colTasks = buckets[col.id] || [];
		const reversed = colTasks.slice().reverse();
		const displayTasks = col.id === "done" ? reversed.slice(0, 10) : reversed;
		const countLabel = col.id === "done" && colTasks.length > 10
			? `${colTasks.length} (last 10)` : String(colTasks.length);

		html += `
			<div class="column column-${col.id}" data-col="${col.id}"
				ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${col.id}')">
				<div class="column-header">
					<span>${col.icon} ${col.label}</span>
					<span class="column-count">${countLabel}</span>
				</div>
				<div class="column-body">`;

		for (const task of displayTasks) html += renderCard(task, col.id);
		if (displayTasks.length === 0) {
			html += `<div class="empty-col">drop here</div>`;
		}
		html += `</div></div>`;
	}

	html += `</div>`;
	root.innerHTML = html;
}

// ── Header + filter bar ─────────────────────────────────────

function renderHeader(totalActive, wipCount, board, agents, priorities, tags) {
	return `
		<div class="board-header">
			<h1>CoAS Kanban</h1>
			<span class="board-meta">
				${totalActive} tasks · WIP ${wipCount}/${board.wipLimit} · ${board.totalEvents} events
			</span>
			<div class="filter-bar">
				<select onchange="setFilter('agent', this.value)" title="Filter by agent">
					<option value="">all agents</option>
					${[...agents].sort().map((a) => `<option value="${escapeHtml(a)}" ${filterAgent === a ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
				</select>
				<select onchange="setFilter('priority', this.value)" title="Filter by priority">
					<option value="">all priorities</option>
					${[...priorities].sort().map((p) => `<option value="${escapeHtml(p)}" ${filterPriority === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
				</select>
				<select onchange="setFilter('tag', this.value)" title="Filter by tag">
					<option value="">all tags</option>
					${[...tags].sort().map((t) => `<option value="${escapeHtml(t)}" ${filterTag === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
				</select>
			</div>
		</div>`;
}

function matchesFilter(task) {
	if (filterAgent && task.claimAgent !== filterAgent && task.agent !== filterAgent && task.doneAgent !== filterAgent) return false;
	if (filterPriority && task.priority !== filterPriority) return false;
	if (filterTag && !(task.tags || "").split(",").map((t) => t.trim()).includes(filterTag)) return false;
	return true;
}

// exposed globally for inline handlers
// biome-ignore lint: global function for webview
window.setFilter = function (type, value) {
	if (type === "agent") filterAgent = value;
	if (type === "priority") filterPriority = value;
	if (type === "tag") filterTag = value;
	if (currentBoard) renderBoard(currentBoard);
};

// ── Card renderer ───────────────────────────────────────────

function renderCard(task, colId) {
	const priorityClass = `priority-${task.priority}`;
	const notesCount = task.notes ? task.notes.length : 0;

	let meta = `<span class="badge badge-priority ${priorityClass}">${task.priority}</span>`;

	if (colId === "in-progress" && task.claimAgent) {
		const model = currentAgentModels[task.claimAgent];
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.claimAgent)}</span>`;
		if (model) meta += ` <span class="badge badge-model">🤖 ${escapeHtml(model)}</span>`;
	} else if (colId === "done" && task.doneAgent) {
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.doneAgent)}</span>`;
	} else if (task.agent) {
		meta += ` <span class="badge badge-agent">👤 ${escapeHtml(task.agent)}</span>`;
	}

	if (task.tags) meta += ` <span class="badge badge-tags">🏷 ${escapeHtml(task.tags)}</span>`;

	if (colId === "in-progress" && task.expires) {
		const hoursLeft = Math.round((new Date(task.expires).getTime() - Date.now()) / 3600000 * 10) / 10;
		meta += hoursLeft > 0
			? ` <span class="badge" style="color:var(--vscode-descriptionForeground)">⏱ ${hoursLeft}h</span>`
			: ` <span class="badge" style="color:var(--vscode-errorForeground)">⏱ expired</span>`;
	}
	if (colId === "blocked" && task.reason) {
		meta += ` <span class="badge" style="color:var(--vscode-errorForeground)">⛔ ${escapeHtml(task.reason)}</span>`;
	}
	if (colId === "done" && task.duration) {
		meta += ` <span class="badge" style="color:var(--vscode-descriptionForeground)">⏱ ${escapeHtml(task.duration)}</span>`;
	}

	// Notes preview — show last note snippet
	let notesHtml = "";
	if (notesCount > 0) {
		const lastNote = task.notes[task.notes.length - 1] || "";
		// Strip timestamp + agent prefix: "2026-04-05T... [agent] actual text"
		const noteText = lastNote.replace(/^\S+\s+\[[^\]]+\]\s*/, "");
		const preview = noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
		notesHtml = `<div class="card-notes-preview">📝 ${notesCount} — <em>${escapeHtml(preview)}</em></div>`;
	}

	// Created date
	const created = task.createdAt ? task.createdAt.slice(0, 10) : "";

	return `
		<div class="task-card" data-task-id="${task.id}" data-col="${colId}"
			draggable="true" ondragstart="handleDragStart(event)"
			ondblclick="showDetail('${task.id}')"
			oncontextmenu="showContextMenu(event, '${task.id}', '${colId}')">
			<div class="card-top">
				<span class="card-id">${escapeHtml(task.id)}</span>
				<span class="card-date">${escapeHtml(created)}</span>
			</div>
			<div class="card-title">${escapeHtml(task.title)}</div>
			<div class="card-meta">${meta}</div>
			${notesHtml}
		</div>`;
}

// ── Drag and drop ───────────────────────────────────────────

// biome-ignore lint: global function for webview
window.handleDragStart = function (event) {
	const card = event.target.closest(".task-card");
	if (!card) return;
	const fromCol = card.dataset.col;
	// Done cards can't be dragged
	if (fromCol === "done") { event.preventDefault(); return; }
	event.dataTransfer.setData("text/plain", card.dataset.taskId);
	event.dataTransfer.setData("application/x-col", fromCol);
	event.dataTransfer.effectAllowed = "move";
	_dragFromCol = fromCol;
	card.classList.add("dragging");
};

// Valid transitions: from → [allowed targets]
const VALID_DROPS = {
	"backlog": ["todo"],
	"todo": ["backlog", "in-progress"],
	"in-progress": ["blocked", "done"],
	"blocked": ["todo"],
	"done": [],
};

// biome-ignore lint: global function for webview
window.handleDragOver = function (event) {
	const col = event.target.closest(".column");
	if (!col) return;
	const toCol = col.dataset.col;
	const fromCol = event.dataTransfer.types.includes("application/x-col")
		? _dragFromCol : null;
	if (!fromCol || !(VALID_DROPS[fromCol] || []).includes(toCol)) {
		event.dataTransfer.dropEffect = "none";
		return;
	}
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	col.classList.add("drag-over");
};

let _dragFromCol = null;

document.addEventListener("dragleave", (event) => {
	const col = event.target.closest && event.target.closest(".column");
	if (col) col.classList.remove("drag-over");
});

// biome-ignore lint: global function for webview
window.handleDrop = function (event, toCol) {
	event.preventDefault();
	document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
	const taskId = event.dataTransfer.getData("text/plain");
	const fromCol = event.dataTransfer.getData("application/x-col");
	_dragFromCol = null;
	if (!taskId || fromCol === toCol) return;
	if (!(VALID_DROPS[fromCol] || []).includes(toCol)) return;
	vscode.postMessage({ type: "dropTask", taskId, fromCol, toCol });
};

document.addEventListener("dragend", () => {
	_dragFromCol = null;
	document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
	document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});

// ── Context menu ────────────────────────────────────────────

let contextMenu = null;

// biome-ignore lint: global function for webview
window.showContextMenu = function (event, taskId, colId) {
	event.preventDefault();
	closeContextMenu();

	const items = [];
	if (colId === "in-progress") {
		items.push({ label: "✅ Mark Complete", action: "complete" });
		items.push({ label: "🚫 Block", action: "block" });
	}
	if (colId === "blocked") {
		items.push({ label: "🔓 Unblock → Todo", action: "unblock" });
	}
	if (colId === "backlog" || colId === "todo") {
		items.push({ label: "📋 Move to Backlog", action: "moveBacklog", hidden: colId === "backlog" });
		items.push({ label: "🔜 Move to Todo", action: "moveTodo", hidden: colId === "todo" });
	}
	items.push({ label: "📝 View Notes", action: "detail" });

	const menu = document.createElement("div");
	menu.className = "context-menu";
	menu.style.left = `${event.pageX}px`;
	menu.style.top = `${event.pageY}px`;

	for (const item of items) {
		if (item.hidden) continue;
		const el = document.createElement("div");
		el.className = "context-menu-item";
		el.textContent = item.label;
		el.onclick = () => {
			closeContextMenu();
			handleContextAction(item.action, taskId, colId);
		};
		menu.appendChild(el);
	}

	document.body.appendChild(menu);
	contextMenu = menu;
};

document.addEventListener("click", closeContextMenu);
document.addEventListener("contextmenu", (e) => {
	if (!e.target.closest(".task-card")) closeContextMenu();
});

function closeContextMenu() {
	if (contextMenu) { contextMenu.remove(); contextMenu = null; }
}

function handleContextAction(action, taskId, colId) {
	switch (action) {
		case "complete":
			vscode.postMessage({ type: "completeTask", taskId });
			break;
		case "block":
			vscode.postMessage({ type: "blockTask", taskId });
			break;
		case "unblock":
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "todo" });
			break;
		case "moveBacklog":
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "backlog" });
			break;
		case "moveTodo":
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "todo" });
			break;
		case "detail":
			showDetail(taskId);
			break;
	}
}

// ── Detail pane ─────────────────────────────────────────────

// biome-ignore lint: global function for webview
window.showDetail = function (taskId) {
	if (!currentBoard) return;
	const task = currentBoard.tasks[taskId];
	if (!task) return;

	const overlay = document.createElement("div");
	overlay.className = "detail-overlay";
	overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

	const notes = (task.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("")
		|| "<li><em>no notes</em></li>";

	overlay.innerHTML = `
		<div class="detail-pane">
			<div class="detail-header">
				<span class="card-id">${escapeHtml(task.id)}</span>
				<span class="detail-close" onclick="this.closest('.detail-overlay').remove()">✕</span>
			</div>
			<h2>${escapeHtml(task.title)}</h2>
			<div class="detail-meta">
				<div>Column: <strong>${escapeHtml(task.col)}</strong></div>
				<div>Priority: <strong>${escapeHtml(task.priority)}</strong></div>
				<div>Agent: <strong>${escapeHtml(task.claimAgent || task.agent || "—")}</strong></div>
				${task.tags ? `<div>Tags: <strong>${escapeHtml(task.tags)}</strong></div>` : ""}
				${task.reason ? `<div>Blocked: <strong>${escapeHtml(task.reason)}</strong></div>` : ""}
				${task.duration ? `<div>Duration: <strong>${escapeHtml(task.duration)}</strong></div>` : ""}
			</div>
			<h3>Notes (${task.notes ? task.notes.length : 0})</h3>
			<ul class="detail-notes">${notes}</ul>
		</div>`;

	document.body.appendChild(overlay);
};

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(str) {
	if (!str) return "";
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Signal to extension host that we're ready to receive data
vscode.postMessage({ type: "ready" });
