/** Tests for persisted kanban watcher settings. */

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
	resolveWatcherSettings,
	saveWatcherSetting,
} from "../../extensions/pi-kanban/watcher-settings.js";

describe("Kanban watcher settings", () => {
	it("defaults off and preserves unrelated settings when saving", async () => {
		const root = mkdtempSync(join(tmpdir(), "kanban-watcher-settings-"));
		const globalPath = join(root, "settings.json");
		writeFileSync(globalPath, JSON.stringify({ theme: "dark" }));

		expect(
			resolveWatcherSettings(root, false, globalPath).watchNotifications,
		).toBe(false);
		await saveWatcherSetting("global", true, root, globalPath);

		const saved = JSON.parse(readFileSync(globalPath, "utf8")) as Record<
			string,
			unknown
		>;
		expect(saved).toMatchObject({
			theme: "dark",
			kanban: { watchNotifications: true },
		});
		rmSync(root, { recursive: true, force: true });
	});

	it("uses trusted project settings as an override", async () => {
		const root = mkdtempSync(join(tmpdir(), "kanban-watcher-project-"));
		const project = join(root, ".pi");
		mkdirSync(project, { recursive: true });
		const globalPath = join(root, "settings.json");
		writeFileSync(
			globalPath,
			JSON.stringify({ kanban: { watchNotifications: true } }),
		);
		writeFileSync(
			join(project, "settings.json"),
			JSON.stringify({ kanban: { watchNotifications: false } }),
		);

		expect(
			resolveWatcherSettings(root, true, globalPath).watchNotifications,
		).toBe(false);
		expect(
			resolveWatcherSettings(root, false, globalPath).watchNotifications,
		).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});
