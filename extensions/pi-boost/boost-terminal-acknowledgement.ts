/** Bounded provider terminal acknowledgement used during active-lease revocation. */

import type { LiveBoostTerminalEvent } from "./live-boost-bridge-contract.js";

export function awaitTerminalAcknowledgement(
	terminal: Promise<LiveBoostTerminalEvent>,
): Promise<LiveBoostTerminalEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Boost terminal acknowledgement timed out")), 30_000);
		terminal.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
