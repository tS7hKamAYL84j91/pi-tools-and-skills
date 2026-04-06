/**
 * CoAS Kanban — Webview Client Script
 *
 * Renders the kanban board, handles drag-and-drop moves,
 * right-click actions, card detail view, and filtering.
 * All event handlers use addEventListener (no inline handlers).
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

		html += `<div class="column column-${col.id}" data-col="${col.id}">
			<div class="column-header">
				<span>${col.icon} ${col.label}</span>
				<span class="column-count">${countLabel}</span>
			</div>
			<div class="column-body">`;
		for (const task of displayTasks) html += renderCard(task, col.id);
		if (displayTasks.length === 0) html += `<div class="empty-col">drop here</div>`;
		html += `</div></div>`;
	}

	html += `</div>`;
	root.innerHTML = html;
	attachListeners();
}

// ── Header + filters ────────────────────────────────────────

function renderHeader(totalActive, wipCount, board, agents, priorities, tags) {
	const opts = (set, current) => [...set].sort().map((v) =>
		`<option value="${escapeHtml(v)}" ${current === v ? "selected" : ""}>${escapeHtml(v)}</option>`
	).join("");
	return `<div class="board-header">
		<h1>CoAS Kanban</h1>
		<span class="board-meta">${totalActive} tasks · WIP ${wipCount}/${board.wipLimit} · ${board.totalEvents} events</span>
		<button class="btn-create" data-action="toggle-create" title="Create task">➕ New Task</button>
		<div class="filter-bar">
			<select data-filter="agent" title="Filter by agent">
				<option value="">all agents</option>${opts(agents, filterAgent)}
			</select>
			<select data-filter="priority" title="Filter by priority">
				<option value="">all priorities</option>${opts(priorities, filterPriority)}
			</select>
			<select data-filter="tag" title="Filter by tag">
				<option value="">all tags</option>${opts(tags, filterTag)}
			</select>
		</div>
	</div>
	<div class="create-form" style="display:none">
		<input data-field="title" type="text" placeholder="Task title" />
		<select data-field="priority">
			<option value="medium">medium</option>
			<option value="critical">critical</option>
			<option value="high">high</option>
			<option value="low">low</option>
		</select>
		<input data-field="tags" type="text" placeholder="Tags (comma-separated)" />
		<button data-action="submit-create">✅ Create</button>
		<button data-action="cancel-create">❌</button>
	</div>`;
}

function matchesFilter(task) {
	if (filterAgent && task.claimAgent !== filterAgent && task.agent !== filterAgent && task.doneAgent !== filterAgent) return false;
	if (filterPriority && task.priority !== filterPriority) return false;
	if (filterTag && !(task.tags || "").split(",").map((t) => t.trim()).includes(filterTag)) return false;
	return true;
}

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

	let notesHtml = "";
	if (notesCount > 0) {
		const lastNote = task.notes[task.notes.length - 1] || "";
		const noteText = lastNote.replace(/^\S+\s+\[[^\]]+\]\s*/, "");
		const preview = noteText.length > 80 ? noteText.slice(0, 80) + "…" : noteText;
		notesHtml = `<div class="card-notes-preview">📝 ${notesCount} — <em>${escapeHtml(preview)}</em></div>`;
	}

	const created = task.createdAt ? task.createdAt.slice(0, 10) : "";
	const draggable = colId !== "done";

	return `<div class="task-card" data-task-id="${task.id}" data-col="${colId}" ${draggable ? 'draggable="true"' : ""}>
		<div class="card-top">
			<span class="card-id">${escapeHtml(task.id)}</span>
			<span class="card-date">${escapeHtml(created)}</span>
		</div>
		<div class="card-title">${escapeHtml(task.title)}</div>
		<div class="card-meta">${meta}</div>
		${notesHtml}
	</div>`;
}

// ── Event listeners (attached after each render) ────────────

const VALID_DROPS = {
	"backlog": ["todo"],
	"todo": ["backlog", "in-progress"],
	"in-progress": ["blocked", "done"],
	"blocked": ["in-progress"],
	"done": [],
};

let dragFromCol = null;
let dragTaskId = null;

