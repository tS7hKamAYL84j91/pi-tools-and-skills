/**
 * Cockpit session wiring tests: extension-UI dialog mapping, response shapes,
 * disconnect visibility, and error surfacing.
 */
import { describe, expect, it } from "vitest";

import {
	type Dialog,
	type UiState,
	applyTransportEvent,
	dialogResponse,
} from "../../pi-cockpit/index.ts";
import { CockpitTranscript } from "../../pi-cockpit/conversation.ts";

function state(): UiState {
	return {
		workspace: "/tmp/ws",
		connection: { kind: "connected" },
		transcript: new CockpitTranscript(),
		decisions: undefined,
		dialog: undefined,
		decisionsOpen: false,
	};
}

function captureDialog(ui: UiState, record: Record<string, unknown>): Dialog | undefined {
	let captured: Dialog | undefined;
	applyTransportEvent(ui, { kind: "record", record: { type: "extension_ui_request", ...record } }, {
		onDialog: (dialog) => {
			captured = dialog;
		},
	});
	return captured;
}

describe("cockpit dialogs", () => {
	it("maps select to a choice dialog and replies with the chosen value", () => {
		const dialog = captureDialog(state(), {
			id: "ui-1",
			method: "select",
			title: "Allow?",
			options: ["Allow", "Block"],
		});
		expect(dialog?.kind).toBe("choice");
		expect(dialogResponse(dialog as Dialog, "Allow")).toEqual({
			type: "extension_ui_response",
			id: "ui-1",
			value: "Allow",
		});
		expect(dialogResponse(dialog as Dialog, undefined)).toEqual({
			type: "extension_ui_response",
			id: "ui-1",
			cancelled: true,
		});
	});

	it("maps confirm to Yes/No and replies with confirmed booleans", () => {
		const dialog = captureDialog(state(), {
			id: "ui-2",
			method: "confirm",
			title: "Clear?",
			message: "All messages will be lost.",
		});
		expect(dialog?.kind).toBe("choice");
		expect(dialogResponse(dialog as Dialog, "Yes")).toEqual({
			type: "extension_ui_response",
			id: "ui-2",
			confirmed: true,
		});
		expect(dialogResponse(dialog as Dialog, "No")).toEqual({
			type: "extension_ui_response",
			id: "ui-2",
			confirmed: false,
		});
	});

	it("maps input and editor to a text dialog", () => {
		const input = captureDialog(state(), { id: "ui-3", method: "input", title: "Value" });
		expect(input?.kind).toBe("text");
		expect(dialogResponse(input as Dialog, "typed")).toEqual({
			type: "extension_ui_response",
			id: "ui-3",
			value: "typed",
		});

		const editor = captureDialog(state(), {
			id: "ui-4",
			method: "editor",
			title: "Compose",
			prefill: "one\ntwo",
		});
		expect(editor?.kind).toBe("text");
	});

	it("documents unsupported custom-extension UI instead of hiding it", () => {
		const ui = state();
		const dialog = captureDialog(ui, { id: "ui-5", method: "custom", title: "Widget" });
		expect(dialog).toBeUndefined();
		const note = ui.transcript.rowsView.at(-1);
		expect(note?.role).toBe("system");
		expect(note?.text).toContain("unsupported extension UI request");
	});

	it("surfaces fire-and-forget calls as notes", () => {
		const ui = state();
		applyTransportEvent(
			ui,
			{
				kind: "record",
				record: { type: "extension_ui_request", id: "ui-6", method: "notify", message: "heads up" },
			},
			{ onDialog: () => {} },
		);
		expect(ui.transcript.rowsView.at(-1)?.text).toContain("heads up");
	});
});

describe("cockpit transport events", () => {
	it("records a fault disconnect with uncertain command ids", () => {
		const ui = state();
		applyTransportEvent(
			ui,
			{
				kind: "disconnected",
				cause: "exit",
				fault: true,
				reason: "agent exited (code 3)",
				uncertainIds: ["risky-1"],
				exitCode: 3,
			},
			{ onDialog: () => {} },
		);
		expect(ui.connection).toEqual({
			kind: "disconnected",
			cause: "exit",
			fault: true,
			reason: "agent exited (code 3)",
			uncertainIds: ["risky-1"],
		});
		const notes = ui.transcript.rowsView.map((row) => row.text);
		expect(notes.some((text) => text.includes("disconnected: agent exited"))).toBe(true);
		expect(notes.some((text) => text.includes("not retried automatically"))).toBe(true);
	});

	it("does not report an intentional cockpit stop as an error", () => {
		const ui = state();
		applyTransportEvent(
			ui,
			{
				kind: "disconnected",
				cause: "client-stop",
				fault: false,
				reason: "stopped by cockpit",
				uncertainIds: [],
				exitCode: null,
			},
			{ onDialog: () => {} },
		);
		expect(ui.connection.kind).toBe("disconnected");
		expect(ui.transcript.runState.lastError).toBeUndefined();
	});

	it("records parse errors and failed responses as visible errors", () => {
		const ui = state();
		applyTransportEvent(ui, { kind: "parse-error", line: "{", error: "bad json" }, { onDialog: () => {} });
		expect(ui.transcript.runState.lastError).toContain("bad json");

		applyTransportEvent(
			ui,
			{
				kind: "record",
				record: { type: "response", command: "set_model", success: false, error: "Model not found" },
			},
			{ onDialog: () => {} },
		);
		expect(ui.transcript.runState.lastError).toContain("Model not found");
	});

	it("seeds the session name and streaming state from get_state", () => {
		const ui = state();
		applyTransportEvent(
			ui,
			{
				kind: "record",
				record: {
					type: "response",
					command: "get_state",
					success: true,
					data: { sessionName: "poc", isStreaming: true },
				},
			},
			{ onDialog: () => {} },
		);
		expect(ui.transcript.runState.sessionName).toBe("poc");
		expect(ui.transcript.runState.streaming).toBe(true);
	});

	it("ignores stderr for protocol purposes", () => {
		const ui = state();
		applyTransportEvent(ui, { kind: "stderr", text: "noise" }, { onDialog: () => {} });
		expect(ui.transcript.rowsView).toHaveLength(0);
		expect(ui.transcript.runState.lastError).toBeUndefined();
	});
});