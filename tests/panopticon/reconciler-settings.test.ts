/** Tests for persisted Panopticon reconciliation settings. */

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	resolveReconcilerSettings,
	saveReconcilerSetting,
} from "../../extensions/pi-panopticon/registry/reconciler-settings.js";

describe("Panopticon reconciler settings", () => {
	it("defaults off and preserves unrelated settings", async () => {
		const root = mkdtempSync(join(tmpdir(), "panopticon-settings-"));
		try {
			const globalPath = join(root, "settings.json");
			writeFileSync(globalPath, JSON.stringify({ theme: "dark" }));
			expect(resolveReconcilerSettings(root, false, globalPath)).toEqual({
				reconciliationNotifications: false,
			});
			await saveReconcilerSetting("global", true, root, globalPath);
			expect(JSON.parse(readFileSync(globalPath, "utf8"))).toMatchObject({
				theme: "dark",
				panopticon: { reconciliationNotifications: true },
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses trusted project settings as an override", async () => {
		const root = mkdtempSync(join(tmpdir(), "panopticon-project-"));
		try {
			const project = join(root, ".pi");
			mkdirSync(project, { recursive: true });
			const globalPath = join(root, "settings.json");
			writeFileSync(
				globalPath,
				JSON.stringify({
					panopticon: { reconciliationNotifications: true },
				}),
			);
			writeFileSync(
				join(project, "settings.json"),
				JSON.stringify({
					panopticon: { reconciliationNotifications: false },
				}),
			);
			expect(
				resolveReconcilerSettings(root, true, globalPath)
					.reconciliationNotifications,
			).toBe(false);
			expect(
				resolveReconcilerSettings(root, false, globalPath)
					.reconciliationNotifications,
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
