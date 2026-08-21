/** Shared data-only parser contracts for environmental and cognitive boost commands. */

import type { BoostRequest } from "./contracts.js";
import type { BoostFusionRequest } from "./cognitive-types.js";

/** @public */
export type BoostParseErrorCode =
	| "not-boost-command"
	| "missing-prompt"
	| "trailing-subcommand"
	| "invalid-yield-count"
	| "invalid-panel-size"
	| "invalid-profile"
	| "repeated-option"
	| "conflicting-isolation"
	| "unknown-option"
	| "input-too-large";

/** @public */
export type BoostParsedCommand =
	| { readonly kind: "status" }
	| { readonly kind: "reset" }
	| { readonly kind: "settings" }
	| { readonly kind: "request"; readonly request: BoostRequest }
	| { readonly kind: "fusion"; readonly fusion: BoostFusionRequest };

/** @public */
export type BoostParseResult =
	| { readonly ok: true; readonly command: BoostParsedCommand }
	| {
			readonly ok: false;
			readonly error: {
				readonly code: BoostParseErrorCode;
				readonly message: string;
			};
	  };
