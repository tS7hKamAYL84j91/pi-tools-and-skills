import { defineConfig } from "vitest/config";

/**
 * Real-terminal (PTY) tests driven by termwright. Kept out of the default
 * `npm test` include so CI never launches an interactive `pi` session; run with
 *   npm run test:tui        (headless Vitest, no UI)
 *   npx termwright ui       (interactive runner + traces)
 */
export default defineConfig({
	test: {
		include: ["tests/termwright/**/*.tw.ts"],
		testTimeout: 120_000,
		hookTimeout: 60_000,
		// One interactive app at a time keeps the recording readable.
		fileParallelism: false,
	},
});
