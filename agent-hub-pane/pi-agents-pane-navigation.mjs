import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { paneIdentity } from "../extensions/pi-agent-hub/registry/zellij-pane.mjs";

/** Fixed Zellij queries/actions only; never a shell or input injection. */
function runZellij(args, { signal } = {}) {
	if (signal?.aborted) return Promise.reject(new Error("Navigation cancelled"));
	return new Promise((resolveCall, reject) => {
		let response;
		const child = execFile("zellij", args, {
			encoding: "utf8",
			timeout: args.includes("list-panes") ? 3000 : 1000,
			maxBuffer: 512 * 1024,
			signal,
		}, (error, stdout, stderr) => { response = { error, stdout, stderr }; });
		// An AbortError can precede process exit. Release the inspection slot only
		// after close, so cancelling a modal check cannot overlap the next query.
		child.once("close", () => {
			if (!response) return reject(new Error("Zellij result unavailable"));
			const { error, stdout, stderr } = response;
			if (error) reject(Object.assign(error, { status: error.code, stdout, stderr }));
			else resolveCall(stdout);
		});
	});
}

function recordPane(row) {
	const hint = row?.navigation?.zellij;
	if (
		!hint ||
		(typeof hint.paneId !== "string" && !Number.isSafeInteger(hint.paneId))
	)
		return undefined;
	return paneIdentity(hint.sessionName, String(hint.paneId));
}

const TABLE_HEADER = "TAB_ID  TAB_POS  TAB_NAME  PANE_ID  TYPE  TITLE  FOCUSED  FLOATING  EXITED";
function paneTabs(tabs) {
	if (!Array.isArray(tabs) || tabs.length > 4096) return null;
	const result = new Map(), positions = new Set();
	let total = 0;
	for (const tab of tabs) {
		if (!tab || [tab.tab_id, tab.position, tab.selectable_tiled_panes_count, tab.selectable_floating_panes_count].some((n) => !Number.isSafeInteger(n) || n < 0) ||
			typeof tab.name !== "string" || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(tab.name) ||
			typeof tab.are_floating_panes_visible !== "boolean" || result.has(tab.tab_id) || positions.has(tab.position)) return null;
		total += tab.selectable_tiled_panes_count + tab.selectable_floating_panes_count;
		if (total > 4096) return null;
		result.set(tab.tab_id, tab);
		positions.add(tab.position);
	}
	return result;
}

/** Advisory only: table fields are unescaped. Anchor names to structured tab
 * metadata and check terminal counts to reject ambiguous projections. Zellij
 * omits suppressed plugins from tab counts, but includes them in this table;
 * plugin rows are not counted. This lossy output can NEVER authorize arming,
 * mutations or success receipts. Those always use full JSON, including unselectable
 * panes and the CWD of the actual claimed pane (not /proc/<agent-pid>/cwd).
 */
export function parsePaneTable(output, tabs) {
	const byTab = paneTabs(tabs);
	if (!byTab || typeof output !== "string" || output.length > 512 * 1024) return null;
	const lines = output.replace(/\n$/, "").split("\n");
	if (lines.shift() !== TABLE_HEADER || lines.length > 4096) return null;
	const panes = [], ids = new Set(), counts = new Map();
	for (const line of lines) {
		if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line)) return null;
		const tabId = /^(0|[1-9]\d*)[ ]{2}/.exec(line);
		const tab = tabId ? byTab.get(Number(tabId[1])) : undefined;
		if (!tab) return null;
		const prefix = `${tab.tab_id}  ${tab.position}  ${tab.name}  `;
		if (!line.startsWith(prefix)) return null;
		const remainder = line.slice(prefix.length);
		const row = /^(terminal|plugin)_(0|[1-9]\d*)[ ]{2}(terminal|plugin)[ ]{2}(.*)[ ]{2}(true|false)[ ]{2}(true|false)[ ]{2}(true|false)$/.exec(remainder);
		if (!row || row[1] !== row[3] || [...remainder.matchAll(/(?:^|[ ]{2})(?:terminal|plugin)_\d+[ ]{2}(?:terminal|plugin)[ ]{2}/g)].length !== 1) return null;
		const id = Number(row[2]), key = `${row[1]}:${id}`;
		if (!Number.isSafeInteger(id) || ids.has(key)) return null;
		ids.add(key);
		const count = counts.get(tab.tab_id) ?? { tiled: 0, floating: 0 };
		const floating = row[6] === "true";
		if (row[1] === "terminal") count[floating ? "floating" : "tiled"]++;
		counts.set(tab.tab_id, count);
		panes.push({ id, is_plugin: row[1] === "plugin", tab_id: tab.tab_id,
			is_focused: row[5] === "true", is_floating: floating, exited: row[7] === "true" });
	}
	for (const tab of byTab.values()) {
		const count = counts.get(tab.tab_id) ?? { tiled: 0, floating: 0 };
		if (count.tiled !== tab.selectable_tiled_panes_count || count.floating !== tab.selectable_floating_panes_count) return null;
	}
	return panes;
}

