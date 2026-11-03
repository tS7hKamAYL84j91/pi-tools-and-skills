import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { paneIdentity } from "../extensions/pi-agent-hub/registry/zellij-pane.mjs";

/** Only these two fixed Zellij actions are ever run; never a shell. */
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
			if (own.length !== 1 || !Number.isSafeInteger(own[0].tab_id)) return null;
			return { panes, own: own[0] };
		} catch {
			return null;
		}
	};
	const focus = (row, rows, now = Date.now()) => {
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
		// Cwd is a corroborating check, never an identity search or fallback.
		if (
			typeof nav.cwd !== "string" ||
			!isAbsolute(nav.cwd) ||
			typeof panes[0].pane_cwd !== "string" ||
			!isAbsolute(panes[0].pane_cwd) ||
			resolve(nav.cwd) !== resolve(panes[0].pane_cwd)
		)
			return "pane identity changed";
		try {
			run([
				"--session",
				identity.sessionName,
				"action",
				"focus-pane-id",
				`terminal_${target.paneId}`,
			]);
			return null;
		} catch {
			return "pane gone or focus failed";
		}
	};
	return { inspect, focus };
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
			if (char === "q") events.push({ type: "quit" });
			else if (char === "j" || char === "k")
				events.push({ type: "move", delta: char === "j" ? 1 : -1 });
			else if (char === "\r" || char === "\n") events.push({ type: "focus" });
		}
		return events;
	};
}
