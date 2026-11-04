import { execFile, execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { paneIdentity } from "../extensions/pi-agent-hub/registry/zellij-pane.mjs";

/** Fixed Zellij queries/actions only; never a shell or input injection. */
function runZellij(args) {
	return execFileSync("zellij", args, {
		encoding: "utf8",
		timeout: 1000,
		maxBuffer: 512 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
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

export function createNavigator(identity, run = runZellij) {
	const inspectAsync = () => {
		if (!identity) return Promise.resolve(null);
		const call = (args) =>
			new Promise((resolveCall, reject) =>
				execFile(
					"zellij",
					args,
					{ encoding: "utf8", timeout: 1000, maxBuffer: 512 * 1024 },
					(error, stdout, stderr) =>
						error
							? reject(
									Object.assign(error, { status: error.code, stdout, stderr }),
								)
							: resolveCall(stdout),
				),
			);
		const args = ["--session", identity.sessionName, "action"];
		return call([...args, "list-panes", "--json", "--all"])
			.then(async (output) => {
				const panes = JSON.parse(output);
				if (!Array.isArray(panes) || panes.length > 4096) return null;
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
				if (
					panes.some(
						(p) =>
							p?.tab_id === view.tab_id &&
							p.is_plugin === false &&
							p.is_floating === true,
					)
				) {
					let visible;
					try {
						const answer = (
							await call([
								...args,
								"are-floating-panes-visible",
								"--tab-id",
								String(view.tab_id),
							])
						).trim();
						if (answer !== "true" && answer !== "false") return null;
						visible = answer === "true";
					} catch (error) {
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
			})
			.catch(() => null);
	};
	const inspect = () => {
		if (!identity) return null;
		try {
			const panes = JSON.parse(
				run([
					"--session",
					identity.sessionName,
					"action",
					"list-panes",
					"--json",
					"--all",
				]),
			);
			if (!Array.isArray(panes) || panes.length > 4096) return null;
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
				panes.some(
					(p) =>
						p?.tab_id === view.tab_id &&
						p.is_plugin === false &&
						p.is_floating === true,
				)
			) {
				let visible;
				try {
					const answer = run([
						"--session",
						identity.sessionName,
						"action",
						"are-floating-panes-visible",
						"--tab-id",
						String(view.tab_id),
					]).trim();
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
	const act = (row, rows, action, now = Date.now()) => {
		const context = inspect();
		if (!context || context.own.is_focused !== true)
			return "navigation unavailable";
		const nav = row?.navigation;
		const hint = nav?.zellij;
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
		if (action === "verify") return null;
		try {
			// Zellij 0.44.1 focus-pane-id also reveals the floating layer and raises this target.
			run([
				"--session",
				identity.sessionName,
				"action",
				...(action === "close"
					? ["close-pane", "--pane-id"]
					: ["focus-pane-id"]),
				`terminal_${target.paneId}`,
			]);
			if (action === "close") {
				const after = inspect();
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
	const create = (name, scope, lead, rows) => {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) || name.includes(".."))
			return "Invalid agent name";
		if (
			!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(scope) ||
			scope.includes("..")
		)
			return "Hub scope cannot host agents";
		if (
			name.toLowerCase() === scope ||
			rows.some((row) => row.name.toLowerCase() === name.toLowerCase())
		)
			return "Name already in use";
		const error = act(lead, rows, "verify");
		if (error) return error;
		const context = inspect();
		if (!context || context.own.is_focused !== true)
			return "navigation unavailable";
		if (
			context.panes.filter(
				(p) => p?.tab_id === context.own.tab_id && p.is_plugin === false,
			).length >= 32
		)
			return "Tab pane limit reached";
		const cwd = lead.navigation.cwd;
		try {
			const result = run([
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
				"MATRIX_BOT_PASSWORD",
				"-u",
				"MATRIX_RECOVERY_PASSPHRASE",
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
			]);
			const match = /^terminal_(\d+)\s*$/.exec(result);
			if (!match) return "Agent launch uncertain; check panes";
			const after = inspect();
			const created = after?.panes.filter(
				(p) => p?.is_plugin === false && p.id === Number(match[1]),
			);
			return created?.length === 1 &&
				created[0].tab_id === context.own.tab_id &&
				created[0].is_floating === true
				? null
				: "Agent launch uncertain; check panes";
		} catch {
			return "Agent launch uncertain; check panes";
		}
	};
	return {
		inspect,
		inspectAsync,
		create,
		focus: (row, rows, now) => act(row, rows, "focus", now),
		close: (row, rows, now) => act(row, rows, "close", now),
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
			else if (char === "y") events.push({ type: "confirm" });
			else if (char === "n") events.push({ type: "cancel" });
			else if (char === "l") events.push({ type: "lead" });
			else if (char === "q") events.push({ type: "quit" });
			else if (char === "j" || char === "k")
				events.push({ type: "move", delta: char === "j" ? 1 : -1 });
			else if (char === "\r" || char === "\n") events.push({ type: "focus" });
		}
		return events;
	};
}
