/** Production assembly of the reviewed boost host from Q-injected dependencies. */

import type { BoostGovernanceDecision } from "../boost/contracts.js";
import type { LiveBoostHostInjection } from "../boost/runtime-adapter.js";
import {
	DaemonBoostControlStore,
	type DaemonBoostWal,
} from "./daemon-boost-control-store.js";
import { HostInjectedLiveBoostRuntime } from "./host-injected-live-boost.js";
import type {
	LiveBoostAuditRecord,
	LiveBoostProviderRequest,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";
import {
	createQBoostControlAdapter,
	type QBoostControlRecordSource,
} from "./q-boost-control-adapter.js";
import type { QBoostControlReference } from "./q-boost-control-contract.js";
import {
	createReviewedBoostHost,
	type ReviewedBoostContractIdentity,
	type ReviewedBoostHost,
} from "./reviewed-boost-host.js";

/** @public All host-owned dependencies needed to construct the Q-bound bridge. */
export interface ProductionQBoostHostInput {
	readonly contract: ReviewedBoostContractIdentity;
	readonly control: {
		readonly reference: QBoostControlReference;
		readonly source: QBoostControlRecordSource;
		readonly principalIssuerId: string;
	};
	readonly wal: DaemonBoostWal;
	readonly now: () => number;
	readonly nextLeaseId: () => string;
	readonly governance: {
		classify(combinedInput: string): Promise<BoostGovernanceDecision>;
	};
	readonly provider: {
		dispatch(
			request: LiveBoostProviderRequest,
			signal: AbortSignal,
		): Promise<LiveBoostTerminalEvent>;
	};
	readonly baseline: {
		restore(subjectId: string): Promise<void>;
	};
	readonly audit: {
		append(record: LiveBoostAuditRecord): Promise<void>;
	};
	readonly shutdownChoice: LiveBoostHostInjection["shutdownChoice"];
}

/** Opens the durable store and constructs a cold reviewed host without dispatching. */
export async function createProductionQBoostHost(
	input: ProductionQBoostHostInput,
): Promise<ReviewedBoostHost> {
	const control = createQBoostControlAdapter(input.control.source, {
		principalIssuerId: input.control.principalIssuerId,
		now: input.now,
	});
	const store = await DaemonBoostControlStore.open(input.wal);
	const bridge = new HostInjectedLiveBoostRuntime({
		store,
		control,
		now: input.now,
		nextLeaseId: input.nextLeaseId,
		governance: input.governance,
		provider: input.provider,
		baseline: input.baseline,
		audit: input.audit,
	});
	return createReviewedBoostHost({
		contract: input.contract,
		injection: {
			bridge,
			control: input.control.reference,
			shutdownChoice: input.shutdownChoice,
		},
	});
}