function attachListeners() {
	// Filter selects
	for (const sel of root.querySelectorAll("select[data-filter]")) {
		sel.addEventListener("change", () => {
			const f = sel.dataset.filter;
			if (f === "agent") filterAgent = sel.value;
			if (f === "priority") filterPriority = sel.value;
			if (f === "tag") filterTag = sel.value;
			if (currentBoard) renderBoard(currentBoard);
		});
	}

	// Create task form
	const toggleBtn = root.querySelector('[data-action="toggle-create"]');
	const createForm = root.querySelector(".create-form");
	if (toggleBtn && createForm) {
		toggleBtn.addEventListener("click", () => {
			createForm.style.display = createForm.style.display === "none" ? "flex" : "none";
		});
		const cancelBtn = createForm.querySelector('[data-action="cancel-create"]');
		if (cancelBtn) cancelBtn.addEventListener("click", () => { createForm.style.display = "none"; });
		const submitBtn = createForm.querySelector('[data-action="submit-create"]');
		if (submitBtn) submitBtn.addEventListener("click", () => {
			const title = createForm.querySelector('[data-field="title"]').value.trim();
			const priority = createForm.querySelector('[data-field="priority"]').value;
			const tags = createForm.querySelector('[data-field="tags"]').value.trim();
			if (!title) return;
			vscode.postMessage({ type: "createTask", title, priority, tags });
			createForm.style.display = "none";
		});
		// Enter key submits
		const titleInput = createForm.querySelector('[data-field="title"]');
		if (titleInput) titleInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submitBtn.click();
		});
	}

	// Card events
	for (const card of root.querySelectorAll(".task-card")) {
		card.addEventListener("dragstart", (e) => {
			const col = card.dataset.col;
			if (col === "done") { e.preventDefault(); return; }
			e.dataTransfer.setData("text/plain", card.dataset.taskId);
			e.dataTransfer.effectAllowed = "move";
			dragFromCol = col;
			dragTaskId = card.dataset.taskId;
			card.classList.add("dragging");
		});
		card.addEventListener("dblclick", () => showDetail(card.dataset.taskId));
		card.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			showContextMenu(e, card.dataset.taskId, card.dataset.col);
		});
	}

	// Column drop targets
	for (const col of root.querySelectorAll(".column")) {
		col.addEventListener("dragover", (e) => {
			if (!dragFromCol) return;
			const toCol = col.dataset.col;
			const valid = (VALID_DROPS[dragFromCol] || []).includes(toCol);
			// Must always preventDefault to allow drop
			e.preventDefault();
			e.dataTransfer.dropEffect = valid ? "move" : "none";
			if (valid) col.classList.add("drag-over");
		});
		col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
		col.addEventListener("drop", (e) => {
			e.preventDefault();
			col.classList.remove("drag-over");
			const toCol = col.dataset.col;
			const fromCol = dragFromCol;
			const taskId = dragTaskId;
			dragFromCol = null;
			dragTaskId = null;
			if (!taskId || fromCol === toCol) return;
			if (!(VALID_DROPS[fromCol] || []).includes(toCol)) return;
			vscode.postMessage({ type: "dropTask", taskId, fromCol, toCol });
		});
	}
}

document.addEventListener("dragend", () => {
	dragFromCol = null;
	dragTaskId = null;
	root.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
	root.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});

// ── Context menu ────────────────────────────────────────────

let contextMenu = null;

function showContextMenu(event, taskId, colId) {
	closeContextMenu();
	const items = [];
	if (colId === "in-progress") {
		items.push({ label: "✅ Mark Complete", action: "complete" });
		items.push({ label: "🚫 Block", action: "block" });
	}
	if (colId === "blocked") items.push({ label: "🔓 Unblock → In Progress", action: "unblock" });
	if (colId === "backlog") items.push({ label: "🔜 Move to Todo", action: "moveTodo" });
	if (colId === "todo") items.push({ label: "📋 Move to Backlog", action: "moveBacklog" });
	if (colId === "backlog" || colId === "todo") items.push({ label: "✏️ Edit", action: "edit" });
	items.push({ label: "📝 View Notes", action: "detail" });

	const menu = document.createElement("div");
	menu.className = "context-menu";
	menu.style.left = `${event.pageX}px`;
	menu.style.top = `${event.pageY}px`;

	for (const item of items) {
		const el = document.createElement("div");
		el.className = "context-menu-item";
		el.textContent = item.label;
		el.addEventListener("click", () => {
			closeContextMenu();
			handleContextAction(item.action, taskId, colId);
		});
		menu.appendChild(el);
	}
	document.body.appendChild(menu);
	contextMenu = menu;
}

