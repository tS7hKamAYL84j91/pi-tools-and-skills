/**
 * Watched-file list editor used as the pi-file-watch settings submenu.
 * Paths are read through a provider so live edits (add/remove persist
 * immediately) re-render in the same open editor. The add prompt embeds
 * pi-tui's Input for native cursor editing and bracketed paste.
 */

import { Input, matchesKey, type Component, type Focusable } from "@earendil-works/pi-tui";

interface WatchListEditorCallbacks {
	onAdd(path: string): void;
	onRemove(index: number): void;
	/** Close the submenu and return to the settings list (no value change). */
	onClose(): void;
}

export class WatchListEditor implements Component, Focusable {
	private selectedIndex = 0;
	private adding = false;
	private addInput: Input | null = null;
	private focusedFlag = false;

	constructor(
		private readonly paths: () => readonly string[],
		private readonly callbacks: WatchListEditorCallbacks,
	) {}

	get focused(): boolean {
		return this.focusedFlag;
	}

	set focused(value: boolean) {
		this.focusedFlag = value;
		if (this.addInput) this.addInput.focused = value;
	}

	handleInput(data: string): void {
		if (this.adding) {
			this.handleAddInput(data);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.callbacks.onClose();
			return;
		}
		const list = this.paths();
		const addIndex = list.length;
		if (matchesKey(data, "up")) {
			if (this.selectedIndex > 0) this.selectedIndex--;
			return;
		}
		if (matchesKey(data, "down")) {
			if (this.selectedIndex < addIndex) this.selectedIndex++;
			return;
		}
		if (matchesKey(data, "d")) {
			if (this.selectedIndex < addIndex) {
				this.callbacks.onRemove(this.selectedIndex);
			}
			return;
		}
		if (matchesKey(data, "a")) {
			this.adding = true;
			this.addInput = new Input();
			this.addInput.focused = this.focusedFlag;
			return;
		}
	}

	private handleAddInput(data: string): void {
		const input = this.addInput;
		if (!input) return;
		if (matchesKey(data, "escape")) {
			this.adding = false;
			this.addInput = null;
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			const value = input.getValue().trim();
			this.adding = false;
			this.addInput = null;
			if (value && !value.includes("\0") && value.length <= 4096) {
				this.callbacks.onAdd(value);
			}
			return;
		}
		input.handleInput(data);
	}

	render(width: number): string[] {
		const list = this.paths();
		const addIndex = list.length;
		if (this.selectedIndex > addIndex) this.selectedIndex = addIndex;
		const lines: string[] = [];
		for (const [index, path] of list.entries()) {
			const cursor = index === this.selectedIndex ? "› " : "  ";
			lines.push(`${cursor}${path}`.slice(0, Math.max(1, width)));
		}
		const addCursor = this.selectedIndex === addIndex ? "› " : "  ";
		lines.push(`${addCursor}+ add file…`.slice(0, Math.max(1, width)));
		if (this.addInput) {
			for (const line of this.addInput.render(Math.max(1, width - 4))) {
				lines.push(`  ${line}`);
			}
		}
		lines.push("");
		lines.push(
			this.addInput
				? "  type path · enter add · esc cancel"
				: "  ↑/↓ select · d delete · a add · esc back",
		);
		return lines;
	}

	invalidate(): void {}
}