export function createNavigator(identity, run = runZellij) {
	const inspect = async (signal, advisory = false) => {
		if (!identity || signal?.aborted) return null;
		if (advisory) {
			try {
				const args = ["--session", identity.sessionName, "action"];
				// --json on list-panes triggers per-pane process-table scans in
				// Zellij 0.44.1. list-tabs JSON does not; table mode avoids them.
				const tabs = JSON.parse(await run([...args, "list-tabs", "--json"], { signal }));
				if (signal?.aborted) return null;
				const byTab = paneTabs(tabs);
				if (!byTab) throw new Error("Unsupported tab metadata");
				const panes = parsePaneTable(await run([...args, "list-panes", "--state", "--tab"], { signal }), tabs);
				if (!panes) throw new Error("Ambiguous pane table");
				const own = panes.find((p) => !p.is_plugin && p.id === identity.paneId);
				if (!own) return null;
				return { panes, own: { ...own, is_focused: own.is_focused && own.is_floating === byTab.get(own.tab_id).are_floating_panes_visible } };
			} catch {
				// Older versions, odd names, selectable plugins, suppressed terminal
				// panes or layout churn fall back to structured data. Still advisory.
				if (signal?.aborted) return null;
			}
		}

		try {
			const panes = JSON.parse(
				await run([
					"--session",
					identity.sessionName,
					"action",
					"list-panes",
					"--json",
					"--all",
				], { signal }),
			);
			if (signal?.aborted || !Array.isArray(panes) || panes.length > 4096) return null;
			const own = panes.filter(
				(p) => p && p.is_plugin === false && p.id === identity.paneId,
			);
			if (
				own.length !== 1 ||
				!Number.isSafeInteger(own[0].tab_id) ||
				own[0].tab_id < 0
			)
				return null;
			const view = { ...own[0] };
			// Zellij reports a focused tiled pane AND a focused floating pane.
			// Only the visible layer owns input; a hidden floating target stays listed.
			if (
				view.is_focused === true &&
				panes.some(
					(p) =>
						p?.tab_id === view.tab_id &&
						p.is_plugin === false &&
						p.is_floating === true,
				)
			) {
				let visible;
				try {
					const answer = (await run([
						"--session",
						identity.sessionName,
						"action",
						"are-floating-panes-visible",
						"--tab-id",
						String(view.tab_id),
					], { signal })).trim();
					if (answer !== "true" && answer !== "false") return null;
					visible = answer === "true";
				} catch (error) {
					// 0.44.1 reports false on stderr/status 2; documented versions use stdout/status 1.
					if (
						(error.status === 2 &&
							error.stdout === "" &&
							error.stderr?.trim() === "false") ||
						(error.status === 1 && error.stdout?.trim() === "false")
					)
						visible = false;
					else return null;
				}
				view.is_focused =
					view.is_focused === true && Boolean(view.is_floating) === visible;
			}
			return { panes, own: view };
		} catch {
			return null;
		}
	};
	const validate = (row, rows, context, now, options = {}) => {
		// Delegation is a capability held by this sidebar, never a tool-supplied tab.
		if (!context) return "navigation unavailable";
		const own = context.own;
		if (options.tabId !== undefined) {
			if (!Number.isSafeInteger(options.tabId) || options.tabId < 0 ||
				own.tab_id !== options.tabId || own.exited === true ||
				own.is_selectable === false || own.is_suppressed === true)
				return "navigation unavailable";
		} else if (own.is_focused !== true) return "navigation unavailable";
		const nav = row?.navigation;
		const hint = nav?.zellij;
		if (nav?.parentId) return "subagent · no terminal";
		if (!hint) return "no pane metadata; reload Hub";
		const target = recordPane(row);
		if (!target) return "invalid pane metadata";
		if (target.sessionName !== identity.sessionName)
			return "no pane in this session";
		if (nav.parentId || target.paneId === identity.paneId)
			return "no separate agent pane";
		if (
			row.state !== "live" ||
			row.status === "terminated" ||
			!Number.isFinite(row.heartbeat) ||
			now - row.heartbeat < 0 ||
			now - row.heartbeat > 30_000
		)
			return "agent observation is stale";
		const claims = rows.filter((r) => {
			const claim = recordPane(r);
			return (
				claim?.sessionName === target.sessionName &&
				claim?.paneId === target.paneId
			);
		});
		if (claims.length !== 1) return "ambiguous agent pane";
		const panes = context.panes.filter(
			(p) => p && p.is_plugin === false && p.id === target.paneId,
		);
		if (panes.length !== 1 || panes[0].tab_id !== context.own.tab_id)
			return "no pane in this tab";
		if (
			panes[0].exited === true ||
			panes[0].is_selectable === false ||
			panes[0].is_suppressed === true
		)
			return "pane is unavailable";
		// Cwd is a corroborating check, never an identity search or fallback.
		if (
			typeof nav.cwd !== "string" ||
			!isAbsolute(nav.cwd) ||
			typeof panes[0].pane_cwd !== "string" ||
			!isAbsolute(panes[0].pane_cwd) ||
			resolve(nav.cwd) !== resolve(panes[0].pane_cwd)
		)
			return "pane identity changed";
		return null;
	};
	const current = (options) => !options.signal?.aborted && options.current?.() !== false;
	const refresh = (row, rows, options) => options.refresh ? options.refresh() : { row, rows };
	const act = async (row, rows, action, now, options = {}) => {
		const context = await inspect(options.signal);
		if (!current(options)) return "Action cancelled";
		const fresh = refresh(row, rows, options);
		if (!fresh) return "Action cancelled: agent changed";
		const error = validate(fresh.row, fresh.rows, context, now ?? Date.now());
		if (error) return error;
		const target = recordPane(fresh.row);
		try {
			// Cancellation is checked after the await, immediately before dispatch.
			if (!current(options)) return "Action cancelled";
			options.onDispatch?.();
			// Zellij 0.44.1 focus-pane-id reveals the floating layer and raises this target.
			await run([
				"--session",
				identity.sessionName,
				"action",
				...(action === "close"
					? ["close-pane", "--pane-id"]
					: ["focus-pane-id"]),
				`terminal_${target.paneId}`,
			], { signal: options.signal });
			if (action === "close") {
				const after = await inspect(options.signal);
				if (
					!after ||
					after.panes.some(
						(p) => p && p.is_plugin === false && p.id === target.paneId,
					)
				)
					return "Close not verified";
			}
			return null;
		} catch {
			return action === "close"
				? "pane gone or close failed"
				: "pane gone or focus failed";
		}
	};
	const create = async (name, scope, lead, rows, options = {}) => {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) || name.includes(".."))
			return "Invalid agent name";
		if (
			!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(scope) ||
			scope.includes("..")
		)
			return "Hub scope cannot host agents";
		const context = await inspect(options.signal);
		if (!current(options)) return "Action cancelled";
		const fresh = refresh(lead, rows, options);
		if (!fresh) return "Create cancelled: state changed";
		if (
			name.toLowerCase() === scope ||
			fresh.rows.some((row) => row.name.toLowerCase() === name.toLowerCase())
		)
			return "Name already in use";
		const error = validate(fresh.row, fresh.rows, context, Date.now(), options);
		if (error) return error;
		const limit = options.paneLimit ?? 32;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) return "Invalid tab pane limit";
		if (
			context.panes.filter(
				(p) => p?.tab_id === context.own.tab_id && p.is_plugin === false,
			).length >= limit
		)
			return "Tab pane limit reached";
		const cwd = fresh.row.navigation.cwd;
		try {
			if (!current(options)) return "Action cancelled";
			options.onDispatch?.();
			const result = await run([
				"--session",
				identity.sessionName,
				"action",
				"new-pane",
				"--tab-id",
				String(context.own.tab_id),
				"--floating",
				"--cwd",
				cwd,
				"--name",
				name,
				"--",
				"env",
				"-u",
				"MATRIX_ACCESS_TOKEN",
				"-u",
				"MATRIX_BOT_TOKEN",
				"-u",
				"MATRIX_BOT_PASSWORD",
				"-u",
				"MATRIX_RECOVERY_PASSPHRASE",
				"-u",
				"HUB_SIDEBAR_TOKEN",
				"-u",
				"PI_PANOPTICON_PARENT_ID",
				"-u",
				"PI_CODING_AGENT_SESSION_DIR",
				"PI_MATRIX_DISABLED=1",
				`PI_PANOPTICON_NAMESPACE=${scope}`,
				`PI_PANOPTICON_SPAWN_NAME=${name}`,
				"pi",
				"--name",
				name,
			], { signal: options.signal });
			const match = /^terminal_(\d+)\s*$/.exec(result);
			if (!match) return "Agent launch uncertain; check panes";
			const after = await inspect(options.signal);
			const created = after?.panes.filter(
				(p) => p?.is_plugin === false && p.id === Number(match[1]),
			);
			return created?.length === 1 &&
				created[0].tab_id === context.own.tab_id &&
				created[0].is_floating === true && created[0].exited !== true
				? null
				: "Agent launch uncertain; check panes";
		} catch {
			return "Agent launch uncertain; check panes";
		}
	};
	return {
		inspect,
		create,
		check: validate,
		focus: (row, rows, now, options) => act(row, rows, "focus", now, options),
		close: (row, rows, now, options) => act(row, rows, "close", now, options),
	};
}

