/** Process-local atomic slot used only through the inert boost authority. */

import type { BoostGlobalSlot as BoostGlobalSlotContract } from "./contracts.js";

/** A synchronous compare-and-set slot shared by injected authority instances. */
export class BoostGlobalLeaseSlot implements BoostGlobalSlotContract {
	private owner?: symbol;

	tryAcquire(owner: symbol): boolean {
		if (this.owner !== undefined) {
			return false;
		}
		this.owner = owner;
		return true;
	}

	isOwnedBy(owner: symbol): boolean {
		return this.owner === owner;
	}

	release(owner: symbol): boolean {
		if (this.owner !== owner) {
			return false;
		}
		this.owner = undefined;
		return true;
	}

	isOccupied(): boolean {
		return this.owner !== undefined;
	}
}
