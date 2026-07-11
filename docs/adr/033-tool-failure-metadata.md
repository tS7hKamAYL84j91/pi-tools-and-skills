# 33. Structured Tool Failure Metadata

Date: 2024-07-22

## Status

Accepted

## Context

The `lib/tool-result.ts` module standardizes how pi extension tools return their results using the `ok()` and `fail()` helpers. Historically, the `fail()` helper accepted a raw error message and an open-ended `details: Record<string, unknown>` object. 

While the open-ended nature of the `details` field has allowed for rich contextual debugging information in error scenarios, it lacks a standardized schema. This makes it difficult for agents, external transports, and programmatic caller environments (e.g., Matrix, Kanban loops, bounded UI diagnostics) to infer the correct failure mode or to safely distinguish between transient failures (which are retryable) and hard configuration or validation errors. Furthermore, diagnostics without boundaries can result in arbitrarily large JSON structures polluting logs, context windows, or UI overlays.

## Decision

We are expanding the `fail()` helper to accept an optional `FailureDetails` interface, extending the existing `Record<string, unknown>`.

```typescript
export interface FailureDetails extends Record<string, unknown> {
	code?: "validation" | "authorization" | "transient" | "timeout" | "cancelled" | "internal" | string;
	retryable?: boolean;
	action?: string;
	schemaVersion?: number;
	truncated?: boolean;
	correlationId?: string;
}
```

This ensures bounded diagnostics using existing primitives (storing structured, schema-bound fields inside the standard `details` envelope) while avoiding broad refactors or the introduction of new event buses.

1. **Backward Compatibility**: Existing callers that throw untyped properties into `details` will still function as expected, as the interface extends `Record<string, unknown>`.
2. **Bounded Diagnostics**: By relying on the `truncated` flag and categorized fields like `code` and `retryable`, callers can succinctly relay diagnostic data without writing arbitrary unbounded text to the session journal or causing memory blowout.
3. **Targeted Adoption**: We will gradually adopt these fields at complex external or destructive boundaries (such as agent spawning in Panopticon or scheduling in CoAS) without breaking existing caller mechanics.

## Consequences

* The schema remains simple and optional.
* Diagnostics text remains concise because structural meta-context (e.g., "retryable", "code: timeout") allows callers to avoid re-stating conditions in raw text.
* Any integration depending strictly on `Record<string, unknown>` won't break, as the type signature expands strictly rather than mutates.