/** Bounded incremental decoder. Paste and control-string payloads never become actions. */
export function inputParser() {
	let mode = "text",
		sequence = "",
		pasteEnd = 0,
		stringEscape = false;
	const endPaste = "\x1b[201~";
	return (data) => {
		const events = [];
		for (const char of data.toString()) {
			if (mode === "paste") {
				pasteEnd =
					char === endPaste[pasteEnd] ? pasteEnd + 1 : char === "\x1b" ? 1 : 0;
				if (pasteEnd === endPaste.length) {
					mode = "text";
					pasteEnd = 0;
				}
				continue;
			}
			if (mode === "string") {
				if (char === "\x07" || (stringEscape && char === "\\")) mode = "text";
				stringEscape = char === "\x1b";
				continue;
			}
			if (char === "\x03") {
				events.push({ type: "quit" });
				continue;
			}
			if (char === "\x1b") {
				mode = "escape";
				sequence = "";
				continue;
			}
			if (char === "\u009b") {
				mode = "csi";
				sequence = "";
				continue;
			}
			if (char === "\u009d" || char === "\u0090") {
				mode = "string";
				stringEscape = false;
				continue;
			}
			if (mode === "discard") continue; // malformed sequences resume only at a fresh ESC boundary
			if (mode === "escape") {
				mode =
					char === "[" ? "csi" : "]P^_".includes(char) ? "string" : "discard";
				continue;
			}
			if (mode === "csi") {
				sequence += char;
				if (sequence.length > 64) {
					mode = "discard";
					sequence = "";
					continue;
				}
				if (sequence.startsWith("<") && !/^<[0-9;]*[mM]?$/.test(sequence)) {
					mode = "discard";
					sequence = "";
					continue;
				}
				if (char < "@" || char > "~") continue;
				mode = "text";
				if (sequence === "200~") {
					mode = "paste";
					pasteEnd = 0;
				} else if (sequence === "A" || sequence === "B")
					events.push({ type: "move", delta: sequence === "A" ? -1 : 1 });
				else {
					const mouse = /^<0;(\d+);(\d+)M$/.exec(sequence);
					if (mouse)
						events.push({
							type: "click",
							x: Number(mouse[1]),
							y: Number(mouse[2]),
						});
					else if (
						!/^<\d+;\d+;\d+[mM]$/.test(sequence) &&
						!["C", "D", "H", "F", "I", "O", "201~"].includes(sequence)
					)
						mode = "discard";
				}
				sequence = "";
				continue;
			}
			if (char === "c") events.push({ type: "close" });
			else if (char === "y" || char === "Y") events.push({ type: "confirm" });
			else if (char === "n" || char === "N") events.push({ type: "cancel" });
			else if (char === "l") events.push({ type: "lead" });
			else if (char === "q") events.push({ type: "quit" });
			else if (char === "j" || char === "k")
				events.push({ type: "move", delta: char === "j" ? 1 : -1 });
			else if (char === "\r" || char === "\n") events.push({ type: "focus" });
		}
		return events;
	};
}