document.addEventListener("click", closeContextMenu);

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
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "in-progress" });
			break;
		case "moveBacklog":
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "backlog" });
			break;
		case "moveTodo":
			vscode.postMessage({ type: "dropTask", taskId, fromCol: colId, toCol: "todo" });
			break;
		case "edit":
			showEditForm(taskId);
			break;
		case "detail":
			showDetail(taskId);
			break;
	}
}

// ── Edit form ──────────────────────────────────────────

function showEditForm(taskId) {
	if (!currentBoard) return;
	const task = currentBoard.tasks[taskId];
	if (!task) return;

	const overlay = document.createElement("div");
	overlay.className = "detail-overlay";
	overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

	const pane = document.createElement("div");
	pane.className = "detail-pane";
	pane.innerHTML = `
		<div class="detail-header">
			<span class="card-id">${escapeHtml(task.id)} — Edit</span>
			<span class="detail-close">✕</span>
		</div>
		<div class="edit-form">
			<label>Title</label>
			<input data-field="title" type="text" value="${escapeHtml(task.title)}" />
			<label>Priority</label>
			<select data-field="priority">
				<option value="critical" ${task.priority === "critical" ? "selected" : ""}>critical</option>
				<option value="high" ${task.priority === "high" ? "selected" : ""}>high</option>
				<option value="medium" ${task.priority === "medium" ? "selected" : ""}>medium</option>
				<option value="low" ${task.priority === "low" ? "selected" : ""}>low</option>
			</select>
			<label>Tags</label>
			<input data-field="tags" type="text" value="${escapeHtml(task.tags)}" />
			<div class="edit-actions">
				<button data-action="save-edit">✅ Save</button>
				<button data-action="cancel-edit">❌ Cancel</button>
			</div>
		</div>`;

	pane.querySelector(".detail-close").addEventListener("click", () => overlay.remove());
	pane.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => overlay.remove());
	pane.querySelector('[data-action="save-edit"]').addEventListener("click", () => {
		const title = pane.querySelector('[data-field="title"]').value.trim();
		const priority = pane.querySelector('[data-field="priority"]').value;
		const tags = pane.querySelector('[data-field="tags"]').value.trim();
		const msg = { type: "editTask", taskId };
		if (title && title !== task.title) msg.title = title;
		if (priority !== task.priority) msg.priority = priority;
		if (tags !== task.tags) msg.tags = tags;
		if (msg.title || msg.priority || msg.tags) vscode.postMessage(msg);
		overlay.remove();
	});

	overlay.appendChild(pane);
	document.body.appendChild(overlay);
	pane.querySelector('[data-field="title"]').focus();
}

// ── Detail pane ─────────────────────────────────────────────

function showDetail(taskId) {
	if (!currentBoard) return;
	const task = currentBoard.tasks[taskId];
	if (!task) return;

	const isDone = task.col === "done";

	const overlay = document.createElement("div");
	overlay.className = "detail-overlay";
	overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

	const notes = (task.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("")
		|| "<li><em>no notes</em></li>";

	const agentDisplay = escapeHtml(task.doneAgent || task.claimAgent || task.agent || "—");

	const pane = document.createElement("div");
	pane.className = "detail-pane";

	if (isDone) {
		pane.innerHTML = `
			<div class="detail-header">
				<span class="card-id">${escapeHtml(task.id)}</span>
				<span class="detail-close">✕</span>
			</div>
			<h2>${escapeHtml(task.title)}</h2>
			<div class="detail-meta">
				<div>Column: <strong>${escapeHtml(task.col)}</strong></div>
				<div>Priority: <strong>${escapeHtml(task.priority)}</strong></div>
				<div>Agent: <strong>${agentDisplay}</strong></div>
				${task.tags ? `<div>Tags: <strong>${escapeHtml(task.tags)}</strong></div>` : ""}
				${task.duration ? `<div>Duration: <strong>${escapeHtml(task.duration)}</strong></div>` : ""}
			</div>
			<h3>Notes (${task.notes ? task.notes.length : 0})</h3>
			<ul class="detail-notes">${notes}</ul>
			<div class="add-note-form">
				<input data-field="note-text" type="text" placeholder="Add a note..." />
				<button data-action="submit-note">📝 Add</button>
			</div>`;
	} else {
		const origTitle = task.title;
		const origPriority = task.priority;
		const origTags = task.tags || "";

		pane.innerHTML = `
			<div class="detail-header">
				<span class="card-id">${escapeHtml(task.id)}</span>
				<span class="detail-close">✕</span>
			</div>
			<div class="detail-edit-fields">
				<label>Title</label>
				<input data-field="edit-title" type="text" value="${escapeHtml(task.title)}" />
				<label>Priority</label>
				<select data-field="edit-priority">
					<option value="critical" ${task.priority === "critical" ? "selected" : ""}>critical</option>
					<option value="high" ${task.priority === "high" ? "selected" : ""}>high</option>
					<option value="medium" ${task.priority === "medium" ? "selected" : ""}>medium</option>
					<option value="low" ${task.priority === "low" ? "selected" : ""}>low</option>
				</select>
				<label>Tags</label>
				<input data-field="edit-tags" type="text" value="${escapeHtml(task.tags || "")}" placeholder="comma-separated" />
			</div>
			<div class="detail-edit-actions" style="display:none">
				<button data-action="save-inline-edit">✅ Save</button>
				<button data-action="cancel-inline-edit">↩ Revert</button>
			</div>
			<div class="detail-meta">
				<div>Column: <strong>${escapeHtml(task.col)}</strong></div>
				<div>Agent: <strong>${agentDisplay}</strong></div>
				${task.reason ? `<div>Blocked: <strong>${escapeHtml(task.reason)}</strong></div>` : ""}
			</div>
			<h3>Notes (${task.notes ? task.notes.length : 0})</h3>
			<ul class="detail-notes">${notes}</ul>
			<div class="add-note-form">
				<input data-field="note-text" type="text" placeholder="Add a note..." />
				<button data-action="submit-note">📝 Add</button>
			</div>`;

		// Inline edit: show save/revert only when something has changed
		const titleInput = pane.querySelector('[data-field="edit-title"]');
		const prioritySelect = pane.querySelector('[data-field="edit-priority"]');
		const tagsInput = pane.querySelector('[data-field="edit-tags"]');
		const editActions = pane.querySelector('.detail-edit-actions');

		const checkChanges = () => {
			const changed = titleInput.value.trim() !== origTitle
				|| prioritySelect.value !== origPriority
				|| tagsInput.value.trim() !== origTags;
			editActions.style.display = changed ? "flex" : "none";
		};
		titleInput.addEventListener("input", checkChanges);
		prioritySelect.addEventListener("change", checkChanges);
		tagsInput.addEventListener("input", checkChanges);

		pane.querySelector('[data-action="save-inline-edit"]').addEventListener("click", () => {
			const title = titleInput.value.trim();
			if (!title) return; // don't allow empty title
			const priority = prioritySelect.value;
			const tags = tagsInput.value.trim();
			let hasChanges = false;
			const msgData = { type: "editTask", taskId };
			if (title !== origTitle) { msgData.title = title; hasChanges = true; }
			if (priority !== origPriority) { msgData.priority = priority; hasChanges = true; }
			if (tags !== origTags) { msgData.tags = tags; hasChanges = true; }
			if (hasChanges) vscode.postMessage(msgData);
			overlay.remove();
		});

		pane.querySelector('[data-action="cancel-inline-edit"]').addEventListener("click", () => {
			titleInput.value = origTitle;
			prioritySelect.value = origPriority;
			tagsInput.value = origTags;
			editActions.style.display = "none";
		});
	}

	// Close button (both done and non-done)
	pane.querySelector(".detail-close").addEventListener("click", () => overlay.remove());

	// Add note (both done and non-done)
	const noteInput = pane.querySelector('[data-field="note-text"]');
	const noteBtn = pane.querySelector('[data-action="submit-note"]');
	noteBtn.addEventListener("click", () => {
		const text = noteInput.value.trim();
		if (!text) return;
		vscode.postMessage({ type: "addNote", taskId, text });
		overlay.remove();
	});
	noteInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") noteBtn.click();
	});

	overlay.appendChild(pane);
	document.body.appendChild(overlay);
}

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(str) {
	if (!str) return "";
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Signal ready
vscode.postMessage({ type: "ready" });
